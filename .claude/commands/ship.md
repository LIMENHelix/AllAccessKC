---
description: Merge an approved branch and (with explicit confirm) push main — which auto-deploys (outward, double-gated)
allowed-tools: Bash, Read
argument-hint: "[--push]"
---

OUTWARD/IRREVERSIBLE. This site is git-connected: pushing main auto-deploys to production for live users.

1. Show `git status` and what would ship (prefer merging a reviewed branch, not raw main edits).
2. Stage into LOGICAL commits, one clear message each. End every message with:
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
   Plain hyphens, no em/en dashes.
3. STOP. Do NOT push unless the operator passed `--push` AND confirms in this turn.
4. On confirmed push: `git push origin main`, report deploy triggered, mark shipped items deployed:true.

Never push on ambiguity. Never make the repo public. This site stands alone: never introduce a reference to any other property or entity.
