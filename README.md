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

`/api/auto-post.ts` is a Vercel serverless function that fires **twice daily** — at **14:00 UTC (9 AM CDT)** and **22:00 UTC (5 PM CDT)** — per the cron in `vercel.json`. It rotates through `api/topics.json` (currently 75 prompts → each topic repeats every ~37 days at 2x cadence), generates a curiosity-gap teaser via Anthropic, picks a matching Unsplash image, emails the content to `info@allaccesskc.com`, and optionally posts to the AllAccessKC Facebook page (when `FB_POSTING_ENABLED=true`).

**Topic rotation is stateless** — derived from day-of-epoch against a fixed anchor (`2026-05-17`), split into morning/evening slots by UTC hour (<18 = morning, ≥18 = evening). The morning and evening posts each day get DIFFERENT topics (sequential indices in the rotation), so the two daily posts never repeat content within a 24-hour window. No database or KV is required. Audit log lives in Vercel function logs (~30-day retention). To add persistent audit logs later, see the "Phase 2 audit log" marker in `api/_shared.ts`.

**Cycle length:** with N topics in `topics.json` and 2 posts/day, the same topic returns every N/2 days. 75 topics ≈ once every 37 days (~5.4 weeks). The Anthropic prompt includes an `ANTI-REPETITION` instruction so re-visits of the same topic shift angle/opening/phrasing. For true content-level anti-repetition (avoid actual phrase reuse), you'd need to persist past outputs and feed them into future prompts — a Vercel KV add-on, not currently wired.

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
| `KILL_SWITCH` | no | Set to `true` to short-circuit the whole pipeline (no Anthropic call, no Unsplash call, no FB post). Default: off. |
| `DRY_RUN` | no | Set to `true` to make the production endpoint also dry-run (runs Anthropic + Unsplash, returns preview, never touches FB). Default: off. |
| `FB_POSTING_ENABLED` | no | **Must be exactly `"true"` to actually publish to Facebook.** Anything else (unset, `"false"`, empty) puts the pipeline in **manual mode**: generates the post + image, logs everything to Vercel function logs, returns the content in the response body, and skips the FB POST. Use this to run the cron daily for content generation while you handle posting manually. |
| `RESEND_API_KEY` | no | Resend API key (resend.com → API keys). When set, the cron emails the daily post content to the operator on success and emails an alert on failure. When unset, falls back to log-only. |
| `NOTIFY_EMAIL` | no | Recipient address for daily-post + failure-alert emails. Default: `info@allaccesskc.com`. |
| `EMAIL_FROM` | no | Sender for Resend emails. Default: `All Access KC <noreply@allaccesskc.com>`. Domain must be verified on Resend (SPF + DKIM DNS records). |

### Testing before going live

After deploying and setting env vars, hit `https://allaccesskc.com/api/auto-post-test` (or your `*.vercel.app` URL). Returns JSON with the generated `topic`, `postText`, `imageKeywords`, and `imageUrl`. Reload to roll new variants (temperature is 0.8). No Facebook post is made.

### Pausing

Set `KILL_SWITCH=true` in the Vercel dashboard env vars. Takes effect immediately on next invocation, no redeploy needed. Set back to anything else to resume.

### Cost (2x daily cadence)

- Anthropic: ~2 messages/day × ~$0.003 = ~$2.20/year
- Unsplash: free (50 requests/hour limit; we use 2/day)
- Resend: free tier (3,000 emails/month covers 730/year + headroom)
- Facebook Graph: free
- Vercel cron + serverless: free tier covers this volume

Total: ~$2–5/year.

### Editing the rotation

Edit `api/topics.json` — array of strings, one prompt per topic. Order matters; the function picks `topics[daysSinceEpoch mod topics.length]` each day. Adding/removing an entry shifts every future rotation by one notch.

