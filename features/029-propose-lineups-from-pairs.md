---
id: "029"
title: Propose our lineups from pairs and who is available
status: idea
priority: P1
area: ios
source: Owner request, planning session 2026-10-29
depends_on: ["028", "032"]
touches:
  - scripts/lib/lineup-proposals.mjs
  - scripts/lib/matchup.mjs
  - web/server.mjs
  - test/lineup-proposals.test.mjs
  - test/server.test.mjs
  - ios/CourtScoutKit/Sources/CourtScoutCore/Matchup.swift
  - ios/CourtScoutKit/Sources/CourtScoutCore/APIClient.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/MatchupModel.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/MatchupView.swift
branch:
pr:
updated: 2026-10-29
---

## Goal

Before a match, the captain ticks who is available and gets two or three
proposed lineups built around their pairs. They switch between "strongest"
and "best vs this opponent", pick one, and adjust it in the matchup.

## Done when

- [ ] Given our team, its saved pairs, the available players, the opponent
      and a mode, the proposer returns up to three lineups. Each one passes
      `validateDraft`: eligibility, the combined-NTRP cap, and Mixed gender
      rules.
- [ ] Doubles courts use confirmed pairs as units: go-to pairs before backup
      pairs, and a pair's preferred court when the lineup stays valid. Slots
      no pair can fill use other available players, and the proposal says so.
- [ ] In "strongest" mode, lineups are ranked by our own ratings and pair
      records. In "vs opponent" mode, they are ranked by results against the
      opponent's three scenarios, using the scoring the matchup already uses.
      Each proposal has a one-line reason.
- [ ] Unavailable players never appear. When too few players are available,
      the response names the courts that cannot be filled.
- [ ] On the iPhone matchup, availability starts from the players' answers
      for that match (032). Players who said maybe or didn't answer are
      flagged. The captain can untick or tick anyone before proposing.
- [ ] The captain toggles the mode and sees the proposals. Choosing one makes
      it the draft; it stays editable, and the scenario comparison updates.
- [ ] Tests cover the proposer with fixtures (pairs used, preferred court
      honored or overridden, Mixed rules, too few players) and the API route.
      `npm test` passes and the iOS checks in `ios/README.md` pass.

## Notes for the coding agent

- Today the matchup starts from our team's predicted lineup
  (`lineupPredictions.predictions[0]` in `buildMatchup`,
  `scripts/lib/matchup.mjs`). Proposals replace that starting point when
  pairs are saved; keep the prediction as the fallback.
- Draft validation and scenario scoring live in `web/public/match-card.mjs`.
  Reuse them rather than copying them.
- Keep the search small: build lineups from pairs first, then fill. The court
  count per format is small enough to enumerate.
- Availability lives on the server and players enter it themselves (032).
  The captain's ticks on the matchup adjust the proposal only and do not
  change players' answers.

## Log

- 2026-10-29: Written with the owner. Web support follows later as its own feature.
- 2026-10-29: Availability comes from players through 032, so 029 now depends on it.
