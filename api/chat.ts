// /api/chat.ts
//
// "Ask a Local" — KC concierge chat powered by Claude (Haiku, the cheap/fast
// tier). This is a FREE, public, unauthenticated endpoint, so cost control is
// the whole game. Defenses, cheapest-first:
//
//   1. KILL_SWITCH env  — set it to instantly disable chat site-wide.
//   2. Cheap model + small max_tokens + short history window.
//   3. Per-IP in-memory rate limit (hour + day) as an abuse backstop.
//   4. Global per-instance daily cap so a bad day can't run away.
//
// NOTE: there is no KV/Redis in this project, so the per-IP / global limits are
// per warm Lambda instance, i.e. BEST-EFFORT, not a hard global ceiling. For a
// true hard cap, bolt on Upstash Redis later (one REST call per request). The
// client also enforces a daily message cap in localStorage for honest users.
//
// POST { messages: [{ role: "user"|"assistant", content: string }, ...] }
//  -> 200 { reply }   | 429 { error, reply }   | 503 { error, reply }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001"; // cheapest current tier — fine for concierge
const MAX_TOKENS = 350;
const MAX_HISTORY = 8; // last N turns sent to the model
const MAX_CHARS = 1500; // per-message content clamp

// Per-IP limits (per warm instance)
const IP_PER_HOUR = 12;
const IP_PER_DAY = 40;
// Global per-instance/day limit — runaway backstop
const GLOBAL_PER_DAY = 600;

const SYSTEM = `You are the All Access KC concierge — a sharp, friendly Kansas City local who helps visitors and newcomers. Think of yourself as "Alex," the voice behind the free All Access KC guide.

Your job: give specific, useful, local answers about Kansas City — food and BBQ, bars, neighborhoods, day plans, parking, transit, sports (Chiefs, Royals, Sporting KC, the 2026 World Cup matches at Arrowhead), free things to do, and visitor logistics.

Style:
- Be concise and concrete. Lead with the answer. 2-4 short sentences or a tight list.
- Sound like a real local who actually goes places, not a brochure. Have opinions.
- When a full plan would help, point them to the free guide at /kc-guide.html (it's free, no signup).
- If you genuinely don't know a current detail (today's hours, a live score, sold-out status), say so and suggest how to check. Never invent specific prices, times, or addresses you're unsure of.
- Politely steer non-KC questions back to Kansas City. You only cover KC.
- You can't make reservations or bookings; suggest the venue's own page for that.

Keep it warm, helpful, and short.`;

// ── In-memory state (per warm instance) ───────────────────────────
const ipHits: Map<string, number[]> = new Map();
let globalDay = { day: "", count: 0 };

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd || "";
  return (raw.split(",")[0] || "unknown").trim() || "unknown";
}

function rateLimited(ip: string): string | null {
  const now = Date.now();
  const HOUR = 3600_000;
  const DAY = 86_400_000;

  // global per-instance/day
  const dk = dayKey();
  if (globalDay.day !== dk) globalDay = { day: dk, count: 0 };
  if (globalDay.count >= GLOBAL_PER_DAY) {
    return "The concierge has hit its daily limit for today. Browse the free guide meanwhile — it covers most of what people ask.";
  }

  // per-IP hour + day
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < DAY);
  const inHour = hits.filter((t) => now - t < HOUR).length;
  if (inHour >= IP_PER_HOUR || hits.length >= IP_PER_DAY) {
    return "You've reached the question limit for now — give it a little while. In the meantime the free guide has full day-plans, food picks, and parking tricks.";
  }

  hits.push(now);
  ipHits.set(ip, hits);
  globalDay.count++;

  // opportunistic cleanup so the Map can't grow unbounded
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      const live = v.filter((t) => now - t < DAY);
      if (live.length) ipHits.set(k, live); else ipHits.delete(k);
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", reply: "" });
  }

  // COST PAUSE (2026-06-20): Anthropic spend paused per operator request.
  // Set CHAT_ENABLED back to true (or remove this block) to re-enable the
  // concierge. While paused we never call Anthropic.
  const CHAT_ENABLED = true; // re-enabled on Haiku 2026-06-20
  if (!CHAT_ENABLED) {
    return res.status(503).json({
      error: "paused",
      reply: "The live concierge is paused right now — but the full guide is open and free: it has KC food, plans, parking, and matchday tips.",
    });
  }

  if (process.env.KILL_SWITCH) {
    return res.status(503).json({
      error: "disabled",
      reply: "The live concierge is paused right now — but the full guide is open and free: open it for KC food, plans, parking, and matchday tips.",
    });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "not_configured",
      reply: "Chat isn't switched on yet. The full free guide has the answers in the meantime.",
    });
  }

  // Parse body (Vercel usually parses JSON; tolerate a raw string too)
  let body: any = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const messages = rawMessages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "no_message", reply: "Ask me anything about Kansas City — food, plans, parking, sports, free stuff." });
  }

  const ip = clientIp(req);
  const limitMsg = rateLimited(ip);
  if (limitMsg) {
    return res.status(429).json({ error: "rate_limited", reply: limitMsg });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages,
    });
    const reply = message.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    return res.status(200).json({
      reply: reply || "I didn't catch that — try asking about KC food, a day plan, parking, or where to watch a game.",
    });
  } catch (err: any) {
    return res.status(503).json({
      error: err?.message || String(err),
      reply: "I'm having a moment — try again in a bit, or dive into the free guide.",
    });
  }
}
