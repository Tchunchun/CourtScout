---
id: "028"
title: Let the captain manage their doubles pairs on the phone
status: in-progress
priority: P0
phase: phase-1
area: ios
source: Owner request, planning session 2026-10-29
depends_on: []
touches:
  - scripts/lib/team-pairs.mjs
  - web/server.mjs
  - test/team-pairs.test.mjs
  - test/server.test.mjs
  - ios/CourtScoutKit/Sources/CourtScoutCore/TeamPairs.swift
  - ios/CourtScoutKit/Sources/CourtScoutCore/APIClient.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/PairsView.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/TeamDetailView.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/AppModel.swift
branch: codex/028-captain-doubles-pairs
pr:
updated: 2026-10-29
---

## Goal

The captain keeps a list of the doubles pairs they use on our team, starting
from the pairs that have already played together, so lineup proposals (029)
can build around them.

## Done when

- [ ] `GET /api/team-pairs/:collectionId` returns the saved pairs for that
      team. When none are saved, it returns suggested pairs from match
      history, each with appearances and win–loss, marked as suggested.
- [ ] `PUT /api/team-pairs/:collectionId` saves the pairs with a revision. A
      stale revision gets `409` with the current pairs, as team roles do.
- [ ] A pair is two players on the team's active roster, an optional
      preferred court, and a tag: `go-to` or `backup`. The server rejects
      unknown players, the same pair twice, and a Mixed pair that is not one
      man and one woman when both genders are known.
- [ ] On the iPhone, from our team's screen, the captain sees the suggested
      pairs, confirms them, and adds, edits or removes pairs. A save shows up
      on another device after it reloads.
- [ ] `npm test` passes and the iOS checks in `ios/README.md` pass.

## Notes for the coding agent

Phase 1 core: prove the value of scouting-informed lineup preparation. See features/README.md for release priorities.

- Pair history already exists: `primaryPartner` in `scripts/lib/analysis.mjs`
  counts appearances and record per partner. Suggestions should come from the
  same court data, covering every pair, not only each player's top partner.
- Store pairs the way `scripts/lib/team-roles.mjs` stores roles: through
  `store.mjs`, keyed by workspace, with a revision per team.
- Pairs are for our team only. Teams in other roles do not get this screen.
- Out of scope for now: "never pair these two" and singles preferences.
- If feature 002 (`/api/v1`) has merged, put the new routes under its
  convention.
- Offline use of pairs comes with feature 012, not here.

## Log

- 2026-10-29: Written with the owner. Web support follows later as its own feature.
- 2026-10-29: Marked ready by the owner.
- 2026-10-29: Started in its own worktree after owner approval.

- 2026-10-29: Owner prioritized phase 1 at P0; lineup preparation precedes team management.
