---
id: "023"
title: Link a team to its prior seasons
status: ready
priority: P1
area: analysis
source: requirements/lineup-prediction-cold-start-proposal.md (Delivery plan, Phase 1)
depends_on: []
touches:
  - scripts/lib/history-links.mjs
  - scripts/lib/analysis.mjs
  - web/server.mjs
  - web/public/
branch:
pr:
updated: 2026-10-29
---

## Goal

Explainable prior-season evidence for a team, without changing predictions yet.

## Done when

- [ ] Confirmed team and player continuity is stored with the local store patterns.
- [ ] A review step discloses ambiguous links.
- [ ] Normalized prior-season court, pair and lineup evidence is built from confirmed links only.
- [ ] Analysis cache invalidation includes linked dataset timestamps.
- [ ] `npm test` passes; predictions are unchanged.

## Notes for the coding agent

The canonical team data schema stays unchanged.

## Log

- 2026-10-29: Seeded from `requirements/lineup-prediction-cold-start-proposal.md`.
