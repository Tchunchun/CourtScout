---
id: "009"
title: Host the server on Azure behind sign-in
status: blocked
priority: P0
area: infra
source: requirements/ios-app-plan.md (Data ownership and storage; Milestones, Phase 1)
depends_on: ["006", "007", "008"]
touches:
  - infra/
  - web/server.mjs
branch:
pr:
updated: 2026-10-29
---

## Goal

The owner uses the hosted web app from an iPhone for a real match, and the native app reaches it over HTTPS.

## Done when

- [ ] One App Service instance (Linux B1, Always On) with Blob Storage, over HTTPS.
- [ ] The hosted server collects public UTR only.
- [ ] A second person joins by scanning an invite QR code.

## Notes for the coding agent

Sign-in ships with hosting, never after it.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
