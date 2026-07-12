---
description: Review a page/module/diff and return ranked findings — no edits (Layer 2, metered)
allowed-tools: Bash, Read, Grep, Glob
argument-hint: "<target> — e.g. a page, kc-chat.js, or the working diff"
---

METERED command (spends tokens). Review `$ARGUMENTS`, return findings only.

1. Locate the target (a page, a `kc-*.js` module, an `api/` handler, or the current `git diff`).
2. Review for: correctness bugs, broken links/asset paths, unsafe input handling, secrets committed in the tree, accessibility gaps, and leaked references to any external property or entity (this site must stand alone).
3. Return findings ranked most-severe first: file:line, one-sentence defect, concrete failure scenario. Mark CONFIRMED or PLAUSIBLE.

Apply nothing. Log actionable items to the ledger. Respect any `*_MAX_TOKENS` / `*_DAILY_CAP` cap.
