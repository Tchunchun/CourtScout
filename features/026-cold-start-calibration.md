---
id: "026"
title: Calibrate and roll out the cold-start model
status: blocked
priority: P2
area: analysis
source: requirements/lineup-prediction-cold-start-proposal.md (Delivery plan, Phase 4)
depends_on: ["024"]
touches:
  - scripts/lib/analysis.mjs
  - scripts/benchmark-lineups.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

Version 2 becomes the default only if it beats the baseline without hurting established-season predictions.

## Done when

- [ ] As in the proposal's Phase 4.

## Notes for the coding agent

None yet.

## Log

- 2026-10-29: Seeded from `requirements/lineup-prediction-cold-start-proposal.md`.
