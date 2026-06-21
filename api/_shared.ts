// /api/_shared.ts
//
// Core pipeline for the AllAccessKC weekly Facebook auto-post.
// Imported by /api/auto-post.ts (production) and /api/auto-post-test.ts (dry-run).
// Files in /api whose name starts with _ are treated as non-routes by Vercel.
//
// Architecture: stateless rotation.
//   totalSlots = daysSinceAnchor * 2 + slotInDay  (slotInDay: 0=morning, 1=evening)
//   topicIndex = totalSlots mod topics.length
// 2x daily cadence: cron fires at 14:00 UTC (9 AM CDT) and 22:00 UTC (5 PM CDT).
// Morning slot = utcHour < 18; evening slot = utcHour >= 18.
// With N topics and 2 posts/day, each topic repeats every N/2 days.
// 75 topics -> ~37.5 days (~5.4 weeks) before any topic returns.
// No filesystem writes (Vercel serverless filesystem is read-only outside /tmp).
// Audit log lives in Vercel function logs (~30 day retention).
// If long-term persistence is desired later: bolt on @vercel/kv at the
// "Phase 2 audit log" marker below.

import Anthropic from "@anthropic-ai/sdk";
import { createRequire } from "node:module";

// Load topics.json via createRequire (CommonJS resolver) rather than a bare
// ESM `import topicsData from "./topics.json"`. The bare ESM JSON import
// throws ERR_IMPORT_ATTRIBUTE_MISSING at runtime under "type": "module"
// (strict ESM requires `with { type: "json" }`). createRequire bypasses
// the ESM import-attribute requirement entirely and works on every Node
// version Vercel supports. The JSON is still bundled into the function.
const requireCJS = createRequire(import.meta.url);
const topicsData = requireCJS("./topics.json") as string[];

// ─── Configuration ────────────────────────────────────────────────────
const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 600;
const TEMPERATURE = 0.8;
const FB_GRAPH_VERSION = "v22.0";
const UNSPLASH_PER_PAGE = 10;

