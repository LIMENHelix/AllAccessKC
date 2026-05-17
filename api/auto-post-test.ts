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

import { runPost } from "./_shared.js";

export default async function handler(_request: Request): Promise<Response> {
  try {
    const result = await runPost({ dryRun: true });
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err: any) {
    // Catch-all for errors that escape runPost's internal try/catch
    // (module load failures, sync errors during await, etc.). Make them
    // visible as JSON so the browser shows something useful.
    const body = {
      ok: false,
      step: "handler_uncaught",
      error: err?.message || String(err),
      name: err?.name || null,
      stack: err?.stack || null,
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
