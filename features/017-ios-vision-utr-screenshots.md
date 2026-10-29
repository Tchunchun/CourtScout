---
id: "017"
title: Confirm exact UTR from screenshots on the phone
status: blocked
priority: P1
area: ios
source: requirements/ios-app-plan.md (Exact UTR on iPhone; Milestones, Phase 4)
depends_on: ["001"]
touches:
  - ios/CourtScoutKit/
  - contracts/team-data.schema.json
  - web/server.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

A user confirms exact UTR from their own screenshots and the ratings appear in reports with screenshot provenance.

## Done when

- [ ] Vision text feeds a Swift port of the parser and matcher, sharing fixtures with the JS tests.
- [ ] Every proposed match needs user confirmation; low OCR confidence forces review.
- [ ] The contract records `lookupStatus: "user_screenshot_confirmed"`, source type `utr_user_screenshot`, capture date and confidence.

## Notes for the coding agent

Split the contract update into its own feature when this becomes ready; it must land before any rating is written.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
