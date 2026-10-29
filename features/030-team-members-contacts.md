---
id: "030"
title: Create a team and keep players' contact details
status: ready
priority: P1
area: ios
source: Owner request, planning session 2026-10-29 (team management, replacing Breakpoint)
depends_on: []
touches:
  - scripts/lib/team-members.mjs
  - web/server.mjs
  - test/team-members.test.mjs
  - test/server.test.mjs
  - ios/CourtScoutKit/Sources/CourtScoutCore/TeamMembers.swift
  - ios/CourtScoutKit/Sources/CourtScoutCore/APIClient.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/MembersView.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/TeamDetailView.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/AppModel.swift
branch:
pr:
updated: 2026-10-29
---

## Goal

The captain creates their team on the phone and keeps each player's name,
email and phone number there, matched to the roster we gather. This is the
base for invites, availability and lineup emails (031–033).

## Done when

- [ ] The captain can create a team from a TennisRecord link (the existing
      new-season flow) or as a blank team with a name.
- [ ] The captain can add, edit and remove members: name, email, phone
      number, and the roster player they are (if any). Gathered roster
      players without contact details show as "no contact yet".
- [ ] Email and phone are checked for shape. The same email cannot be on a
      team twice.
- [ ] Members are saved through `store.mjs` with a revision, and a stale save
      gets `409`, as team roles do. A save shows up on another device after
      it reloads.
- [ ] Contact details never appear in gathered data files, analysis output,
      reports, or any API response other than the members routes.
- [ ] `npm test` passes and the iOS checks in `ios/README.md` pass.

## Notes for the coding agent

- Follow `scripts/lib/team-roles.mjs` for storage and conflicts.
- Contact details are personal data. Keep them out of `data/` files that
  could be committed, and out of logs.
- Only the owner's teams for now, with the owner (and later co-captains) as
  the only people who see contacts. Once hosted, the members routes sit
  behind sign-in (008/009).
- Phone numbers are stored and shown (tap to call or text). The app does not
  send texts yet.
- If feature 002 (`/api/v1`) has merged, put the new routes under its
  convention.

## Log

- 2026-10-29: Written with the owner. Court Scout replaces Breakpoint for
  team management.
- 2026-10-29: Marked ready by the owner.
