// /api/auto-post.ts
//
// Production endpoint — invoked by Vercel cron every day at 15:00 UTC
// (= 10 AM CDT / 9 AM CST) per the schedule in vercel.json. Vercel cron
// automatically attaches `Authorization: Bearer ${CRON_SECRET}` when
// CRON_SECRET is set as an env var in the project. We verify that header here.
//
// To pause posting without redeploying, set KILL_SWITCH=true in env vars.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runPost } from "./_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // ── 1. Authorize ────────────────────────────────────────────────
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return res.status(500).json({
        ok: false,
        step: "auth",
        error: "CRON_SECRET env var not set on server",
      });
    }
    const authHeader = (req.headers.authorization as string) || "";
    if (authHeader !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, step: "auth", error: "unauthorized" });
    }

    // ── 2. Kill switch ──────────────────────────────────────────────
    if ((process.env.KILL_SWITCH || "").toLowerCase() === "true") {
      console.log("[auto-post] KILL_SWITCH=true, skipping run");
      return res.status(200).json({
        ok: true,
        step: "kill_switch",
        skipped: true,
        dryRun: false,
      });
    }

    // ── 3. Run the pipeline ─────────────────────────────────────────
    // DRY_RUN can be flipped on at the env-var level without touching code.
    const dryRun = (process.env.DRY_RUN || "").toLowerCase() === "true";
    const result = await runPost({ dryRun });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err: any) {
    // Catch-all for errors that escape runPost's internal try/catch.
    return res.status(500).json({
      ok: false,
      step: "handler_uncaught",
      error: err?.message || String(err),
      name: err?.name || null,
      stack: err?.stack || null,
    });
  }
}
