---
id: "014"
title: Share a TennisRecord team link to the app
status: done
priority: P1
area: ios
source: requirements/ios-app-plan.md (Phone user flow, step 1)
depends_on: []
touches:
  - ios/CourtScout.swiftpm/
branch:
pr:
updated: 2026-10-29
---

## Goal

From Safari, Share → Court Scout opens New season with the link filled in.

## Done when

- [x] Sharing a TennisRecord team profile link opens the New season preview.

## Notes for the coding agent

Check first whether a `.swiftpm` app package can include a share extension; it may need an Xcode project.

## Log

- 2026-10-29: Seeded from `requirements/ios-app-plan.md`.
- 2026-10-29: Built before the features process in 8e90aed ("Add a Safari
  share extension for TennisRecord team links"); the app moved to
  `CourtScout.xcodeproj` to hold the extension. Merged with #3. Marked done.
