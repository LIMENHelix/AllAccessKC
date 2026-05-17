// /api/_shared.ts
//
// Core pipeline for the AllAccessKC weekly Facebook auto-post.
// Imported by /api/auto-post.ts (production) and /api/auto-post-test.ts (dry-run).
// Files in /api whose name starts with _ are treated as non-routes by Vercel.
//
// Architecture: stateless rotation.
//   topicIndex = floor((now - ANCHOR) / 1 week) mod topics.length
// No filesystem writes (Vercel serverless filesystem is read-only outside /tmp).
// Audit log lives in Vercel function logs (~30 day retention).
// If long-term persistence is desired later: bolt on @vercel/kv at the
// "Phase 2 audit log" marker below.

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";

// ─── Configuration ────────────────────────────────────────────────────
const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 600;
const TEMPERATURE = 0.8;
const FB_GRAPH_VERSION = "v22.0";
const UNSPLASH_PER_PAGE = 10;

// Anchor for the deterministic rotation. The first Sunday after this anchor
// posts topic index 0; the next Sunday posts index 1; etc. Changing this
// constant shifts every future post — only change in tandem with topics.json.
const ROTATION_EPOCH = new Date("2026-05-17T00:00:00Z").getTime();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Verbatim prompt from project spec. Keep "{topic}" placeholder; do not edit.
const PROMPT_TEMPLATE = `You are Alex, a Kansas City local writing a Facebook post for AllAccessKC, a paid $5 visitor guide.

CRITICAL: Tease, don't tell. Make readers curious enough to pay $5. Do NOT name specific places. Do NOT give away the answer.

TOPIC: {topic}

STRUCTURE (120-150 words):
1. Open with a problem/scenario visitors face
2. Hint that locals know a smart way to handle it
3. End with: "Full breakdown at allaccesskc.com"

VOICE: Direct, warm, like texting a friend. No corporate buzzwords. No hashtags. Max one emoji.

FORBIDDEN: Naming specific restaurants/bars. Words: FIFA, World Cup, Mundial, Copa, official.

OUTPUT FORMAT:
Line 1-N: The post text
Last line (separate): IMAGE_KEYWORDS: word1, word2, word3`;

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
  fbPostId?: string;
  fbResponse?: any;
  anthropicUsage?: { input_tokens?: number; output_tokens?: number };
  error?: string;
  details?: any;
}

// ─── Entry point ──────────────────────────────────────────────────────
export async function runPost(opts: { dryRun: boolean }): Promise<PostResult> {
  let step = "init";
  try {
    // ── Load topics from disk (read-only is fine on serverless) ─────
    step = "load_topics";
    const topicsPath = path.join(process.cwd(), "api", "topics.json");
    const topicsRaw = await fs.readFile(topicsPath, "utf8");
    const topics: string[] = JSON.parse(topicsRaw);
    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error("topics.json is empty or malformed");
    }

    // ── Stateless rotation ──────────────────────────────────────────
    step = "pick_topic";
    const weeksSince = Math.floor((Date.now() - ROTATION_EPOCH) / WEEK_MS);
    const topicIndex = ((weeksSince % topics.length) + topics.length) % topics.length;
    const topic = topics[topicIndex];
    console.log(`[auto-post] week ${weeksSince} -> topic ${topicIndex}/${topics.length}: ${topic}`);

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
    const { postText, imageKeywords } = parseOutput(text);
    console.log(`[auto-post] keywords: ${imageKeywords}`);
    if (!postText) throw new Error("Parsed post text is empty");

    // ── Unsplash image selection ────────────────────────────────────
    step = "unsplash";
    if (!process.env.UNSPLASH_ACCESS_KEY) throw new Error("UNSPLASH_ACCESS_KEY not set");
    const u = new URL("https://api.unsplash.com/search/photos");
    u.searchParams.set("query", imageKeywords);
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
      throw new Error(`Unsplash ${uRes.status}: ${await uRes.text()}`);
    }
    const uJson = (await uRes.json()) as {
      results: Array<{ urls: { regular: string }; user?: { name?: string }; links?: { html?: string } }>;
    };
    if (!uJson.results || uJson.results.length === 0) {
      throw new Error(`Unsplash returned 0 results for "${imageKeywords}"`);
    }
    const pick = uJson.results[Math.floor(Math.random() * uJson.results.length)];
    const imageUrl = pick.urls.regular;
    console.log(`[auto-post] image: ${imageUrl}`);

    // ── Dry-run short-circuit ───────────────────────────────────────
    if (opts.dryRun) {
      return {
        ok: true,
        dryRun: true,
        step: "dry_run_complete",
        topicIndex,
        topic,
        postText,
        imageKeywords,
        imageUrl,
        anthropicUsage: usage,
      };
    }

    // ── Facebook Graph API post ─────────────────────────────────────
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
      fbPostId,
      fbResponse: fbJson,
      anthropicUsage: usage,
    };
  } catch (err: any) {
    const errStr = err?.message || String(err);
    console.error(`[auto-post] failure at step "${step}": ${errStr}`);
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
function parseOutput(raw: string): { postText: string; imageKeywords: string } {
  const lines = raw.trim().split(/\r?\n/);
  // Scan from the end for the IMAGE_KEYWORDS line (model may add trailing
  // blank lines or extra whitespace).
  let kwLineIdx = -1;
  let imageKeywords = "Kansas City"; // safe fallback
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(/^IMAGE_KEYWORDS:\s*(.+)$/i);
    if (m) {
      kwLineIdx = i;
      imageKeywords = m[1].trim();
      break;
    }
  }
  const postText =
    kwLineIdx >= 0
      ? lines.slice(0, kwLineIdx).join("\n").trim()
      : raw.trim();
  return { postText, imageKeywords };
}

function serializeErr(err: any): any {
  if (!err) return null;
  if (typeof err === "string") return err;
  const out: any = { message: err.message, name: err.name };
  if (err.status) out.status = err.status;
  if (err.error) out.error = err.error;
  return out;
}
