# Tennis Court Scout user flow requirements

Date: 2026-08-14

## Product context

Tennis Court Scout supports a team preparing for a large flight or event. The
user may gather and analyze several teams for reconnaissance, while confirmed
scheduled matches drive match preparation.

The current schedule-driven model has two maintained team roles:

1. **Our team** — one pinned team used as the home side of matchup planning.
2. **Scouting pool** — other gathered teams that remain available for reports
   and comparison but are not currently on the schedule.

Scheduled opponents are derived from confirmed schedule matches. Users do not
maintain a separate opponent role or four-opponent cap.

Each intake starts in a temporary collection so a home team and its discovered
league opponents stay together. Teams may later be moved or unfiled. Home-team
and opponent roles only exist inside a specific collection; the aggregate
**All gathered teams** view is not itself a collection.

## Current flow

1. Paste a TennisRecord team profile URL.
2. Choose optional public or authenticated UTR ratings.
3. Wait while Court Scout gathers and validates the dataset.
4. Review roster, opponent, match, and source data.
5. Choose a National, Sectional, or Local eligibility target and run a team
   report covering eligibility, singles, doubles, and likely lineups.
10. Repeat collection for other teams.
11. Select two gathered teams to create a Match Day Card.
12. Adjust our lineup against an opponent scenario, review court-level
   comparisons, mark the card final, and print or save it as a PDF.

## What works well

- Facts, source provenance, and analysis are clearly separated.
- Collection progressively discloses optional rating choices.
- Refresh protects the last valid dataset.
- Team reports expose evidence and qualify lineup projections appropriately.
- Match Day Cards start from a useful projected lineup but remain editable.
- Keyboard tab behavior, focus movement, errors, and print support are handled.

## Requirement status

1. **Implemented:** confirmed intake resolves the team, identifies league
   format, previews home-team opponents, and keeps one run in one collection.
2. **Implemented:** collection, reports, and Match Day Cards use distinct
   stages.
3. **Implemented:** gathered teams have collection-scoped Our team, Scheduled
   opponent, and Scouting pool roles.
4. **Implemented:** reports provide contextual Scout opponent, Add to schedule,
   and Build matchup handoffs.
5. **Implemented:** match preparation provides recovery actions when Our team
   or scheduled opponents are missing.
6. **Implemented:** each Match Day Card stores and uses its selected National,
   Sectional, or Local eligibility target.
7. **Implemented:** cards synchronize through the local server with browser
   storage as an offline cache, and navigation state is represented in the URL.

## Implementation status

As of 2026-09-30, the three-stage workspace, collection-scoped team roles,
contextual handoffs, match-preparation recovery actions, and Match Day Card
eligibility targets are implemented. Gathered-team navigation is grouped by
Our team, Scheduled opponents, and Scouting pool when an event collection is
active.

Team report tabs, analysis tabs, and saved Match Day Cards are represented in
the URL for bookmarks and browser back/forward navigation. Server-side card
persistence and share links remain the separate Phase P2 enhancement described
below; cards otherwise continue to be stored in the current browser.

## Target flow

Tennis Court Scout uses three distinct stages:

1. **Scout teams** — choose the team type, enter a team URL, choose optional
   rating sources, and gather the temporary collection.
2. **Reports & analysis** — navigate gathered teams, organize collections,
   review source data, and run team analysis through an explicit two-step
   **Review report → Analyze team** flow.
3. **Match cards** — prepare, edit, finalize, and share scheduled matchups.

### Phase A — Scouting workspace

1. Choose a home-team or opponent-team scouting run.
2. Resolve and confirm the pasted TennisRecord team before gathering.
3. For a home team, preview all dated league opponents discovered from the
   schedule and identify whether the league is single-gender or mixed.
4. Create a temporary collection for the confirmed run.
5. For a home team, gather the home profile and all league opponent profiles
   found on its TennisRecord schedule into that collection.
6. For an opponent team, gather only the pasted profile into that collection.
7. Within that collection, classify the team as **Our team**, a **Scheduled
   opponent**, or part of the **Scouting pool**.
