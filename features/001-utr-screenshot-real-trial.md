---
id: "001"
title: Try UTR screenshot OCR on real screenshots
status: in-progress
priority: P0
area: analysis
source: requirements/ios-app-plan.md (Milestones, Phase 0)
depends_on: []
touches:
  - scripts/utr-screenshot-ocr.mjs
  - scripts/lib/utr-screenshot.mjs
  - test/utr-screenshot.test.mjs
branch: feature/utr-screenshot-ocr
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
