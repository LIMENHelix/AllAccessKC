// /api/subscribe.ts
//
// Lightweight email capture for the free gateway. There is no database in this
// project, so a signup is forwarded to the operator's inbox via Resend (the
// same helper the auto-post system uses). It's lossy-by-design but zero-infra;
// swap in Upstash/Resend Audiences later for a real list.
//
// POST { email: string, source?: string }  ->  200 { ok }  | 400 | 503

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendNotificationEmail } from "./_shared.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-instance abuse backstop (no KV available)
const hits: Map<string, number[]> = new Map();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const live = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (live.length >= 8) return true;
  live.push(now);
  hits.set(ip, live);
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  let body: any = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const email = String(body?.email || "").trim().slice(0, 200);
  const source = String(body?.source || "allaccesskc").trim().slice(0, 60);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: "Enter a valid email." });
  }

  const fwd = req.headers["x-forwarded-for"];
  const ip = ((Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0] || "unknown").trim();
  if (tooMany(ip)) return res.status(429).json({ ok: false, error: "Too many signups — try later." });

  // No Resend configured? Still succeed for the visitor; log for the operator.
  if (!process.env.RESEND_API_KEY) {
    console.log(`[subscribe] (no Resend) ${email} via ${source}`);
    return res.status(200).json({ ok: true, note: "queued" });
  }

  const r = await sendNotificationEmail({
    subject: `[All Access KC] New subscriber — ${email}`,
    html: `<p>New email signup on All Access KC.</p>
<p><b>Email:</b> ${email}<br><b>Source:</b> ${source}<br><b>When:</b> ${new Date().toISOString()}</p>`,
  });

  if (!r.sent) {
    console.warn(`[subscribe] forward failed for ${email}: ${r.error}`);
    // Don't punish the visitor for our mail-delivery problem.
    return res.status(200).json({ ok: true, note: "received" });
  }
  return res.status(200).json({ ok: true });
}
