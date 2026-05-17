// /api/auto-post-test.ts
//
// Dry-run test endpoint. NOT scheduled by cron. Public — no auth required.
//
// Always runs in dry-run mode regardless of the DRY_RUN env var: generates
// the post text and selects an Unsplash image, but does NOT post to
// Facebook. Returns the full pipeline output so you can preview what the
// next scheduled run would say and choose.
//
// To trigger:
//   curl https://allaccesskc.com/api/auto-post-test
// Or just open that URL in your browser.

import { runPost } from "./_shared.js";

export const config = { runtime: "nodejs" };

export default async function handler(_request: Request): Promise<Response> {
  // Forced dryRun: this endpoint must never post to Facebook, even if
  // the operator accidentally sets DRY_RUN=false.
  const result = await runPost({ dryRun: true });
  return new Response(JSON.stringify(result, null, 2), {
    status: result.ok ? 200 : 500,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
