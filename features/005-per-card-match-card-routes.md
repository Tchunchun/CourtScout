---
id: "005"
title: Save Match Day Cards one card at a time
status: ready
priority: P0
area: server
source: requirements/ios-app-plan.md (Data sync; Pre-work 5)
depends_on: []
touches:
  - web/server.mjs
  - scripts/lib/match-cards-store.mjs
  - web/public/app.js
  - test/server.test.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

Two devices editing different cards never overwrite each other, and a retried save is never applied twice.

## Done when

- [ ] `PUT /api/match-cards/:id` saves one card with a revision number and `updatedAt`.
- [ ] A save with a stale revision gets `409` with the current card.
- [ ] A repeated request with the same idempotency key is applied once.
- [ ] The web app saves through the per-card route; the whole-list `PUT` stays only as long as something still uses it.
- [ ] `npm test` passes.

## Notes for the coding agent

Use the ETag and `ifMatch` support already in `scripts/lib/store.mjs`. Conflict UI on the phone belongs to feature 028.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
