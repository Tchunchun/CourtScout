---
id: "036"
title: Set the app's time zone, defaulting to Pacific Time
status: idea
priority: P1
area: server
source: Owner request, planning session 2026-10-29
depends_on: []
touches:
  - scripts/lib/app-settings.mjs
  - web/server.mjs
  - contracts/api.openapi.yaml
  - web/public/app.js
  - web/public/index.html
  - test/app-settings.test.mjs
  - test/server.test.mjs
  - ios/CourtScoutKit/Sources/CourtScoutCore/APIClient.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/Components.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/AppModel.swift
  - ios/CourtScoutKit/Sources/CourtScoutUI/SeasonsView.swift
branch:
pr:
updated: 2026-10-29
---

## Goal

Every date and time in Court Scout shows in one known time zone. The app
default is Pacific Time, and a season can use its own zone, for example
Nationals in another state.

## Done when

- [ ] An app setting holds the time zone as an IANA name. When unset, it is
      `America/Los_Angeles`, so it shows PST in winter and PDT in summer.
- [ ] The captain can change it from settings on the web and on the phone,
      choosing from a list of US zones with a way to pick any other IANA
      zone. Invalid names are rejected.
- [ ] A season's schedule time zone overrides the app setting for that
      season. An empty season zone uses the app setting, and the web shows
      that instead of "Timezone TBD".
- [ ] Match dates and times on the web and the phone show in the season's
      zone (or the app zone) with its abbreviation, e.g. "Sat Nov 7, 2:00 PM
      PST". A match date never shifts by a day.
- [ ] "Gathered", "Analyzed" and "Card updated" timestamps show in the app
      zone, not the device or UTC.
- [ ] The setting is saved through `store.mjs` and served under `/api/v1`,
      documented in `contracts/api.openapi.yaml`. A change shows on another
      device after it reloads.
- [ ] Tests cover the default, an override, an invalid zone, and a
      daylight-saving date. `npm test` passes and the iOS checks in
      `ios/README.md` pass.

## Notes for the coding agent

- Schedules already have `timezone` at the season and match level
  (`scripts/lib/event-schedules.mjs`), always null from TennisRecord. The web
  schedule import has a free-text Timezone box in `web/public/index.html`.
- Today the web formats dates in UTC (`app.js` near line 1002) and
  timestamps with the browser's zone. The phone formats dates in UTC in
  `Components.swift`.
- Match times from TennisRecord are local wall-clock times ("2:00 PM"). Treat
  them as times in the season's zone, and don't convert them from UTC.
- Store the setting next to team roles and pairs (`team-roles.mjs`,
  `team-pairs.mjs`) using the same revision pattern.
- Later features that send times (practices in 032, lineup emails in 033)
  read this setting.

## Log

- 2026-10-29: Written with the owner. App default plus per-season override;
  Pacific Time with daylight saving rather than fixed UTC−8.
