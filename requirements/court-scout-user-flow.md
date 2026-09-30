# Court Scout user flow requirements

Date: 2026-08-14

## Product context

Court Scout supports a team preparing for a 17-team flight. The user may gather
and analyze several teams for reconnaissance, but only four scheduled opponents
should drive match preparation.

This creates three distinct team roles:

1. **Our team** — one pinned team used as the home side of matchup planning.
2. **Scheduled opponents** — up to four teams that appear in Match Day Cards.
3. **Scouting pool** — other gathered teams that remain available for reports
   and comparison but are not currently on the schedule.

Collections are optional. A user may gather and analyze a standalone, unfiled
team report without creating a collection. Our team and opponent roles only
exist inside a specific collection; the aggregate **All gathered teams** view
is not itself a collection.

## Current flow

1. Paste a TennisRecord team profile URL.
2. Choose optional public or authenticated UTR ratings.
3. Wait while Court Scout gathers and validates the dataset.
4. Review roster, opponent, match, and source data.
5. Choose a National, Sectional, or Local eligibility target and run a team
   report covering eligibility, singles, doubles, and likely lineups.
6. Repeat collection for other teams.
7. Select two gathered teams to create a Match Day Card.
8. Adjust our lineup against an opponent scenario, review court-level
   comparisons, mark the card final, and print or save it as a PDF.

## What works well

- Facts, source provenance, and analysis are clearly separated.
- Collection progressively discloses optional rating choices.
- Refresh protects the last valid dataset.
- Team reports expose evidence and qualify lineup projections appropriately.
- Match Day Cards start from a useful projected lineup but remain editable.
- Keyboard tab behavior, focus movement, errors, and print support are handled.

## Current problems

1. Stage 1 contains collection, review, and analysis, although its labels imply
   collection alone.
2. Gathered teams have no explicit role, so our team, scheduled opponents, and
   reconnaissance targets are indistinguishable.
3. The handoffs from our team to gathering an opponent and from an opponent
   report to matchup preparation are manual.
4. Match preparation has no useful recovery action when required teams have
   not been classified or gathered.
5. Match Day Cards always use National eligibility even when a different
   report scope was selected.
6. Cards are stored on one device and navigation state is not represented in
   the URL.

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

Court Scout uses three distinct stages:

1. **Scout teams** — enter a team URL, choose optional rating sources, and gather
   the standalone dataset.
2. **Reports & analysis** — navigate gathered teams, organize collections,
   review source data, and run team analysis through an explicit two-step
   **Review report → Analyze team** flow.
3. **Match cards** — prepare, edit, finalize, and share scheduled matchups.

### Phase A — Scouting workspace

1. Gather or select a team as a standalone report.
2. From the completed report, optionally create or choose an event collection.
3. Within that collection, classify the team as **Our team**, a **Scheduled
   opponent**, or part of the **Scouting pool**.
4. Leave teams unfiled when only a standalone scouting report is needed.
5. Keep detailed reports available for every gathered team.
6. Show scheduled-opponent readiness separately from general scouting
   coverage.
7. Send only our team and scheduled opponents into Match Day Card creation.
8. Provide contextual actions to scout another team, add a team to the
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

1. Select a scheduled opponent, date, location, and eligibility target.
2. Review data freshness, unresolved identities, eligible roster size, and
   lineup-prediction availability.
3. Start from likely lineups for both teams.
4. Test scenarios, resolve warnings, finalize, and share the card.

## Priorities

### P0

- Persist one Our Team assignment and up to four scheduled opponents.
- Separate scheduled opponents from the broader scouting pool.
- Add contextual handoffs between collection, reports, and Match Day Cards.
- Add eligibility scope to Match Day Cards.
- Improve the empty and blocked states in match preparation.

### P1

- Add routable team, report-tab, and card state.
- Show data freshness and unresolved identities before matchup creation.
- Support retrying individual failed collection sources.

### P2

- Persist cards server-side.
- Add share links and structured card import/export.
- Add notes and lineup version history.
