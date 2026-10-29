---
id: "006"
title: Rate-limit and queue collection jobs
status: ready
priority: P1
area: server
source: requirements/ios-app-plan.md (API contract item 8; Pre-work 6)
depends_on: []
touches:
  - web/server.mjs
  - scripts/lib/job-queue.mjs
  - test/server.test.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

Hosted users cannot overload TennisRecord or run up hosting costs by starting many gathers at once.

## Done when

- [ ] Collection and refresh jobs go through one shared server-side queue with a configurable concurrency.
- [ ] A per-user (for now, per-client) limit returns `429` with a clear message.
- [ ] Queued jobs report their position through `GET /api/jobs/:id`.
- [ ] `npm test` passes.

## Notes for the coding agent

Jobs are saved to `data/jobs/` and resume as interrupted after a restart; keep that behavior. There are no users until feature 008, so key the limit on something replaceable.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
