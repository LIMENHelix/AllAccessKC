// /api/board.ts
//
// One generic, Postgres-backed board powering ALL of AllAccessKC's
// user-generated surfaces: chat rooms, the classifieds/yard-sale market, and
// the KC singles board. One endpoint, one table, a `board` + `channel` key.
//
//   GET  /api/board?board=rooms&channel=chiefs&limit=60
//        -> 200 { ok, live, posts:[{id,alias,text,payload,ts}] }   (chronological)
//   POST /api/board { board, channel, alias, text, payload }
//        -> 200 { ok, post } | 4xx/5xx { ok:false, error }
//
// Storage: Neon Postgres via @vercel/postgres (auto-reads POSTGRES_URL). If no
// database is attached, GET returns an empty feed and POST returns a friendly
// "warming up" message — nothing hard-errors.
//
// boards/channels in use:
//   rooms   : general | chiefs | royals | soccer | foodies | newcomers | nightlife | tailgate
//   market  : for-sale | yard-sale | free | wanted | housing | gigs
//   singles : women | men | everyone | friends

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "@vercel/postgres";

const KEEP_PER = 500;   // rows retained per (board, channel)
const RETURN = 80;
const MAX_TEXT = 1000;
const MAX_ALIAS = 28;
const MAX_FIELD = 300;  // per payload string field (room for image URLs)

// Allow-list so the endpoint can't be turned into an open key-value store.
const BOARDS: Record<string, string[]> = {
  rooms:   ["general", "chiefs", "royals", "soccer", "foodies", "newcomers", "nightlife", "tailgate"],
  market:  ["for-sale", "yard-sale", "free", "wanted", "housing", "gigs"],
  singles: ["women", "men", "everyone", "friends"],
};

// Per-IP, in-memory backstop (best-effort per warm instance).
const POST_MIN_GAP_MS = 1500;
const POST_PER_HOUR = 60;
const ipPosts: Map<string, number[]> = new Map();
const ipLast: Map<string, number> = new Map();

const KC_PLACES = ["Westport","Brookside","Waldo","Crossroads","Plaza","Northland","Midtown","Westside","River Market","Crown Center","Columbus Park","Strawberry Hill","Hyde Park","Martini Corner","Volker","Quindaro","Parkville","Gladstone","Riverside","Sugar Creek","Burnt End","Boulevard","Fountain","Royal","Chiefs","Sporting","Streetcar","Arrowhead","Kauffman","Shuttlecock","Scout","Jazz","Brisket","Z-Man","Ribs","Loose Park"];
const KC_NAMES = ["Benny","Barb","Bo","Betty","Charlie","Cleo","Dot","Earl","Faye","Gus","Hank","Ida","Jax","Kit","Lou","Mabel","Ned","Otis","Pearl","Quinn","Rae","Sal","Tess","Vic","Wally","Willa","Zeke","Marty","Stan","Roy","June","Hattie","Cliff","Rufus","Della","Moe","Pete","Stella","Hazel","Gene"];
function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function kcAlias(): string {
  const place = pick(KC_PLACES);
  const want = place.replace(/[^a-z]/i, "").charAt(0).toUpperCase();
  let name: string;
  if (Math.random() < 0.6) { const m = KC_NAMES.filter((n) => n.charAt(0).toUpperCase() === want); name = m.length ? pick(m) : pick(KC_NAMES); }
  else name = pick(KC_NAMES);
  return `${place} ${name}`;
}

