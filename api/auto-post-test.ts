// /api/auto-post-test.ts
//
// Dry-run test endpoint. NOT scheduled by cron. Public — no auth required.
//
// Always runs in dry-run mode regardless of the DRY_RUN env var: generates
// the post text and selects an Unsplash image, but does NOT post to
// Facebook. Returns the full pipeline output so you can preview what the
// next scheduled run would say and choose.
//
// Outer try/catch wraps the entire handler so any unexpected error
// (import failure, runtime crash, etc.) returns visible JSON instead of
// an empty/blank response.
//
// Hit: https://allaccesskc.com/api/auto-post-test

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runPost } from "./_shared.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const result = await runPost({ dryRun: true });
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      step: "handler_uncaught",
      error: err?.message || String(err),
      name: err?.name || null,
      stack: err?.stack || null,
    });
  }
}
