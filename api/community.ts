// /api/community.ts
//
// "The KC Table" — a tiny public community chat where real visitors swap KC
// tips under auto-assigned, Kansas-City-flavored aliases (e.g. "Westport Wally",
// "Burnt End Benny", "Plaza Pearl"). NOT the AI concierge (/api/chat) — this is
// human-to-human. No accounts, no logins; the alias IS the identity.
//
// Storage: Neon Postgres via @vercel/postgres (serverless HTTP driver — no
// connection pool to exhaust). The whole feed lives in one table `kc_table`,
// trimmed to the most recent KEEP rows. If the database env var isn't set, the
// endpoint degrades gracefully (reads return empty, posts return a friendly
// "warming up" message) so the page never hard-errors.
//
//   GET  /api/community              -> 200 { ok, messages:[{id,alias,text,ts}], live }
//   POST /api/community {alias,text} -> 200 { ok, message } | 4xx/5xx { ok:false, error }
//
// Setup: add a Postgres (Neon) store to this project in the Vercel dashboard
// (Storage → Create → Postgres). Vercel injects POSTGRES_URL automatically — no
// manual env vars needed. The table is created on first use.
// Optional: KILL_SWITCH disables posting site-wide (reads still work).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "@vercel/postgres";

const KEEP = 200; // max messages retained in the table
const RETURN = 60; // messages returned to the client per fetch
const MAX_TEXT = 280; // per-message length clamp
const MAX_ALIAS = 28;

// Per-IP, in-memory abuse backstop (per warm Lambda instance — best-effort).
const POST_MIN_GAP_MS = 1500; // no faster than ~1 msg / 1.5s
const POST_PER_HOUR = 40;
const ipPosts: Map<string, number[]> = new Map();
const ipLast: Map<string, number> = new Map();

