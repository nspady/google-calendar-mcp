---
name: review-pr
description: >-
  Deep review of a contributor PR: verify every claim in the PR description
  against the real code, test empirically, hunt bugs beyond the description,
  draft comments in the maintainer's voice with verified diff anchors, then
  adversarially verify every drafted claim before anything is posted. Use when
  asked to review a PR in this repo. Nothing is posted to GitHub without the
  maintainer's explicit approval of the drafts.
---

# Deep PR review

The output of this skill is a **drafts file**, not a posted review. Post only
after the maintainer approves the drafts, and re-read the drafts file
immediately before posting — the maintainer edits it.

## Stage 0 — Pin the target

- `gh pr view <n> --json title,body,headRefOid,files,author` and `gh pr diff <n>`.
- Pin the full head SHA. Every later line reference is at this SHA; if the
  author pushes mid-review, re-pin and re-verify.
- Check out the head SHA in a scratch clone (never in a working worktree).

## Stage 1 — Verify the description's claims

Treat every factual claim in the PR description as unverified. For each: find
the code that implements it, and where feasible prove it empirically — run the
unit suite, build and probe a live server, point the feature at a local stub
server, reproduce the bug it claims to fix. Claims that survive reading but
not probing are the ones that bite.

## Stage 2 — Hunt beyond the description

For API-semantics and protocol questions, load the repo's research skills
first: `.claude/skills/gcal-api-research/` (Calendar API edge cases,
recurring events, timezones) and `.claude/skills/mcp-research/` (MCP spec
compliance, transports, JSON-RPC). Verify against them, not memory.

Recurring failure modes in this codebase, in rough order of yield:

- **Shared-state lifecycle**: the accounts `Map`, `CalendarRegistry`'s cached
  entries, HTTP per-session transports, `TokenManager`. Who writes it, who
  invalidates it, what happens on reload/re-entry? Mutation paths that skip
  `CalendarRegistry.getInstance().clearCache()` serve stale data for 5 minutes.
- **Config and env vars**: all config goes through `src/config/AppConfig.ts`,
  validated at startup, fail-loud, logged to stderr. A PR adding a raw
  `process.env` read elsewhere is a should-fix. Check precedence interactions
  with existing vars and what happens on a malformed value.
- **Silent failures**: bare catches, fallbacks without logging, startup errors
  that don't name the actual problem. Quote exact error messages when citing
  one — verify the wrapped text, not the inner throw.
- **stdio discipline**: anything printed to stdout in stdio mode corrupts
  JSON-RPC. New logging must go to stderr.
- **Tool description vs API semantics**: what the Google API actually does
  versus what the tool description promises the model (e.g.
  `calendarList.delete` unsubscribes; it does not delete). The model relays
  these promises to users, so a mismatch is a blocker.
- **MCP spec compliance**: session semantics (unknown session id → 404 /
  -32001; missing id → 400), error codes, SDK version behavior. Verify against
  the pinned SDK version in package.json, not memory.
- **New tools**: registry entry with title + annotations, handler extending
  `BaseToolHandler`, unit test, README and docs tool lists updated.
- **Security surface**: new env vars or URLs that could redirect tokens or
  credentials somewhere unexpected.

## Stage 3 — Draft, never post

Write drafts to a markdown file with this structure per PR: review action
(Approve / Request changes), review summary (the review body), then one block
per inline comment with its **anchor**: file, head-side diff line number, and
a parenthetical of what is on that line. Verify each anchor falls inside a
diff hunk (parse `@@` headers of the head side); GitHub rejects comments on
lines outside hunks.

Voice (the maintainer's): terse and warm. Open with genuine thanks. One
blocker sentence in the summary if there is one; everything else inline.
Question-framed asks ("Can we…?"), commas instead of em-dashes, no emojis,
"I think" for opinions. Label each inline comment BLOCKING / should fix /
nit. Pre-existing problems the PR merely touches are offered as split-out
issues, not held against the PR.

## Stage 4 — Adversarial verification

Before presenting drafts, run an independent adversarial pass (a subagent if
available, otherwise a deliberate second pass against the checked-out code)
that tries to **refute** every factual claim and anchor in the drafts: exact
error strings, spec assertions, line numbers, "nothing handles X" claims.
Fix or drop anything that fails. A review comment that is wrong once costs
more trust than ten correct ones earn.

## Posting (only after approval)

Post via `gh api repos/<owner>/<repo>/pulls/<n>/reviews` with a JSON payload:
full head SHA as `commit_id`, `event` (`APPROVE` / `REQUEST_CHANGES`), body =
the summary block, `comments[]` = `{path, line, side: "RIGHT", body}`.
