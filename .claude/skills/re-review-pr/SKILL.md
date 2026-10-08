---
name: re-review-pr
description: >-
  Re-review a PR after the author pushes fixes in response to a review.
  Empirically verifies each claimed fix (including by reverting it and
  watching its test fail), then hunts the interdiff for new bugs the fixes
  introduced. Use when a contributor says "all points addressed" on a
  previously reviewed PR. Drafts only; nothing posts without approval.
---

# PR re-review after fixes

Two independent passes, run in parallel when subagents are available. Both
work against the new head SHA, pinned first.

## Pass 1 — Verify each claimed fix

For every point from the original review, adversarially check the author's
claim that it is fixed:

- Trace the code path and confirm the hole is actually closed, not narrowed.
- **Revert experiment** (the strongest evidence, use when cheap): locally
  revert the fix hunk and run the suite. The author's new tests should fail,
  and fail on the test that claims to pin this fix specifically. Restore and
  confirm green. A fix whose tests survive its own reversion is not pinned.
- Run the full suite, lint, and any import/structure checks; report real
  counts, not "tests pass".

## Pass 2 — Fresh eyes on the interdiff

Diff `oldHead..newHead` and hunt for what the fixes broke or missed. Fixes
trade bugs for bugs; the classic shapes:

- The fix makes a path exclusive and silently swallows a flow that used to
  work (check every caller of changed functions, not just the reported one).
- The fix's classification/validation is too broad or too narrow at the
  margins (degenerate inputs: empty object, null, empty array, parseable
  garbage).
- The same bug class exists on a surface the fix didn't touch (other
  transports, other entry points, CLI vs server paths).
- New logging: stderr only, no secrets (keys, tokens, client secrets).
- New tests: do they assert real behavior (real temp files, real env
  mutation) or echo their own mocks?

## Verdict and drafts

- All fixed, nothing new → Approve, with a summary that credits the
  turnaround specifically.
- Fixes verified but the fixes introduced a real issue → Request changes
  with that one issue as the single blocker; keep it proportionate and warm,
  the author just did a round of work for free.
- Note pre-existing adjacent issues as offers to split out, never blockers.

Same drafting rules, voice, anchor verification, and approval gate as
`review-pr` Stage 3–4 and Posting.
