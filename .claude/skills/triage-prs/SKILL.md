---
name: triage-prs
description: >-
  Maintainer triage of open PRs: status sweep, nudging silent authors with a
  close deadline, deadline-gated closes, deciding whether to adopt an
  abandoned PR, and post-merge conflict checks across the open PR set. Use
  for "any updates on the PRs", "nudge the stale ones", or after merging
  something that may conflict with open PRs.
---

# PR triage

## Status sweep

For each open PR: state, head SHA drift since last look, new comments or
review-thread replies (check `pulls/<n>/comments` too — thread replies don't
bump the issue comment list), mergeable state, and author responsiveness.
Note that a PR's `updatedAt` bumps on the maintainer's own review activity;
verify who acted before reporting it as author movement.

## Nudges and deadline closes

- Nudge template (tag the author):
  "Checking in, any chance you'll have time to address the review feedback?
  I'll close this in a week if I don't hear back, happy to reopen anytime."
- Record the deadline (one week from the nudge timestamp).
- When the deadline passes, the close must be **gated**: re-verify there has
  been no author activity since the nudge before closing. Close message:
  "Closing this for now since I haven't heard back, happy to reopen if you
  get a chance to pick it up again. Thanks for the contribution!"
- Never close a PR that the maintainer approved; that one is waiting on the
  maintainer, not the author.

## Adopt or close an abandoned PR

Before taking over an abandoned PR, weigh:

- **Demand**: are there issues or discussions asking for this? Zero demand
  argues for closing.
- **Surface symmetry**: does the tool fit the existing API surface (e.g. a
  delete-X with no create-X is a flag)?
- **Blast radius**: destructive operations carry permanent ownership cost
  and model-misuse risk; the bar is higher.
- **Review debt**: how many of the review findings would adoption require
  implementing from scratch?

If adopting: rebase in a scratch clone, keep the author's commits and
authorship, implement the review asks as separate commits, run the full
suite. Maintainer pushes to org-owned forks are rejected by GitHub even with
"allow edits" on, so when the fork is org-owned, land via a fresh PR from an
origin branch (rebase-merge to preserve authorship) and close the original
with a comment crediting the author and linking the landing PR.

## Post-merge conflict check

After anything merges to main, check `mergeable` on every open PR. For each
newly conflicting PR decide: rebase it ourselves (small, already approved),
or leave a heads-up comment telling the author what on main moved (name the
file or module) so their rebase is informed, not archaeology.

## Recurring checks

Prefer a scheduled cloud routine for daily sweeps (report-only) and one-shot
routines for deadline closes (gated as above). Keep this session's state in
the routine prompt: baselines (head SHAs, dates), what counts as meaningful,
and report-only vs act instructions.
