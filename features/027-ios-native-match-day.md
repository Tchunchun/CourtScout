---
id: "027"
title: Native Match Day with offline card sync
status: blocked
priority: P1
area: ios
source: requirements/ios-app-plan.md (Milestones, Phase 3; Match Day usability)
depends_on: ["005", "012", "016"]
touches:
  - ios/CourtScoutKit/Sources/
branch:
pr:
updated: 2026-10-29
---

## Goal

A full Match Day runs offline and syncs afterward, with no duplicated or lost card edits.

## Done when

- [ ] Card edits queue offline with idempotency keys and sync when back online.
- [ ] A `409` shows both versions for the user to choose.
- [ ] Dynamic Type, high contrast and large tap targets checked with Accessibility Inspector.

## Notes for the coding agent

Split once 016 decides how lineup scoring runs on the phone.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
