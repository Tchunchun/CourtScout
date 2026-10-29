---
id: "022"
title: Benchmark lineup prediction on early-season data
status: review
priority: P0
phase: phase-1
area: analysis
source: requirements/lineup-prediction-cold-start-proposal.md (Delivery plan, Phase 0)
depends_on: []
touches:
  - scripts/benchmark-lineups.mjs
  - test/benchmark-lineups.test.mjs
  - requirements/lineup-prediction-benchmark-design.md
branch: codex/022-lineup-benchmark
pr: https://github.com/Tchunchun/CourtScout/pull/7
updated: 2026-10-29
---

## Goal

A repeatable report of how well today's model predicts lineups with 0, 1, 3, 5 and 8 known matches.

## Done when

- [x] A runner hides the first N matches of a season and predicts each next lineup from earlier evidence only.
- [x] It reports player inclusion, unordered doubles-pair accuracy, exact court
      accuracy, top-three coverage and complete-lineup accuracy for the current
      model, grouped by the number of earlier matches available.
- [x] The backtest uses only evidence dated before the match being predicted;
      a test fails if the hidden match or a later match leaks into its inputs.
- [x] Go/no-go thresholds for a new model are proposed in this file's Log for the owner to accept.

## Notes for the coding agent

Read-only against `scripts/lib/analysis.mjs`: no ranking changes in this feature.

## Log

- 2026-10-29: Seeded from `requirements/lineup-prediction-cold-start-proposal.md`.
- 2026-10-29: Raised to Phase 1 P0 as the baseline required for the prediction
  feedback loop in 035. Expanded metrics to cover players, pairs, courts,
  top-three scenarios and complete lineups.
- 2026-10-29: Claimed for implementation on `codex/022-lineup-benchmark`.
- 2026-10-29: Narrowed the test touch point to
  `test/benchmark-lineups.test.mjs`, resolving the apparent overlap with 001,
  and added the requested benchmark design document.
- 2026-10-29: Implemented the walk-forward runner, leakage boundary, metrics,
  JSON/Markdown reports and design document. A reference run over 28 local
  datasets produced 102 samples: player recall was 39.3% after one known match,
  51.1% after three, and 51.5% after eight; exact-court accuracy was 8.7%,
  9.4%, and 14.5% at those cutoffs. The current model produced no zero-match
  predictions and no exact complete-lineup hits in the top three.
- 2026-10-29: Proposed promotion thresholds for owner acceptance: improve
  combined 0/1/3-match top-three coverage by at least 15 percentage points,
  reduce established exact-court accuracy by no more than 2 points, permit no
  same-day/future-result leakage, and generate no invalid lineups.
- 2026-10-29: Opened PR #7 after all 188 tests passed.
