---
id: "002"
title: Version and document the API under /api/v1
status: ready
priority: P0
area: server
source: requirements/ios-app-plan.md (API contract; Pre-work 2)
depends_on: []
touches:
  - web/server.mjs
  - contracts/api.openapi.yaml
  - test/server.test.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

The phone can depend on a documented, versioned API instead of whatever `app.js` calls today.

## Done when

- [ ] Every route answers under `/api/v1/`; the current `/api/` paths keep working as aliases.
- [ ] Every JSON response carries `contractVersion` and the minimum supported app version.
- [ ] `contracts/api.openapi.yaml` describes the routes in the plan's route table, reusing `contracts/team-data.schema.json` for dataset bodies.
- [ ] `npm test` passes, with tests for the alias and the version fields.

## Notes for the coding agent

Leave `/api/utr/connect` and `/api/utr/status` out of the phone-facing contract. Do not switch the web app or the iOS client to `/api/v1` in this change; aliases make that a separate, small follow-up. Auth is feature 008, not this one.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
