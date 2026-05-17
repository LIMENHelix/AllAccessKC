// /api/status.ts
//
// Zero-dependency diagnostic endpoint. Reveals whether each env var is set
// (boolean only — never returns the actual values). Use this to confirm
// the auto-post system is configured correctly without running any of the
// pipeline (no Anthropic call, no Unsplash call, no Facebook call).
//
// Public — no auth required. Returns booleans, not secrets.
//
// Hit: https://allaccesskc.com/api/status

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      runtime: {
        node: typeof process !== "undefined" ? process.version : "unknown",
        platform: typeof process !== "undefined" ? process.platform : "unknown",
      },
      env: {
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        hasUnsplashKey: !!process.env.UNSPLASH_ACCESS_KEY,
        hasFBToken: !!process.env.FB_PAGE_ACCESS_TOKEN,
        hasFBPageId: !!process.env.FB_PAGE_ID,
        hasCronSecret: !!process.env.CRON_SECRET,
        killSwitch: process.env.KILL_SWITCH || null,
        dryRunFlag: process.env.DRY_RUN || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
}
