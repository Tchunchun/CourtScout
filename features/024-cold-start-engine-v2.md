---
id: "024"
title: Blended cold-start prediction engine behind a flag
status: blocked
priority: P1
area: analysis
source: requirements/lineup-prediction-cold-start-proposal.md (Delivery plan, Phase 2)
depends_on: ["022", "023"]
touches:
  - scripts/lib/analysis.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

Version 2 predictions use prior seasons and ratings when current evidence is sparse.

## Done when

- [ ] As in the proposal's Phase 2, behind a model-version switch with the current algorithm as fallback.

## Notes for the coding agent

Open decisions in the proposal are made after the benchmark (022).

## Log

- 2026-10-29: Seeded from `requirements/lineup-prediction-cold-start-proposal.md`.
