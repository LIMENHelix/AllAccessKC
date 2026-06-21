// /api/feeds.ts
//
// Live Kansas City feeds — aggregates free public RSS/Atom sources server-side
// (browsers can't fetch most of these directly due to CORS) and returns clean
// JSON grouped by category: news, events, sports, food.
//
// No API keys. Every source is a free public feed. Failures are swallowed
// per-source (Promise.allSettled) so one dead feed never blanks the page; if
// EVERYTHING fails, a small static fallback keeps the UI populated.
//
// In-memory cached ~15 min per warm instance — keeps us polite to the sources
// and fast for visitors. There is no KV in this project, so the cache is
// best-effort per Lambda instance (fine for a low-traffic public page).
//
// Hit: https://allaccesskc.com/api/feeds

import type { VercelRequest, VercelResponse } from "@vercel/node";

type Cat = "news" | "events" | "sports" | "food";

interface Source {
  cat: Cat;
  source: string;
  url: string;
}

interface Item {
  cat: Cat;
  source: string;
  title: string;
  link: string;
  date: string | null; // ISO
  ts: number; // epoch ms for sorting, 0 if unknown
}

// All verified live 2026-06-19. RSS (<item>) and Atom (<entry>) both handled.
const SOURCES: Source[] = [
  { cat: "news", source: "FOX4 KC", url: "https://fox4kc.com/feed/" },
  { cat: "news", source: "KSHB 41", url: "https://www.kshb.com/index.rss" },
  { cat: "news", source: "Startland News", url: "https://www.startlandnews.com/feed/" },
  { cat: "events", source: "Visit KC", url: "https://www.visitkc.com/events/rss" },
  { cat: "sports", source: "Arrowhead Pride (Chiefs)", url: "https://www.arrowheadpride.com/rss/index.xml" },
  { cat: "sports", source: "Royals Review", url: "https://www.royalsreview.com/rss/index.xml" },
  { cat: "food", source: "The Pitch", url: "https://www.thepitchkc.com/feed/" },
];

const PER_SOURCE = 5; // max items kept per source
const PER_CAT = 8; // max items returned per category
const CACHE_MS = 15 * 60 * 1000;

// Module-level cache (persists across invocations on a warm instance).
let CACHE: { at: number; payload: any } | null = null;

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "") // strip any stray inline tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ""; }
    })
    .replace(/\s+/g, " ")
    .trim();
}

function pick(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1] : null;
}

function pickLink(block: string): string | null {
  // RSS: <link>URL</link>
  const rss = block.match(/<link>\s*([\s\S]*?)\s*<\/link>/i);
  if (rss && rss[1].trim().startsWith("http")) return rss[1].trim();
  // Atom: prefer rel="alternate", else first <link ... href="...">
  const alts = [...block.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/gi)];
  if (alts.length) {
    const alt = alts.find((a) => /rel="alternate"/i.test(a[0])) || alts[0];
    return alt[1];
  }
  return null;
}

function parse(xml: string, src: Source): Item[] {
  const out: Item[] = [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blocks = isAtom
    ? [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)]
    : [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)];
  for (const b of blocks) {
    const block = b[0];
    const rawTitle = pick(block, "title");
    const title = rawTitle ? decode(rawTitle) : "";
    const link = pickLink(block);
    if (!title || !link) continue;
    const rawDate =
      pick(block, "pubDate") ||
      pick(block, "published") ||
      pick(block, "updated") ||
      pick(block, "dc:date");
    let date: string | null = null;
    let ts = 0;
    if (rawDate) {
      const d = new Date(rawDate.trim());
      if (!isNaN(d.getTime())) { date = d.toISOString(); ts = d.getTime(); }
    }
    out.push({ cat: src.cat, source: src.source, title, link: link.trim(), date, ts });
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

async function fetchSource(src: Source): Promise<Item[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(src.url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AllAccessKC/1.0; +https://allaccesskc.com)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parse(xml, src);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

const FALLBACK = {
  news: [
    { source: "All Access KC", title: "Live KC news feed is refreshing — check back in a moment.", link: "https://allaccesskc.com/", date: null },
  ],
  events: [
    { source: "Visit KC", title: "See what's on in Kansas City", link: "https://www.visitkc.com/events", date: null },
  ],
  sports: [
    { source: "All Access KC", title: "Chiefs · Royals · Sporting KC — schedules and matchday tips in the guide", link: "/kc-guide.html#matchday", date: null },
  ],
  food: [
    { source: "All Access KC", title: "Where locals actually eat — see the full food guide", link: "/kc-guide.html#eat", date: null },
  ],
};

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=1800");

  try {
    if (CACHE && Date.now() - CACHE.at < CACHE_MS) {
      return res.status(200).json({ ...CACHE.payload, cached: true });
    }

    const results = await Promise.allSettled(SOURCES.map(fetchSource));
    const all: Item[] = [];
    results.forEach((r) => { if (r.status === "fulfilled") all.push(...r.value); });

    const grouped: Record<Cat, any[]> = { news: [], events: [], sports: [], food: [] };
    (["news", "events", "sports", "food"] as Cat[]).forEach((cat) => {
      const items = all
        .filter((i) => i.cat === cat)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, PER_CAT)
        .map(({ source, title, link, date }) => ({ source, title, link, date }));
      grouped[cat] = items.length ? items : (FALLBACK as any)[cat];
    });

    const payload = {
      ok: true,
      updated: new Date().toISOString(),
      cached: false,
      categories: grouped,
    };
    CACHE = { at: Date.now(), payload };
    return res.status(200).json(payload);
  } catch (err: any) {
    // Never blank the page — return fallback on any unexpected failure.
    return res.status(200).json({
      ok: false,
      updated: new Date().toISOString(),
      error: err?.message || String(err),
      categories: FALLBACK,
    });
  }
}
