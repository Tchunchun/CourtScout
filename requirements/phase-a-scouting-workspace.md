# Tennis Court Scout Phase A — Scouting workspace requirements

Date: 2026-08-14

Status: Partially superseded by schedule-driven Match Day planning on
2026-09-30. The separate Scheduled opponent role and four-opponent cap below
are retained as historical context; current Match Day opponents are derived
from confirmed scheduled matches.

## Goal

Make a large flight manageable by distinguishing the four teams on the
schedule from other teams gathered for reconnaissance.

## Implementation status

### Confirmed team intake — Complete

- [x] Choose Home team or Opponent team before gathering.
- [x] Resolve and explicitly confirm the TennisRecord team identity.
- [x] Identify single-gender versus mixed league format.
- [x] Preview every dated league opponent for a home team.
- [x] Gather the home team and all discovered opponents into one collection.
- [x] Gather only the confirmed team for an opponent-team intake.
- [x] Reuse an active job when the same confirmed intake is submitted again.
- [x] Preserve league format and player gender for rating and lineup analysis.

## Requirements

### Team classification

- Collections are optional; unfiled teams remain fully reviewable and
  analyzable standalone reports.
- The workspace has at most one **Our team**.
- The workspace supports up to four **Scheduled opponents**.
- Every other gathered dataset belongs to the **Scouting pool**.
- Reassigning Our team moves the previous Our team into the scouting pool.
- Removing a scheduled opponent returns it to the scouting pool.
- Classification is local workspace metadata and must not alter canonical team
  datasets.
- A collection may define shared Match Day defaults for a known schedule.
  Defaults initialize an unconfigured browser without replacing later local
  classifications.
- Our team and scheduled-opponent assignments are scoped to the active event
  collection so different flights or tournament stages can have independent
  schedules.
- **All gathered teams** is an aggregate view, not a collection, and cannot
  own team-role assignments.

### Collection

- Scouting starts in a temporary event collection.
- The user reviews and confirms the resolved TennisRecord team identity before
  collection begins.
- Confirmation identifies whether the source is a single-gender or mixed
  league.
- Home-team confirmation previews every dated league opponent that will be
  gathered.
- Home-team scouting gathers the pasted team and every dated league opponent
  linked from its TennisRecord schedule into the same collection.
- Opponent-team scouting gathers only the pasted team.
- After gathering, the user may move a team to another collection or leave it
  unfiled.
- A filed team may be classified as Our team, a scheduled opponent, or a
  scouting-pool team.
- The team-role control is unavailable while the report remains unfiled.

### Team navigation

- The gathered-team sidebar groups Our team, Scheduled opponents, and Scouting
  pool separately.
- Each group shows an informative empty state.
- The selected dataset remains visually identifiable.
- A team can be reclassified from its dataset review screen.
- The Team reports page always uses one team list rather than separate
  scheduled and unscheduled lists.
- Without a schedule, that list preserves the gathered-team order and offers
  report access.
- With a schedule, scheduled opponents appear first in schedule order and
  expose a direct **Prepare match** action; unscheduled teams remain in the
  same list with report access only.

### Handoffs

- Our team offers a direct **Scout an opponent** action.
- A scouting-pool team can be added to the schedule without recollection.
- A scheduled opponent offers a direct **Build matchup** action.
- Detailed team analysis remains available for all three roles.

### Match preparation readiness

- Match Day Card creation uses the pinned Our team by default.
- New opponent choices come from Scheduled opponents.
- If Our team is missing, the page offers a direct action to gather or assign
  it.
- If no scheduled opponent exists, the page offers a direct action to gather
  one.
- The page shows scheduled-opponent progress against the four-team target.

## Acceptance criteria

- Changing the team type or TennisRecord URL invalidates the prior
  confirmation.
- Collection cannot begin until the current team type and URL have been
  resolved and confirmed.
- League format is preserved in the canonical dataset and used by lineup
  analysis. Mixed doubles combinations respect known player genders.
- Existing gathered datasets load safely as scouting-pool teams until the user
  classifies them.
- Classifications survive reloads in the same browser.
- A fifth scheduled opponent is rejected with an actionable message.
- Our team cannot simultaneously be a scheduled opponent.
- Match Day Card creation cannot accidentally default an opponent dataset as
  Our team merely because it was last viewed.
- Existing saved Match Day Cards continue to open even if team classifications
  later change.
