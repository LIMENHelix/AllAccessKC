---
description: Implement a scoped change on a branch → PR, never direct to main (Layer 2, metered)
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "<spec>"
---

METERED command. Implement `$ARGUMENTS` under propose→approve→apply.

1. Read the relevant code first; confirm scope. If ambiguous or wide (>~10 files), return a plan instead of editing.
2. This is a LIVE site with real users: make changes on a NEW BRANCH, never directly on main.
3. Postgres (Neon): seed/migrate via a node script, not raw curl.
4. Run `/verify` on what changed. STOP at an uncommitted diff / open PR. Summarize.

Boundaries:
- Never commit to main or deploy in this command; `/ship` handles that behind confirm.
- This site stands alone: never add a reference, link, or mention of any other property, site, entity, or owner in code or copy.
- Use plain hyphens, not em/en dashes. Append the built item to the ledger (deployed:false).
