---
id: "010"
title: Report client errors from the field
status: ready
priority: P2
area: server
source: requirements/ios-app-plan.md (API contract item 9)
depends_on: []
touches:
  - web/server.mjs
  - ios/CourtScoutKit/Sources/CourtScoutCore/
  - test/server.test.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

Crashes and decode or sync failures in field builds reach the owner.

## Done when

- [ ] `POST /api/client-errors` stores a bounded, rate-limited log with no player personal data.
- [ ] The iOS client reports decode and sync failures to it.
- [ ] `npm test` passes.

## Notes for the coding agent

MetricKit is an alternative for crashes; this route covers the errors the app catches itself.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
