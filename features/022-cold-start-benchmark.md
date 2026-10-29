---
id: "022"
title: Benchmark lineup prediction on early-season data
status: ready
priority: P1
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
- [ ] It reports player inclusion and exact court accuracy for the current model.
- [ ] Go/no-go thresholds for a new model are proposed in this file's Log for the owner to accept.

## Notes for the coding agent

Read-only against `scripts/lib/analysis.mjs`: no ranking changes in this feature.

## Log

- 2026-10-29: Seeded from `requirements/lineup-prediction-cold-start-proposal.md`.
