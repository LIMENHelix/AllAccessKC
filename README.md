# All Access KC

The local's $5 visitor guide to Kansas City. Restaurants, bars, neighborhoods, itineraries, transit, parking. Written by locals. Updated weekly.

## Files

| File | Purpose |
|---|---|
| `kc.html` | Landing / sales page ($5 purchase entry) |
| `kc-guide.html` | The paid guide itself (tabs: Events, Eat, Drink, Watch, Game Day, Explore, Itineraries, Travel) |
| `kc-thanks.html` | Post-purchase unlock confirmation |
| `kc-skyline.jpg` | Hero image used by kc.html (add separately) |
| `kc-skyline-2.jpg` | Hero image used by kc-thanks.html (add separately) |

## Deployment

Static site — no build step required. Vercel auto-detects HTML.

- **Domain:** allaccesskc.com
- **Stack:** plain HTML/CSS/JS, single file per page
- **i18n:** 16 languages via live Google Translate fallback (kc-guide.html) + minimal static dictionary (kc.html, kc-thanks.html)

## Brand notes

- Brand name: **All Access KC**
- Headline: "Welcome to Kansas City"
- Email: info@allaccesskc.com
- Permanent KC visitor guide — not tied to any single event or tournament
- Not affiliated with any sports league, federation, tournament organizer, or municipal government

## Local preview

Open any of the three HTML files directly in a browser — no server required.