8. Leave teams unfiled later when only a standalone scouting report is needed.
9. Keep detailed reports available for every gathered team.
10. Show scheduled-opponent readiness separately from general scouting
   coverage.
11. Send only our team and scheduled opponents into Match Day Card creation.
12. Provide contextual actions to scout another team, add a team to the
   schedule, and build a matchup.

### Phase B — Evidence-led team reports

Phase B does not mean hiding or skipping opponent research. It separates two
valid intents:

- **Understand a team:** open its detailed report to study eligibility,
  singles usage, doubles pairs, stacking, and likely lineups.
- **Prepare a scheduled match:** create a Match Day Card, which may calculate
  the required report data automatically rather than forcing the user through
  the report screen first.

Reports therefore remain first-class for any team in the 17-team flight. The
change is that viewing a report is not a mandatory wizard step before a card
can be created. A user can scout several unscheduled teams, compare their
patterns, and later promote one to a scheduled opponent without collecting it
again.

Future Phase B enhancements should add:

- a report-level **Add to schedule** or **Build matchup** action;
- clearer opponent-oriented report language;
- report summaries that emphasize personnel, repeat pairs, recent usage, and
  lineup volatility;
- a scouting-pool comparison view for deciding which reports warrant deeper
  review;
- automatic reuse of existing analysis when a Match Day Card is opened.

### Phase C — Match preparation

1. Open the active event's confirmed schedule and select a scheduled match.
2. Review data freshness, unresolved identities, eligible roster size, and
   lineup-prediction availability.
3. Review the opponent active roster with ratings, known pairs, and
   evidence-qualified stacking strategy when available.
4. Start from likely lineups for both teams.
5. View up to three evidence-backed opponent lineups and challenge Our lineup
   against each scenario with transparent court-edge pros and risks.
6. Resolve warnings, finalize, and share the card.

Each Match Day Card stores its eligibility target. Both team analyses and
lineup eligibility use that target when the card opens. Existing cards without
a stored target continue to use National eligibility.

Schedule-driven planning uses one stable scheduled-match identity and one
primary Match Day Card per match. Future scoreless TennisRecord rows remain in
the schedule, and reopening a match resumes its existing preparation.

#### Schedule-driven implementation status

- [x] Normalize local TennisRecord schedule rows with stable match identities.
- [x] Preserve future scoreless rows separately from completed match history.
- [x] Retain opponent URL, date/time, site, status, and source provenance.
- [x] Open Match Day planning on the confirmed schedule list.
- [x] Resolve opponents only by stable URL or one unambiguous exact name.
- [x] Create or resume one primary Match Day Card per scheduled match.
- [x] Add CSV import, correction, and confirmation for shared event schedules.
- [x] Add schedule reconciliation preview for changed, removed, and postponed
  matches.
- [x] Add explicit opponent-resolution UI for ambiguous gathered teams.
- [x] Return to the originating scheduled match after opponent scouting.
- [x] Support Local, Sectionals, Nationals, and Other event types with
  eligibility defaults.
- [x] Use event-format-aware court requirements for mixed and single-gender
  cards.
- [x] Add Not started, Draft, Final, and Archived card statuses with guarded
  finalization.
- [x] Preserve notes, lineups, and cards across schedule/data refreshes.
- [x] Migrate exact legacy cards and keep unmatched cards available to archive.

## Priorities

### P0

- [x] Persist one Our Team assignment and derive opponents from its confirmed
  event schedule.
- [x] Separate scheduled matches from the broader scouting pool.
- [x] Add contextual handoffs between collection, reports, and Match Day Cards.
- [x] Add eligibility scope to Match Day Cards.
- [x] Improve the empty and blocked states in match preparation.

### P1

- [x] Add routable collection, team, report-tab, scheduled-match, and card
  state.
- [x] Show data freshness, unresolved identities, eligible roster size, and
  lineup-scenario availability before lineup planning.
- [x] Support retrying individual TennisRecord, UTR, or WTN sources.

### P2

- [x] Persist cards server-side with local migration and offline caching.
- Add share links and structured card import/export.
- Add notes and lineup version history.
