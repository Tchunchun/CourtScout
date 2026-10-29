---
id: "016"
title: Spike: run analyzeTeam in JavaScriptCore
status: blocked
priority: P1
area: ios
source: requirements/ios-app-plan.md (Logic that moves on-device)
depends_on: ["003"]
touches:
  - ios/CourtScoutKit/
branch:
pr:
updated: 2026-10-29
---

## Goal

Decide whether the phone recomputes analysis on-device by running the existing JS module, or keeps cached snapshots.

## Done when

- [ ] `analyzeTeam` runs in JavaScriptCore against the golden files and matches them exactly, or the spike records why not.
- [ ] A short write-up with the recommendation is added to this file's Log.

## Notes for the coding agent

A spike: keep the code on its branch even if the answer is no.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
