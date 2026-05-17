# All Access KC

The local's $5 visitor guide to Kansas City. Restaurants, bars, neighborhoods, itineraries, transit, parking. Written by locals. Updated weekly.

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing / sales page ($5 purchase entry) |
| `kc-guide.html` | The paid guide itself (tabs: Events, Eat, Drink, Watch, Game Day, Explore, Itineraries, Travel) |
| `kc-thanks.html` | Post-purchase unlock confirmation |
| `privacy.html` · `terms.html` · `refund.html` | Legal pages |
| `kc-skyline.jpg` | Hero image used by index.html (add separately) |
| `kc-skyline-2.jpg` | Hero image used by kc-thanks.html (add separately) |

## Deployment

Static site — no build step required. Vercel auto-detects HTML.

- **Domain:** allaccesskc.com
- **Stack:** plain HTML/CSS/JS, single file per page
- **i18n:** 16 languages via live Google Translate fallback (kc-guide.html) + minimal static dictionary (index.html, kc-thanks.html)

## Brand notes

- Brand name: **All Access KC**
- Headline: "Welcome to Kansas City"
- Email: info@allaccesskc.com
- Permanent KC visitor guide — not tied to any single event or tournament
- Not affiliated with any sports league, federation, tournament organizer, or municipal government

## Local preview

Open any of the three HTML files directly in a browser — no server required.

## Auto-post (daily Facebook teaser)

`/api/auto-post.ts` is a Vercel serverless function that fires **every day at 15:00 UTC** (10 AM CDT / 9 AM CST) per the cron in `vercel.json`. It rotates through `api/topics.json` (currently 75 prompts → each topic repeats every ~2.5 months), generates a curiosity-gap teaser via Anthropic, picks a matching Unsplash image, and posts to the AllAccessKC Facebook page.

**Topic rotation is stateless** — derived from day-of-epoch against a fixed anchor (`2026-05-17`) — so no database or KV is required. Each daily run produces a deterministic topic index, so reruns on the same day pick the same topic (useful for testing). Audit log lives in Vercel function logs (~30-day retention). To add persistent audit logs later, see the "Phase 2 audit log" marker in `api/_shared.ts`.

**Cycle length:** with N topics in `topics.json`, the same topic returns every N days. 75 topics ≈ once every 2.5 months. The Anthropic prompt includes an `ANTI-REPETITION` instruction so re-visits of the same topic shift angle/opening/phrasing. For true content-level anti-repetition (avoid actual phrase reuse), you'd need to persist past outputs and feed them into future prompts — a Vercel KV add-on, not currently wired.

### Endpoints

| Path | Purpose | Auth |
|---|---|---|
| `/api/auto-post` | Production endpoint — invoked by Vercel cron | `Authorization: Bearer ${CRON_SECRET}` |
| `/api/auto-post-test` | Dry-run preview — generates post + image but does NOT post to Facebook | None (forced dry-run) |

### Required environment variables (set in Vercel dashboard)

| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | `sk-ant-...` — console.anthropic.com |
| `UNSPLASH_ACCESS_KEY` | yes | Unsplash app access key — unsplash.com/developers |
| `FB_PAGE_ID` | yes | Numeric Facebook page ID (not the @handle) |
| `FB_PAGE_ACCESS_TOKEN` | yes | Long-lived page access token. User tokens expire in 60 days — use Meta Business Suite system-user flow for a permanent token. |
| `CRON_SECRET` | yes | Random string. Vercel auto-attaches `Authorization: Bearer ${CRON_SECRET}` to cron invocations once this is set. |
| `KILL_SWITCH` | no | Set to `true` to pause posting without redeploying. Default: off. |
| `DRY_RUN` | no | Set to `true` to make the production endpoint also dry-run (won't post to FB). Default: off. |

### Testing before going live

After deploying and setting env vars, hit `https://allaccesskc.com/api/auto-post-test` (or your `*.vercel.app` URL). Returns JSON with the generated `topic`, `postText`, `imageKeywords`, and `imageUrl`. Reload to roll new variants (temperature is 0.8). No Facebook post is made.

### Pausing

Set `KILL_SWITCH=true` in the Vercel dashboard env vars. Takes effect immediately on next invocation, no redeploy needed. Set back to anything else to resume.

### Cost (daily cadence)

- Anthropic: ~1 message/day × ~$0.01 = ~$4/year
- Unsplash: free (50 requests/hour limit; we use 1/day)
- Facebook Graph: free
- Vercel cron + serverless: free tier covers this volume

Total: under $5/year.

### Editing the rotation

Edit `api/topics.json` — array of strings, one prompt per topic. Order matters; the function picks `topics[daysSinceEpoch mod topics.length]` each day. Adding/removing an entry shifts every future rotation by one notch.

