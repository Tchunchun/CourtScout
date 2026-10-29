---
id: "004"
title: Split web/public/app.js into view modules
status: ready
priority: P1
area: web
source: requirements/ios-app-plan.md (Pre-work 1)
depends_on: []
touches:
  - web/public/app.js
  - web/public/index.html
  - web/public/
branch:
pr:
updated: 2026-10-29
---

## Goal

`app.js` (about 5,000 lines) is split into modules by view so the API calls each view depends on are visible.

## Done when

- [ ] Each view lives in its own module; `app.js` only wires them together.
- [ ] No behavior change: the web app works as before in the browser (scouting, reports, Match Day Cards, print).
- [ ] `npm test` passes.

## Notes for the coding agent

This touches nearly every web feature. Run it alone: no other feature that touches `web/public/` should be in progress at the same time. Follow the pattern of the existing modules (`match-card.mjs`, `navigation.mjs`, `render.mjs`, `schedule.mjs`, `team-workspace.mjs`).

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
