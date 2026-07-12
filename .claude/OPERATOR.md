# Operator Control Surface

On-demand command menu for this site. Any Claude Code session (local or the claude.ai
cowork environment, once GitHub is connected) drives it by the same commands. You are
the trigger; nothing fires on a clock. This site stands alone: these commands never
reference any other property, site, or entity.

## Commands

| Command | Layer | Cost | Does |
|---|---|---|---|
| `/status` | 1 | $0 | Repo + deployment + ledger health board |
| `/verify` | 1 | $0 | Build/lint/link check → DEPLOYABLE verdict |
| `/ledger [show\|add-request\|resolve\|decide]` | 1 | $0 | Read/update the tracking ledger |
| `/audit <target>` | 2 | metered | Ranked findings, no edits |
| `/build <spec>` | 2 | metered | Scoped change on a branch → PR, never direct to main |
| `/decide <question>` | 2 | metered | Decision brief: options + recommendation |
| `/ship [--push]` | outward | deploy $ | Logical commits; push is double-confirmed |

**Cost rule:** Layer 1 is always free. Layer 2 spends only when invoked, capped by
`*_MAX_TOKENS` / `*_DAILY_CAP`. Nothing recurring, nothing unattended.

**Decision model:** request → propose (diff or brief) → you approve → apply. Anything
irreversible or outward (push→deploy, publish) takes a second explicit confirm.

**This is a live, git-connected site.** `/build` works on a branch and opens a PR;
`/ship` is the only path to main, and only with your confirm. Postgres (Neon):
seed/migrate via a node script, never raw curl.
