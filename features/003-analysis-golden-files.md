---
id: "003"
title: Add golden files for team analysis
status: ready
priority: P0
area: analysis
source: requirements/ios-app-plan.md (Pre-work 3; Logic that moves on-device)
depends_on: []
touches:
  - test/fixtures/golden/
  - test/analysis.test.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

A fixed set of `team-data.json` inputs with checked-in `analysis/<scope>.json` outputs, so any port or refactor of `scripts/lib/analysis.mjs` can prove it gives identical results.

## Done when

- [ ] A small set (3 to 5) of inputs covering single-gender and Mixed, sparse and rich match history.
- [ ] Expected outputs are checked in and validated against the schema in `npm test`.
- [ ] A documented command regenerates the outputs on purpose when analysis is meant to change.
- [ ] `npm test` passes.

## Notes for the coding agent

Do not change `scripts/lib/analysis.mjs` here. Strip or anonymize anything in fixtures that should not be copied around; prefer trimmed copies of checked-in collections under `data/collections/`.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
