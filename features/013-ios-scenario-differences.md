---
id: "013"
title: Show scenario differences on the phone matchup
status: done
priority: P1
area: ios
source: requirements/ios-app-plan.md (Phone user flow, P1 row)
depends_on: []
touches:
  - ios/CourtScoutKit/Sources/CourtScoutUI/
branch:
pr:
updated: 2026-10-29
---

## Goal

The captain sees where the predicted opponent scenarios differ, court by court, without comparing them by eye.

## Done when

- [x] Picking the ratings or alternate scenario shows a one-line read and the
      changed courts under the scenario picker, and tags changed court cards.
- [x] Differences cover different opponents per court, who comes in or drops
      out, how Our edge and the score move.
- [x] `npm test` passes.

## Notes for the coding agent

Needs a short spec before it is ready. `POST /api/matchup` already returns per-scenario results.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
- 2026-10-29: Built before the features process in dbd43d4 ("Show what each
  opponent scenario changes"); merged with #3. Marked done.
