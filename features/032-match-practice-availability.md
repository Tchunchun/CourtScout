---
id: "032"
title: Collect match and practice availability from players
status: idea
priority: P2
phase: phase-2
area: server
source: Owner request, planning session 2026-10-29 (team management, replacing Breakpoint)
depends_on: ["031"]
touches:
  - scripts/lib/availability.mjs
  - web/server.mjs
  - web/public/player/
  - test/availability.test.mjs
  - test/server.test.mjs
  - ios/CourtScoutKit/Sources/CourtScoutCore/Availability.swift
  - ios/CourtScoutKit/Sources/CourtScoutCore/APIClient.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/AvailabilityView.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/TeamDetailView.swift
branch:
pr:
updated: 2026-10-29
---

## Goal

Players tell the captain when they can play matches and come to practice,
and the captain sees the whole team at a glance. This replaces what the team
uses Breakpoint for.

## Done when

- [ ] Matches come from the team's gathered schedule. The captain can add,
      edit and cancel practices (date, time, place, note).
- [ ] On their link page, a player sees upcoming matches and practices and
      answers yes, no or maybe for each, with an optional note. They can
      change an answer until the event starts.
- [ ] On the phone, the captain sees a grid of members by upcoming events
      with each answer and who hasn't answered, and can set an answer for a
      player.
- [ ] The captain can email a reminder to members who haven't answered for
      an event.
- [ ] Practice changes and cancellations email the members who answered yes
      or maybe.
- [ ] `npm test` passes and the iOS checks in `ios/README.md` pass.

## Notes for the coding agent

Deferred to Phase 2: team management follows validation of Phase 1 lineup preparation. Do not start for the Phase 1 release; see features/README.md. Readiness is spec maturity, not release approval.

- Uses the mailer and player links from 031.
- In Phase 2, player responses can feed lineup proposals (029). Phase 1
  proposals use captain-entered availability and do not depend on this feature.
- Open owner decisions: whether to import current availability from
  Breakpoint once, and whether practices repeat weekly or are entered one at
  a time. Ask before building.

## Log

- 2026-10-29: Written with the owner.

- 2026-10-29: Owner prioritized phase 2 at P2; deferred team management until after Phase 1 value validation.
