---
id: "012"
title: Prepare a season for Match Day offline
status: blocked
priority: P0
area: ios
source: requirements/ios-app-plan.md (Data sync; Milestones, Phase 2)
depends_on: ["011"]
touches:
  - ios/CourtScoutKit/Sources/
branch:
pr:
updated: 2026-10-29
---

## Goal

One tap downloads everything a match needs, and every saved report says how old it is.

## Done when

- [ ] "Prepare for match day" saves every opponent's dataset, analysis for the needed scope, the schedule and the Match Day Cards.
- [ ] Each cached report shows its age and the dataset's retrieval date.
- [ ] In airplane mode, every opponent's report in a prepared season opens with its age shown.

## Notes for the coding agent

Prepared data is never evicted automatically; the user removes it.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
