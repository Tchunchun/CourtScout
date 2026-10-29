---
id: "002"
title: Version and document the API under /api/v1
status: done
priority: P0
area: server
source: requirements/ios-app-plan.md (API contract; Pre-work 2)
depends_on: []
touches:
  - web/server.mjs
  - contracts/api.openapi.yaml
  - test/server.test.mjs
branch: codex/api-v1-contract
pr:
updated: 2026-10-29
---

## Goal

The phone can depend on a documented, versioned API instead of whatever `app.js` calls today.

## Done when

- [x] Every route answers under `/api/v1/`; the current `/api/` paths keep working as aliases.
- [x] Every JSON response carries `contractVersion` and the minimum supported app version.
- [x] `contracts/api.openapi.yaml` describes the routes in the plan's route table, reusing `contracts/team-data.schema.json` for dataset bodies.
- [x] `npm test` passes, with tests for the alias and the version fields.

## Notes for the coding agent

Leave `/api/utr/connect` and `/api/utr/status` out of the phone-facing contract. Do not switch the web app or the iOS client to `/api/v1` in this change; aliases make that a separate, small follow-up. Auth is feature 008, not this one.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.

- 2026-10-29: Implemented on `codex/api-v1-contract` in an isolated worktree based on `59ee8cf`. All existing routes share their handlers with `/api/v1` aliases; JSON responses include `contractVersion` and `minimumAppVersion`, both `1.0.0`. Current clients and stored datasets remain unchanged.
- 2026-10-29: Added the OpenAPI 3.1 contract for 21 implemented phone-facing paths. Browser-only UTR routes are excluded. The planned UTR screenshot-proposal endpoint is explicitly documented as unimplemented, not advertised in `paths`. Dataset response properties reference the canonical schema individually because its closed root cannot accept transport metadata through `allOf`.
- 2026-10-29: Validation passed: all 160 tests; OpenAPI validation with Swagger Parser; nine live success/conflict responses validated with Ajv; `git diff --check`. Tests cover alias reads/writes, parameterized routes, query handling, malformed requests, errors/conflicts, unknown version rejection, and metadata staying out of stored data.
- 2026-10-29: Implementation complete. Status remains in-progress pending a PR: the branch's base contains three existing commits not yet on main (`801172c`, `7e0fc9e`, `59ee8cf`). No PR opened to avoid mixing unrelated changes; no merge performed.

- 2026-10-29: Applied feature commit 88f8f17 directly to main at the owner's request, leaving its three unrelated ancestor commits out. Removed the playoff-opponents API path from this contract because that endpoint is not on main yet.
- 2026-10-29: Main integration verified: all 161 tests pass; the 20-path OpenAPI contract validates; git diff --check passes.
