---
id: "001"
title: Try UTR screenshot OCR on real screenshots
status: blocked
priority: P0
area: analysis
source: requirements/ios-app-plan.md (Milestones, Phase 0)
depends_on: []
touches:
  - scripts/utr-screenshot-ocr.mjs
  - scripts/lib/utr-screenshot.mjs
  - test/utr-screenshot.test.mjs
branch: feature/utr-screenshot-real-trial
pr:
updated: 2026-10-29
---

## Goal

Confirm the screenshot prototype reads real UTR profile and roster screenshots well enough to build the phone flow on.

## Done when

- [ ] Real UTR profile and roster screenshots parse into the expected name and rating pairs.
- [ ] Every parser fix found along the way is captured as a test fixture.
- [ ] `npm test` passes.

## Notes for the coding agent

The prototype (`npm run utr:screenshot`) and its tests already exist. This feature is the trial on real screenshots. It was started before the features/ process, on the branch above, which also carries unrelated uncommitted work; split that work out before opening a PR.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
- 2026-10-29: Moved to a fresh worktree from `main` on `feature/utr-screenshot-real-trial`; the old branch was already merged in PR #3. Baseline `npm test` passes (158). No code changed.
- 2026-10-29: Blocked by owner decision: exact UTR should come from UTR's APIs rather than from reading screenshots, which the owner sees as too risky a workaround. The planning session should drop or rewrite this feature and 017, update "Exact UTR on iPhone" in `requirements/ios-app-plan.md`, and add a feature for UTR API access. Still open: whether "UTR's APIs" means official partner access or `api.utrsports.net` called with each user's own login.