// ── KC-style alias generator (mirrors the client list) ────────────────
const KC_PLACES = [
  "Westport", "Brookside", "Waldo", "Crossroads", "Plaza", "Northland",
  "Midtown", "Westside", "River Market", "Crown Center", "Columbus Park",
  "Strawberry Hill", "Hyde Park", "Martini Corner", "Volker", "Quindaro",
  "Parkville", "Gladstone", "Riverside", "Sugar Creek",
  // KC icons / things, great as a prefix too
  "Burnt End", "Boulevard", "Fountain", "Royal", "Chiefs", "Sporting",
  "Streetcar", "Arrowhead", "Kauffman", "Shuttlecock", "Scout", "Jazz",
  "Brisket", "Z-Man", "Ribs", "Loose Park",
];
const KC_NAMES = [
  "Benny", "Barb", "Bo", "Betty", "Charlie", "Cleo", "Dot", "Earl", "Faye",
  "Gus", "Hank", "Ida", "Jax", "Kit", "Lou", "Mabel", "Ned", "Otis", "Pearl",
  "Quinn", "Rae", "Sal", "Tess", "Vic", "Wally", "Willa", "Zeke", "Marty",
  "Stan", "Roy", "June", "Hattie", "Cliff", "Rufus", "Della", "Moe", "Pete",
  "Stella", "Hazel", "Gene",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function kcAlias(): string {
  const place = pick(KC_PLACES);
  // ~60% of the time alliterate the name with the place's first letter
  const want = place.replace(/[^a-z]/i, "").charAt(0).toUpperCase();
  let name: string;
  if (Math.random() < 0.6) {
    const matches = KC_NAMES.filter((n) => n.charAt(0).toUpperCase() === want);
    name = matches.length ? pick(matches) : pick(KC_NAMES);
  } else {
    name = pick(KC_NAMES);
  }
  return `${place} ${name}`;
}

// Light, family-friendly mask. Not exhaustive — just keeps the obvious stuff out
// of a public visitor-facing wall.
const BANNED = /\b(fuck|shit|bitch|cunt|nigger|faggot|asshole|dick|pussy|whore|slut)\w*/gi;
function clean(s: string): string {
  return s.replace(BANNED, (m) => m[0] + "*".repeat(Math.max(1, m.length - 1)));
}

function sanitizeText(raw: unknown): string {
  const t = String(raw ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // strip control chars (keep \t \n \r)
    .replace(/[^\S\n]{3,}/g, "  ")                 // collapse long runs of spaces
    .replace(/\n{4,}/g, "\n\n\n")                  // cap blank-line spam
    .trim()
    .slice(0, MAX_TEXT);
  return clean(t);
}

function sanitizeAlias(raw: unknown): string {
  const t = String(raw ?? "")
    .replace(/[^\w .'\-]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_ALIAS);
  // If the client didn't send a usable alias, assign a KC one.
  return t.length >= 2 ? clean(t) : kcAlias();
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd || "";
  return (raw.split(",")[0] || "unknown").trim() || "unknown";
}

// ── Postgres helpers ──────────────────────────────────────────────────
// @vercel/postgres reads POSTGRES_URL (injected by the Vercel Postgres/Neon
// integration) automatically. No URL → not configured → graceful degrade.
function dbConfigured(): boolean {
  return !!(process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING);
}

// CREATE TABLE IF NOT EXISTS is idempotent and cheap; we memoize per warm
// instance so we only issue it once, but it's safe to call repeatedly.
let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = sql`
      CREATE TABLE IF NOT EXISTS kc_table (
        id    BIGSERIAL PRIMARY KEY,
        alias TEXT   NOT NULL,
        body  TEXT   NOT NULL,
        ts    BIGINT NOT NULL
      )
    `.then(() => undefined).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

function rateLimited(ip: string): string | null {
  const now = Date.now();
  const last = ipLast.get(ip) || 0;
  if (now - last < POST_MIN_GAP_MS) {
    return "Easy there — give it a couple seconds between messages.";
  }
  const HOUR = 3600_000;
  const hits = (ipPosts.get(ip) || []).filter((t) => now - t < HOUR);
  if (hits.length >= POST_PER_HOUR) {
    return "You've posted a lot this hour — take a breather and come back soon.";
  }
  hits.push(now);
  ipPosts.set(ip, hits);
  ipLast.set(ip, now);
  if (ipPosts.size > 5000) {
    for (const [k, v] of ipPosts) {
      const live = v.filter((t) => now - t < HOUR);
      if (live.length) ipPosts.set(k, live);
      else { ipPosts.delete(k); ipLast.delete(k); }
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const live = dbConfigured();

  // ── READ ────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if (!live) return res.status(200).json({ ok: true, live: false, messages: [] });
    try {
      await ensureTable();
      // Newest RETURN rows, then flip to chronological order for display.
      const { rows } = await sql`
        SELECT id, alias, body, ts FROM kc_table ORDER BY id DESC LIMIT ${RETURN}
      `;
      const messages = rows
        .reverse()
        .map((r: any) => ({ id: String(r.id), alias: r.alias, text: r.body, ts: Number(r.ts) }));
      return res.status(200).json({ ok: true, live: true, messages });
    } catch (err: any) {
      return res.status(200).json({ ok: true, live: false, messages: [], error: err?.message });
    }
  }

  // ── WRITE ───────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (process.env.KILL_SWITCH) {
    return res.status(503).json({ ok: false, error: "The KC Table is paused right now — check back soon." });
  }
  if (!live) {
    return res.status(503).json({
      ok: false,
      error: "The KC Table is warming up — it's not switched on yet. Try again soon!",
    });
  }

  let body: any = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const text = sanitizeText(body?.text);
  if (!text) return res.status(400).json({ ok: false, error: "Say something first 🙂" });
  const alias = sanitizeAlias(body?.alias);

  const ip = clientIp(req);
  const limit = rateLimited(ip);
  if (limit) return res.status(429).json({ ok: false, error: limit });

  const ts = Date.now();
  try {
    await ensureTable();
    const { rows } = await sql`
      INSERT INTO kc_table (alias, body, ts) VALUES (${alias}, ${text}, ${ts})
      RETURNING id
    `;
    const id = String(rows[0]?.id);

    // Bound the table. Run the trim only occasionally to keep write cost low —
    // KEEP is a soft cap, a little drift between trims is fine.
    if (Math.random() < 0.15) {
      await sql`
        DELETE FROM kc_table
        WHERE id < (SELECT MIN(id) FROM (SELECT id FROM kc_table ORDER BY id DESC LIMIT ${KEEP}) t)
      `;
    }

    return res.status(200).json({ ok: true, message: { id, alias, text, ts } });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: "Couldn't post that — try again in a moment." });
  }
}