const BANNED = /\b(fuck|shit|bitch|cunt|nigger|faggot|asshole|dick|pussy|whore|slut)\w*/gi;
function clean(s: string): string { return s.replace(BANNED, (m) => m[0] + "*".repeat(Math.max(1, m.length - 1))); }
function s(raw: unknown, max: number): string {
  return clean(String(raw ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/[^\S\n]{3,}/g, "  ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max));
}
function sanitizeAlias(raw: unknown): string {
  const t = String(raw ?? "").replace(/[^\w .'\-]/g, "").replace(/\s{2,}/g, " ").trim().slice(0, MAX_ALIAS);
  return t.length >= 2 ? clean(t) : kcAlias();
}
function sanitizePayload(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n++ >= 12) break;
    if (typeof v !== "string" && typeof v !== "number") continue;
    const key = k.replace(/[^\w]/g, "").slice(0, 24);
    if (key) out[key] = s(v, MAX_FIELD);
  }
  return out;
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd || "";
  return (raw.split(",")[0] || "unknown").trim() || "unknown";
}
function dbConfigured(): boolean { return !!(process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING); }

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = sql`
      CREATE TABLE IF NOT EXISTS kc_board (
        id      BIGSERIAL PRIMARY KEY,
        board   TEXT   NOT NULL,
        channel TEXT   NOT NULL,
        alias   TEXT   NOT NULL,
        body    TEXT   NOT NULL DEFAULT '',
        payload JSONB  NOT NULL DEFAULT '{}',
        ts      BIGINT NOT NULL
      )
    `.then(() => sql`CREATE INDEX IF NOT EXISTS kc_board_bc ON kc_board (board, channel, id DESC)`)
     .then(() => undefined)
     .catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

function rateLimited(ip: string): string | null {
  const now = Date.now();
  if (now - (ipLast.get(ip) || 0) < POST_MIN_GAP_MS) return "Easy there — a couple seconds between posts.";
  const hits = (ipPosts.get(ip) || []).filter((t) => now - t < 3600_000);
  if (hits.length >= POST_PER_HOUR) return "You've posted a lot this hour — take a breather.";
  hits.push(now); ipPosts.set(ip, hits); ipLast.set(ip, now);
  if (ipPosts.size > 5000) for (const [k, v] of ipPosts) { const live = v.filter((t) => now - t < 3600_000); if (live.length) ipPosts.set(k, live); else { ipPosts.delete(k); ipLast.delete(k); } }
  return null;
}

function valid(board: string, channel: string): boolean {
  return !!BOARDS[board] && BOARDS[board].includes(channel);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const live = dbConfigured();

  if (req.method === "GET") {
    const board = String(req.query.board || "");
    const channel = String(req.query.channel || "");
    if (!valid(board, channel)) return res.status(400).json({ ok: false, error: "Unknown board/channel" });
    if (!live) return res.status(200).json({ ok: true, live: false, posts: [] });
    try {
      await ensureTable();
      const { rows } = await sql`
        SELECT id, alias, body, payload, ts FROM kc_board
        WHERE board = ${board} AND channel = ${channel}
        ORDER BY id DESC LIMIT ${RETURN}`;
      const posts = rows.reverse().map((r: any) => ({ id: String(r.id), alias: r.alias, text: r.body, payload: r.payload || {}, ts: Number(r.ts) }));
      return res.status(200).json({ ok: true, live: true, posts });
    } catch (err: any) {
      return res.status(200).json({ ok: true, live: false, posts: [], error: err?.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (process.env.KILL_SWITCH) return res.status(503).json({ ok: false, error: "Posting is paused right now — check back soon." });
  if (!live) return res.status(503).json({ ok: false, error: "The boards are warming up — not switched on yet. Try again soon!" });

  let body: any = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  // ── TEMP one-time maintenance (guarded by SEED_TOKEN env; remove after seeding) ──
  if (body && process.env.SEED_TOKEN && body.__admin === process.env.SEED_TOKEN && body.op === "reseed" && Array.isArray(body.rows)) {
    try {
      await ensureTable();
      await sql`DELETE FROM kc_board`;
      let t = Date.now();
      for (const r of body.rows) {
        await sql`INSERT INTO kc_board (board, channel, alias, body, payload, ts)
                  VALUES (${String(r.board)}, ${String(r.channel)}, ${String(r.alias || "KC Local")}, ${String(r.text || "")}, ${JSON.stringify(r.payload || {})}::jsonb, ${t++})`;
      }
      return res.status(200).json({ ok: true, reseeded: body.rows.length });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  }

  const board = String(body?.board || "");
  const channel = String(body?.channel || "");
  if (!valid(board, channel)) return res.status(400).json({ ok: false, error: "Unknown board/channel" });

  const text = s(body?.text, MAX_TEXT);
  const payload = sanitizePayload(body?.payload);
  // rooms need text; market/singles need either text or a title in payload
  if (!text && !payload.title && !payload.about) return res.status(400).json({ ok: false, error: "Say something first 🙂" });
  const alias = sanitizeAlias(body?.alias);

  const ip = clientIp(req);
  const limit = rateLimited(ip);
  if (limit) return res.status(429).json({ ok: false, error: limit });

  const ts = Date.now();
  try {
    await ensureTable();
    const { rows } = await sql`
      INSERT INTO kc_board (board, channel, alias, body, payload, ts)
      VALUES (${board}, ${channel}, ${alias}, ${text}, ${JSON.stringify(payload)}::jsonb, ${ts})
      RETURNING id`;
    const id = String(rows[0]?.id);
    if (Math.random() < 0.1) {
      await sql`
        DELETE FROM kc_board WHERE board = ${board} AND channel = ${channel}
        AND id < (SELECT MIN(id) FROM (SELECT id FROM kc_board WHERE board = ${board} AND channel = ${channel} ORDER BY id DESC LIMIT ${KEEP_PER}) t)`;
    }
    return res.status(200).json({ ok: true, post: { id, alias, text, payload, ts } });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: "Couldn't post that — try again in a moment." });
  }
}
