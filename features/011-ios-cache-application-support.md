---
id: "011"
title: Move the iOS offline cache to Application Support
status: ready
priority: P0
area: ios
source: requirements/ios-app-plan.md (Data sync)
depends_on: []
touches:
  - ios/CourtScoutKit/Sources/CourtScoutCore/TeamRepository.swift
branch:
pr:
updated: 2026-10-29
---

## Goal

iOS can no longer purge a saved report under storage pressure right before a match.

## Done when

- [ ] The offline cache lives in Application Support, excluded from backup.
- [ ] Existing cached files move over on first launch.
- [ ] `swift run --package-path ios/CourtScoutKit verify-kit` passes with the server running.

## Notes for the coding agent

Today `TeamRepository` uses the Caches directory.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
