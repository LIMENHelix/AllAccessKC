---
description: Build/lint/link check → deployable verdict (Layer 1, $0)
allowed-tools: Bash, Read, Grep
---

Verify this site is deployable. Deterministic checks only, no fixes.

Run whatever exists here and report PASS/FAIL with failing output:
1. Syntax check on changed `.js` files (`node --check`).
2. Any build/lint script in `package.json`.
3. HTML pages resolve their referenced `kc-*.js` / `kc.css` / assets (no broken local paths).
4. `api/` endpoints parse.

End with a single verdict: DEPLOYABLE or NOT (list blockers). Never edit, commit, or deploy. This site stands alone: reference no other property or entity.
