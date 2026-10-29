---
id: "008"
title: Sign in with Apple and invite-only QR sign-up
status: blocked
priority: P0
area: server
source: requirements/ios-app-plan.md (API contract item 7; Accounts and sharing)
depends_on: ["002"]
touches:
  - web/server.mjs
  - scripts/lib/
  - web/public/
  - ios/CourtScoutKit/
branch:
pr:
updated: 2026-10-29
---

## Goal

Only invited people can use the hosted app; the owner invites by QR code.

## Done when

- [ ] Bearer-token auth on every `/api/v1` route.
- [ ] Invite create, revoke and redeem routes behave as specified in Accounts and sharing.
- [ ] Account deletion works.
- [ ] `npm test` passes.

## Notes for the coding agent

Blocked on an owner decision: workspace roles (captain, co-captain, player) and which can edit cards. Split into smaller features once that is decided.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
