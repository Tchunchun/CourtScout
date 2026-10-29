---
id: "022"
title: Benchmark lineup prediction on early-season data
status: ready
priority: P0
phase: phase-1
area: analysis
source: requirements/lineup-prediction-cold-start-proposal.md (Delivery plan, Phase 0)
depends_on: []
touches:
  - scripts/benchmark-lineups.mjs
  - test/
branch:
pr:
updated: 2026-10-29
---

## Goal

A repeatable report of how well today's model predicts lineups with 0, 1, 3, 5 and 8 known matches.

## Done when

- [ ] A runner hides the first N matches of a season and predicts each next lineup from earlier evidence only.
- [ ] It reports player inclusion, unordered doubles-pair accuracy, exact court
      accuracy, top-three coverage and complete-lineup accuracy for the current
      model, grouped by the number of earlier matches available.
- [ ] The backtest uses only evidence dated before the match being predicted;
      a test fails if the hidden match or a later match leaks into its inputs.
- [ ] Go/no-go thresholds for a new model are proposed in this file's Log for the owner to accept.

## Notes for the coding agent

Read-only against `scripts/lib/analysis.mjs`: no ranking changes in this feature.

## Log

- 2026-10-29: Seeded from `requirements/lineup-prediction-cold-start-proposal.md`.
- 2026-10-29: Raised to Phase 1 P0 as the baseline required for the prediction
  feedback loop in 035. Expanded metrics to cover players, pairs, courts,
  top-three scenarios and complete lineups.
