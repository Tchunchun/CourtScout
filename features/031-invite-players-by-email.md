---
id: "031"
title: Invite players by email with a personal link
status: idea
priority: P2
phase: phase-2
area: server
source: Owner request, planning session 2026-10-29 (team management, replacing Breakpoint)
depends_on: ["030", "009"]
touches:
  - scripts/lib/mailer.mjs
  - scripts/lib/player-links.mjs
  - web/server.mjs
  - web/public/player/
  - test/player-links.test.mjs
  - test/server.test.mjs
  - ios/CourtScoutKit/Sources/CourtScoutUI/MembersView.swift
  - package.json
branch:
pr:
updated: 2026-10-29
---

## Goal

The captain invites players from the phone. Each player gets an email with a
personal link that opens a simple web page for their team, with no account
or password.

## Done when

- [ ] From the members list, the captain can invite one player or everyone
      not yet invited, and sees each member's state: not invited, invited,
      or joined.
- [ ] Each invite sends an email with the team name, the captain's name and a
      personal link.
- [ ] The link opens a player page that shows the team and the player's own
      name and works on a phone browser. It shows no other player's contact
      details.
- [ ] Links are long and random, are stored only as hashes, and can be
      revoked by the captain. A revoked or unknown link shows a plain
      "ask your captain for a new link" page.
- [ ] Players can stop emails with a one-click unsubscribe, which the captain
      sees.
- [ ] Without a configured mail service, the server logs the email instead of
      sending it, so it can run locally and in tests.
- [ ] `npm test` passes and the iOS checks in `ios/README.md` pass.

## Notes for the coding agent

Deferred to Phase 2: team management follows validation of Phase 1 lineup preparation. Do not start for the Phase 1 release; see features/README.md. Readiness is spec maturity, not release approval.

- Players must reach the server, so this needs hosting (009).
- Open owner decisions: which email service (Azure Communication Services
  Email fits the Azure plan) and the sending address and domain. Ask before
  building the mailer.
- The player page is the start of `web/public/player/`. Availability (032)
  adds to it.
- Player app sign-in comes later. Keep the link token separate from captain
  sign-in (008).
- Mail credentials come from `.env` or hosting settings and are never
  committed.

## Log

- 2026-10-29: Written with the owner. Links now, player app later.

- 2026-10-29: Owner prioritized phase 2 at P2; deferred team management until after Phase 1 value validation.
