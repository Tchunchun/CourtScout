---
id: "032"
title: Collect match and practice availability from players
status: idea
priority: P1
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

- Uses the mailer and player links from 031.
- Match availability is what lineup proposals (029) read.
- Open owner decisions: whether to import current availability from
  Breakpoint once, and whether practices repeat weekly or are entered one at
  a time. Ask before building.

## Log

- 2026-10-29: Written with the owner.
