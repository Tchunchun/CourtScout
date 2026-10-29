---
id: "017"
title: Show exact UTR and its source on the phone
status: blocked
priority: P1
area: ios
source: requirements/ios-app-plan.md (Exact UTR on iPhone; Milestones, Phase 4)
depends_on: ["034"]
touches:
  - ios/CourtScoutKit/
branch:
pr:
updated: 2026-10-29
---

## Goal

Phone reports show exact UTR from the partner API where the server has it, labeled with its source and retrieval date, and public masked UTR everywhere else.

## Done when

- [ ] Player rows and reports show exact UTR with its source and retrieval date when the dataset has a partner API rating.
- [ ] Players without one still show the public masked band, never a guessed decimal.
- [ ] Generated `Codable` types include the new provenance fields from 034.
- [ ] `npm test` and the iOS checks in `ios/README.md` pass.

## Notes for the coding agent

The phone never talks to UTR and holds no UTR key or login; ratings arrive
through the server's team data. Attribute each rating to its source without
UTR branding (see App Review 5.2 in the plan's Risks table).

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
- 2026-10-29: Rescoped after the owner chose UTR's official partner API (034) over screenshot OCR. The Vision parser, confirmation UI and `user_screenshot_confirmed` provenance are dropped.
