---
id: "007"
title: Add an Azure Blob Storage backend to the store
status: ready
priority: P1
area: infra
source: requirements/ios-app-plan.md (Data ownership and storage, Cloud)
depends_on: []
touches:
  - scripts/lib/store.mjs
  - scripts/lib/blob-store.mjs
  - test/store.test.mjs
  - package.json
branch:
pr:
updated: 2026-10-29
---

## Goal

The same store interface works against Blob Storage, so moving to the cloud is copying `data/` into a container.

## Done when

- [ ] A Blob implementation with the same keys, ETags and `ifMatch` behavior as the file-system store.
- [ ] Chosen by configuration; the file-system store stays the default.
- [ ] Shared contract tests run against both (Blob through a fake or Azurite).
- [ ] `npm test` passes without Azure credentials.

## Notes for the coding agent

Scouting dataset folders also move behind the store in Phase 1; that can be a follow-up feature.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
