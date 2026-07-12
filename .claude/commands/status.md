---
description: Health board for this site — repo state + deployment + open ledger items (Layer 1, $0)
allowed-tools: Bash, Read
---

Produce a one-screen health board for THIS project only. Deterministic, no changes.

1. Repo state: branch, `git status -s`, ahead/behind origin.
2. Deployment: latest production deployment state + URL (via the Vercel connector if available).
3. Ledger: read `.claude/operator-ledger.json`; summarize open_requests, built, pending_decisions.

Format as a compact table. Do not push, deploy, or edit. This site stands alone: never reference any other property, site, entity, or repository in output.