// Anchor for the deterministic rotation. The first daily run after this anchor
// posts topic index 0; the next day posts index 1; etc. Changing this constant
// shifts every future post — only change in tandem with topics.json.
const ROTATION_EPOCH = new Date("2026-05-17T00:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

// Verbatim prompt from project spec. Keep "{topic}" placeholder; do not edit.
const PROMPT_TEMPLATE = `You are Alex, a Kansas City local writing a Facebook post for AllAccessKC, a paid $5 visitor guide.

CRITICAL: Tease, don't tell. Make readers curious enough to pay $5. Do NOT name specific places. Do NOT give away the answer.

TOPIC: {topic}

STRUCTURE (120-150 words):
1. Open with a problem/scenario visitors face
2. Hint that locals know a smart way to handle it
3. End with: "Full breakdown at allaccesskc.com"

VOICE: Direct, warm, like texting a friend. No corporate buzzwords. No hashtags. Max one emoji.

FORBIDDEN: Naming specific restaurants/bars in the post text. Words: FIFA, World Cup, Mundial, Copa, official.

REAL PLACES ONLY: When the topic refers to a specific spot (BBQ joint, bar, neighborhood, restaurant, park, building, fountain), it must be an actual current Kansas City place. Do not invent fictional venues. If you genuinely do not know a real place that fits the topic, write a more general post that doesn't reference a specific venue, and say so in the OPERATOR_ANSWER line.

ANTI-REPETITION: Each time you write about a topic, approach it from a different angle. Vary the opening (question, story, observation, contradiction). Don't reuse the same metaphors or phrases.

OUTPUT FORMAT (three sections, each on its own block):
Lines 1-N: The post text (the teaser — NEVER name the specific place)
Then (separate line): IMAGE_KEYWORDS: word1, word2, word3
Then (separate line): OPERATOR_ANSWER: [The actual KC place this post is teasing — exact name, neighborhood/area, and 1 short sentence on why locals would recommend it. This is for the site operator to verify the tease references a real place. Never put this in the post text. If the topic isn't about a single specific venue, say so here and describe what general thing the post is about.]`;

// ─── Email helpers (Resend HTTP API, no SDK required) ────────────────
// Sends transactional email via Resend. Free tier covers 3,000 emails/month
// — more than enough for daily + occasional failure alerts.
//
// Required env: RESEND_API_KEY
// Optional env: NOTIFY_EMAIL  (recipient; default: info@allaccesskc.com)
//               EMAIL_FROM    (sender; default: All Access KC <noreply@allaccesskc.com>)
// Domain must be verified on Resend (DNS SPF + DKIM records).
export async function sendNotificationEmail(opts: {
  subject: string;
  html: string;
  to?: string;
}): Promise<{ sent: boolean; error?: string; id?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }
  const to = opts.to || process.env.NOTIFY_EMAIL || "info@allaccesskc.com";
  const from = process.env.EMAIL_FROM || "All Access KC <noreply@allaccesskc.com>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject: opts.subject, html: opts.html }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.warn(`[auto-post] Resend ${r.status}: ${body}`);
      return { sent: false, error: `Resend ${r.status}: ${body}` };
    }
    const j = (await r.json()) as { id?: string };
    return { sent: true, id: j.id };
  } catch (err: any) {
    console.warn(`[auto-post] Resend exception: ${err?.message || err}`);
    return { sent: false, error: err?.message || String(err) };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSuccessEmailHtml(d: {
  topic: string;
  topicIndex: number;
  totalTopics: number;
  postText: string;
  imageKeywords: string;
  imageUrl: string;
  operatorAnswer?: string;
}): string {
  const ts = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Chicago" });
  return `<!doctype html><html><body style="margin:0;background:#f7f1e3;font-family:Georgia,'Times New Roman',serif;color:#1a1d2a;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#f7f1e3;">
  <div style="font-size:0.7rem;letter-spacing:4px;color:#8b6914;text-transform:uppercase;font-weight:600;margin-bottom:8px;">ALL ACCESS KC · DAILY POST</div>
  <div style="font-size:0.82rem;color:#646774;margin-bottom:24px;">${escapeHtml(ts)} · topic ${d.topicIndex + 1} of ${d.totalTopics}</div>
  <h1 style="font-size:1.4rem;font-weight:600;color:#1a1d2a;margin:0 0 20px 0;line-height:1.3;">${escapeHtml(d.topic)}</h1>
  <div style="background:#fbf6e8;border-left:3px solid #8b6914;padding:18px 22px;margin-bottom:18px;font-size:0.98rem;line-height:1.65;color:#3d4053;white-space:pre-wrap;">${escapeHtml(d.postText)}</div>
  ${d.operatorAnswer ? `
  <div style="font-size:0.78rem;letter-spacing:2px;text-transform:uppercase;color:#c44848;font-weight:600;margin:24px 0 8px 0;">OPERATOR-ONLY ANSWER &mdash; do NOT post</div>
  <div style="background:#fae8e8;border-left:3px solid #c44848;padding:14px 18px;margin-bottom:24px;font-size:0.92rem;line-height:1.55;color:#1a1d2a;">${escapeHtml(d.operatorAnswer)}</div>` : ""}
  <div style="font-size:0.78rem;letter-spacing:2px;text-transform:uppercase;color:#8b6914;font-weight:600;margin-bottom:8px;">SELECTED IMAGE</div>
  <div style="font-size:0.85rem;color:#646774;margin-bottom:10px;font-style:italic;">query: ${escapeHtml(d.imageKeywords)}</div>
  <a href="${d.imageUrl}" target="_blank"><img src="${d.imageUrl}" alt="" style="max-width:100%;height:auto;border:1px solid #d4cdb8;margin-bottom:12px;"></a>
  <div style="font-size:0.78rem;color:#646774;word-break:break-all;margin-bottom:24px;"><a href="${d.imageUrl}" target="_blank" style="color:#8b6914;">${escapeHtml(d.imageUrl)}</a></div>
  <div style="border-top:1px solid #d4cdb8;padding-top:18px;font-size:0.78rem;color:#646774;line-height:1.5;">
    Auto-post is in manual mode (FB_POSTING_ENABLED is not "true"). Copy the text + image above and post manually to the AllAccessKC Facebook page. To enable auto-posting, set FB_POSTING_ENABLED=true in Vercel env vars after verifying the Page Access Token has the pages_manage_posts scope.
  </div>
</div></body></html>`;
}

function buildFailureEmailHtml(d: { step: string; error: string; topicIndex?: number; topic?: string }): string {
  const ts = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Chicago" });
  return `<!doctype html><html><body style="margin:0;background:#fae8e8;font-family:Georgia,'Times New Roman',serif;color:#1a1d2a;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;">
  <div style="font-size:0.7rem;letter-spacing:4px;color:#c44848;text-transform:uppercase;font-weight:600;margin-bottom:8px;">⚠ ALL ACCESS KC · AUTO-POST FAILURE</div>
  <div style="font-size:0.82rem;color:#646774;margin-bottom:24px;">${escapeHtml(ts)}</div>
  <h1 style="font-size:1.2rem;font-weight:600;color:#c44848;margin:0 0 16px 0;">Pipeline failed at step "${escapeHtml(d.step)}"</h1>
  ${d.topic ? `<div style="font-size:0.92rem;color:#3d4053;margin-bottom:16px;">Topic that would have run: <i>${escapeHtml(d.topic)}</i></div>` : ""}
  <div style="font-size:0.85rem;letter-spacing:2px;text-transform:uppercase;color:#646774;font-weight:600;margin-bottom:8px;">ERROR</div>
  <pre style="background:#fae8e8;border-left:3px solid #c44848;padding:16px 20px;font-family:'Courier New',monospace;font-size:0.85rem;white-space:pre-wrap;word-break:break-word;color:#1a1d2a;margin-bottom:20px;">${escapeHtml(d.error)}</pre>
  <div style="border-top:1px solid #d4cdb8;padding-top:18px;font-size:0.82rem;color:#646774;line-height:1.55;">
    No post was generated for today. Check Vercel function logs for the full stack trace at <a href="https://vercel.com/limen-helix/allaccesskc/logs" target="_blank" style="color:#8b6914;">vercel.com/limen-helix/allaccesskc/logs</a>. Most common causes: Anthropic credit balance exhausted, Facebook token expired (60-day user tokens), Unsplash rate limited, network outage. The next scheduled run is tomorrow at 15:00 UTC.
  </div>
</div></body></html>`;
}

// ─── Public types ─────────────────────────────────────────────────────
export interface PostResult {
  ok: boolean;
  dryRun: boolean;
  step: string;
  topicIndex?: number;
  topic?: string;
  postText?: string;
  imageKeywords?: string;
  imageUrl?: string;
  fbPostId?: string | null;
  fbResponse?: any;
  emailSent?: boolean;
  emailError?: string;
  operatorAnswer?: string;
  manualModeNote?: string;
  anthropicUsage?: { input_tokens?: number; output_tokens?: number };
  error?: string;
  details?: any;
}

// ─── Entry point ──────────────────────────────────────────────────────
export async function runPost(opts: {
  dryRun: boolean;
  // When true AND dryRun is also true, send the daily-post email anyway.
  // Used by /api/auto-post-test?email=1 to preview the full email pipeline
  // without authenticating against /api/auto-post. Skip the FB POST either
  // way — this is still dry-run for Facebook purposes.
  sendEmailInDryRun?: boolean;
}): Promise<PostResult> {
  let step = "init";
  try {
    // COST PAUSE (2026-06-20): Anthropic spend paused per operator request.
    // Set AUTOPOST_ENABLED back to true to resume the daily generator.
    const AUTOPOST_ENABLED = false;
    if (!AUTOPOST_ENABLED) {
      console.log("[auto-post] PAUSED (AUTOPOST_ENABLED=false) — skipping Anthropic call");
      return { ok: true, dryRun: opts.dryRun, step: "paused" };
    }

    // ── Load topics (bundled at build time) ─────────────────────────
    step = "load_topics";
    const topics = topicsData as string[];
    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error("topics.json is empty or malformed");
    }

    // ── Stateless rotation (2x daily) ───────────────────────────────
    step = "pick_topic";
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - ROTATION_EPOCH) / DAY_MS);
    // Slot detection by UTC hour: split day at 18 UTC (1 PM CDT).
    // Morning cron at 14 UTC -> slotInDay 0. Evening cron at 22 UTC -> slotInDay 1.
    // Any manual invocation also picks the right slot based on time-of-day.
    const slotInDay = now.getUTCHours() < 18 ? 0 : 1;
    const totalSlots = daysSince * 2 + slotInDay;
    const topicIndex = ((totalSlots % topics.length) + topics.length) % topics.length;
    const topic = topics[topicIndex];
    const slotLabel = slotInDay === 0 ? "morning" : "evening";
    console.log(`[auto-post] day ${daysSince} ${slotLabel} -> topic ${topicIndex}/${topics.length}: ${topic}`);

    // ── Anthropic content generation ────────────────────────────────
    step = "anthropic";
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = PROMPT_TEMPLATE.replace("{topic}", topic);
    const message = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join("");
    const usage = message.usage
      ? { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens }
      : undefined;
    console.log(
      `[auto-post] Anthropic returned ${text.length} chars`
        + (usage ? ` (in=${usage.input_tokens} out=${usage.output_tokens})` : "")
    );
    if (!text.trim()) throw new Error("Anthropic returned empty content");

    // ── Parse: post text + final IMAGE_KEYWORDS line ────────────────
    step = "parse";
    const { postText, imageKeywords, operatorAnswer } = parseOutput(text);
    console.log(`[auto-post] keywords: ${imageKeywords}`);
    console.log(`[auto-post] operator answer: ${operatorAnswer}`);
    if (!postText) throw new Error("Parsed post text is empty");

    // ── Unsplash image selection ────────────────────────────────────
    step = "unsplash";
    if (!process.env.UNSPLASH_ACCESS_KEY) throw new Error("UNSPLASH_ACCESS_KEY not set");

    // Anthropic sometimes returns multi-phrase keywords (e.g. "Kansas City
    // skyline, free admission, hidden gem") that don't match any single
    // Unsplash photo. Fall back through progressively simpler queries until
    // we find results. Final fallback "Kansas City" is guaranteed to have
    // photos (Unsplash has thousands of KC images), so the function only
    // errors at this step if Unsplash itself is down.
    const queryCandidates: string[] = [];
    queryCandidates.push(imageKeywords);                                  // try full keywords first
    const parts = imageKeywords.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      queryCandidates.push(parts[0]);                                     // try first phrase only
      const firstWordOnly = parts[0].split(/\s+/)[0];
      if (firstWordOnly && firstWordOnly !== parts[0]) {
        queryCandidates.push(firstWordOnly);                              // try first word only
      }
    }
    queryCandidates.push("Kansas City");                                  // guaranteed fallback

    type UnsplashHit = {
      id: string;
      urls: { regular: string };
      user?: { name?: string };
      links?: { html?: string; download_location?: string };
    };
    let pick: UnsplashHit | null = null;
    let usedQuery = "";
    for (const candidate of queryCandidates) {
      const u = new URL("https://api.unsplash.com/search/photos");
      u.searchParams.set("query", candidate);
      u.searchParams.set("per_page", String(UNSPLASH_PER_PAGE));
      u.searchParams.set("orientation", "landscape");
      u.searchParams.set("content_filter", "high");
      const uRes = await fetch(u.toString(), {
        headers: {
          Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
          "Accept-Version": "v1",
        },
      });
      if (!uRes.ok) {
        // Hard fail (auth, rate limit, server error) — don't try fallbacks
        throw new Error(`Unsplash ${uRes.status}: ${await uRes.text()}`);
      }
      const uJson = (await uRes.json()) as { results: UnsplashHit[] };
      if (uJson.results && uJson.results.length > 0) {
        pick = uJson.results[Math.floor(Math.random() * uJson.results.length)];
        usedQuery = candidate;
        if (candidate !== imageKeywords) {
          console.log(`[auto-post] Unsplash: "${imageKeywords}" returned 0, fell back to "${candidate}"`);
        }
        break;
      }
      console.log(`[auto-post] Unsplash: 0 results for "${candidate}", trying fallback...`);
    }
    if (!pick) {
      throw new Error(`Unsplash returned 0 results for all queries (tried: ${queryCandidates.join(" | ")})`);
    }
    const imageUrl = pick.urls.regular;
    console.log(`[auto-post] image: ${imageUrl} (id=${pick.id}, query="${usedQuery}")`);

    // ── Unsplash download tracking (REQUIRED by API guidelines) ─────
    // Per Unsplash API Guidelines, any download or use of a photo must
    // trigger a GET to the photo's download_location endpoint. This bumps
    // the photographer's download count and is a TOS requirement for
    // production apps. Fire-and-forget semantics: we don't act on the
    // result, but we briefly await so the request actually executes
    // before the serverless function exits (unawaited promises can be
    // killed on response).
    const downloadTrigger = pick.links?.download_location;
    if (downloadTrigger) {
      try {
        await fetch(downloadTrigger, {
          headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
        });
        console.log(`[auto-post] Unsplash download tracked`);
      } catch (err: any) {
        // Non-fatal — tracking failure shouldn't block the post.
        console.warn(`[auto-post] Unsplash download tracking failed (non-fatal): ${err?.message || err}`);
      }
    } else {
      console.warn(`[auto-post] Unsplash result missing links.download_location; tracking skipped`);
    }

    // ── Dry-run short-circuit ───────────────────────────────────────
    if (opts.dryRun) {
      // Optionally send the email anyway — used by /api/auto-post-test?email=1
      // to preview the daily email without hitting the auth-protected
      // production endpoint. Default is to skip email on dry-run to prevent
      // inbox spam during testing iterations.
      let emailSent = false;
      let emailError: string | undefined;
      if (opts.sendEmailInDryRun && process.env.RESEND_API_KEY) {
        const r = await sendNotificationEmail({
          subject: `[All Access KC] Daily post preview — ${topic}`,
          html: buildSuccessEmailHtml({
            topic,
            topicIndex,
            totalTopics: topics.length,
            postText,
            imageKeywords,
            imageUrl,
            operatorAnswer,
          }),
        });
        emailSent = r.sent;
        emailError = r.error;
        console.log(`[auto-post] dry-run email: ${r.sent ? "sent (id=" + r.id + ")" : "FAILED — " + r.error}`);
      }
      return {
        ok: true,
        dryRun: true,
        step: "dry_run_complete",
        topicIndex,
        topic,
        postText,
        imageKeywords,
        imageUrl,
        operatorAnswer,
        emailSent,
        emailError,
        anthropicUsage: usage,
      };
    }

    // ── Manual-mode gate ────────────────────────────────────────────
    // FB_POSTING_ENABLED must be exactly "true" to actually publish to
    // Facebook. Anything else (unset, "false", empty) puts us in manual
    // mode: skip the FB POST, log the generated content prominently to
    // stdout (visible in Vercel runtime logs), and return everything in
    // the response body so the operator can copy + post manually.
    //
    // KILL_SWITCH still short-circuits ABOVE this — it's checked in
    // auto-post.ts before runPost() is even called.
    const fbPostingEnabled =
      (process.env.FB_POSTING_ENABLED || "").toLowerCase() === "true";

    if (!fbPostingEnabled) {
      step = "manual_mode";
      // Big, clearly-delimited block in the logs so it's easy to grab.
      console.log("[auto-post] ============ MANUAL MODE — POST CONTENT ============");
      console.log(`[auto-post] TOPIC: ${topic}`);
      console.log(`[auto-post] IMAGE: ${imageUrl}`);
      console.log(`[auto-post] KEYWORDS: ${imageKeywords}`);
      console.log("[auto-post] ----- POST TEXT -----");
      console.log(postText);
      console.log("[auto-post] ====================================================");

      // Send the daily post to info@allaccesskc.com (or NOTIFY_EMAIL) if
      // Resend is configured. Failure to send is logged but does not fail
      // the run — content is also returned in the response + Vercel logs.
      let emailSent = false;
      let emailError: string | undefined;
      if (process.env.RESEND_API_KEY) {
        const r = await sendNotificationEmail({
          subject: `[All Access KC] Daily post — ${topic}`,
          html: buildSuccessEmailHtml({
            topic,
            topicIndex,
            totalTopics: topics.length,
            postText,
            imageKeywords,
            imageUrl,
            operatorAnswer,
          }),
        });
        emailSent = r.sent;
        emailError = r.error;
        console.log(`[auto-post] email: ${r.sent ? "sent (id=" + r.id + ")" : "FAILED — " + r.error}`);
      } else {
        console.log("[auto-post] email: skipped (RESEND_API_KEY not set)");
      }

      return {
        ok: true,
        dryRun: false,
        step: "complete_manual_mode",
        topicIndex,
        topic,
        postText,
        imageKeywords,
        imageUrl,
        operatorAnswer,
        fbPostId: null,
        emailSent,
        emailError,
        // emailSent: when true, the post content was emailed via Resend to
        // NOTIFY_EMAIL (or info@allaccesskc.com by default). When false,
        // check that RESEND_API_KEY is set and the sender domain is verified.
        manualModeNote:
          "FB_POSTING_ENABLED is not 'true' — generated content above is for manual posting. Copy postText + imageUrl from this response, your email inbox, or Vercel function logs.",
        anthropicUsage: usage,
      };
    }

    // ── Facebook Graph API post (only reached when FB_POSTING_ENABLED=true) ─
    step = "facebook";
    if (!process.env.FB_PAGE_ID) throw new Error("FB_PAGE_ID not set");
    if (!process.env.FB_PAGE_ACCESS_TOKEN) throw new Error("FB_PAGE_ACCESS_TOKEN not set");
    const fbUrl = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${encodeURIComponent(process.env.FB_PAGE_ID)}/photos`;
    const fbBody = new URLSearchParams({
      url: imageUrl,
      caption: postText,
      access_token: process.env.FB_PAGE_ACCESS_TOKEN,
    });
    // We deliberately do NOT retry on FB failure — duplicate posts are worse
    // than a missed post (per project spec).
    const fbRes = await fetch(fbUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: fbBody.toString(),
    });
    const fbJson = (await fbRes.json()) as any;
    if (!fbRes.ok) {
      throw new Error(`Facebook ${fbRes.status}: ${JSON.stringify(fbJson)}`);
    }
    const fbPostId = fbJson.post_id || fbJson.id;
    console.log(`[auto-post] FB post id: ${fbPostId}`);

    // ── Phase 2 audit log (slot reserved) ───────────────────────────
    // To persist a long-term audit log, this is where you'd write to
    // Vercel KV. Sketch:
    //   import { kv } from "@vercel/kv";
    //   await kv.lpush("autopost:history", { ts: Date.now(), topicIndex, fbPostId, imageUrl });
    //   await kv.set("autopost:lastTopicIndex", topicIndex);
    // Until then, Vercel function logs (~30 day retention) are the audit.

    // ── Phase 2 blog generation (slot reserved) ─────────────────────
    // To also publish each post as /blog/{slug}.html, this is where you'd
    // POST the rendered HTML to the GitHub Contents API. Out of scope.

    return {
      ok: true,
      dryRun: false,
      step: "complete",
      topicIndex,
      topic,
      postText,
      imageKeywords,
      imageUrl,
      operatorAnswer,
      fbPostId,
      fbResponse: fbJson,
      anthropicUsage: usage,
    };
  } catch (err: any) {
    const errStr = err?.message || String(err);
    console.error(`[auto-post] failure at step "${step}": ${errStr}`);

    // Failure-alert email — only for production runs (cron-triggered), not
    // dry-run testing. Skips silently if RESEND_API_KEY isn't set or the
    // send itself fails. We never want failure-email failure to compound.
    if (!opts.dryRun && process.env.RESEND_API_KEY) {
      try {
        await sendNotificationEmail({
          subject: `[All Access KC] Auto-post FAILED at step "${step}"`,
          html: buildFailureEmailHtml({ step, error: errStr }),
        });
      } catch (_emailErr) {
        // Already in failure path; don't compound.
      }
    }

    return {
      ok: false,
      dryRun: opts.dryRun,
      step,
      error: errStr,
      details: serializeErr(err),
    };
  }
}

// ─── Output parsing ───────────────────────────────────────────────────
function parseOutput(raw: string): {
  postText: string;
  imageKeywords: string;
  operatorAnswer: string;
} {
  const lines = raw.trim().split(/\r?\n/);
  let kwLineIdx = -1;
  let answerLineIdx = -1;
  let imageKeywords = "Kansas City"; // safe fallback
  let operatorAnswer = "(model did not include OPERATOR_ANSWER line — verify manually)";

  // Scan from the end; both meta lines should be near the bottom.
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (answerLineIdx === -1) {
      const am = trimmed.match(/^OPERATOR[_\s]*ANSWER:\s*(.+)$/i);
      if (am) {
        answerLineIdx = i;
        operatorAnswer = am[1].trim();
        continue;
      }
    }
    if (kwLineIdx === -1) {
      const km = trimmed.match(/^IMAGE[_\s]*KEYWORDS:\s*(.+)$/i);
      if (km) {
        kwLineIdx = i;
        imageKeywords = km[1].trim();
        continue;
      }
    }
    if (kwLineIdx !== -1 && answerLineIdx !== -1) break;
  }

  // Post text = everything BEFORE the earliest meta line (so neither
  // IMAGE_KEYWORDS nor OPERATOR_ANSWER leaks into the FB post).
  let cutAt = lines.length;
  if (kwLineIdx >= 0) cutAt = Math.min(cutAt, kwLineIdx);
  if (answerLineIdx >= 0) cutAt = Math.min(cutAt, answerLineIdx);

  const postText = lines.slice(0, cutAt).join("\n").trim();
  return { postText, imageKeywords, operatorAnswer };
}

function serializeErr(err: any): any {
  if (!err) return null;
  if (typeof err === "string") return err;
  const out: any = { message: err.message, name: err.name };
  if (err.status) out.status = err.status;
  if (err.error) out.error = err.error;
  return out;
}
