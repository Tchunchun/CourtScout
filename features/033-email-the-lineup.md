---
id: "033"
title: Email the lineup to the team
status: idea
priority: P2
phase: phase-2
area: server
source: Owner request, planning session 2026-10-29 (team management, replacing Breakpoint)
depends_on: ["031"]
touches:
  - scripts/lib/lineup-email.mjs
  - web/server.mjs
  - test/lineup-email.test.mjs
  - test/server.test.mjs
  - ios/CourtScoutKit/Sources/CourtScoutCore/APIClient.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/MatchupModel.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/MatchupView.swift
branch:
pr:
updated: 2026-10-29
---

## Goal

When the lineup is set, the captain sends it from the phone. Every player
learns where they play, with whom, and when.

## Done when

- [ ] From the matchup, the captain previews the lineup email and sends it.
      Sending a valid lineup is the only way to send.
- [ ] Each player in the lineup gets their court, partner, match date, time
      and place. The whole team gets the full lineup, and players not
      playing see that they are off or on standby.
- [ ] The email shows no scouting notes, opponent analysis, ratings, or other
      players' contact details.
- [ ] Sending again after a change marks the email as an update and says
      what changed.
- [ ] Members without an email, and members who unsubscribed, are listed
      before sending so the captain can reach them another way.
- [ ] `npm test` passes and the iOS checks in `ios/README.md` pass.

## Notes for the coding agent

Deferred to Phase 2: team management follows validation of Phase 1 lineup preparation. Do not start for the Phase 1 release; see features/README.md. Readiness is spec maturity, not release approval.

- Uses the mailer and member contacts from 030 and 031.
- The lineup is the matchup draft (`buildMatchup` in
  `scripts/lib/matchup.mjs`). Saved Match Day Cards (005) may become the
  source later.
- Open: whether players confirm the lineup from the email. Leave it out
  unless the owner asks.

## Log

- 2026-10-29: Written with the owner.

- 2026-10-29: Owner prioritized phase 2 at P2; deferred team management until after Phase 1 value validation.
