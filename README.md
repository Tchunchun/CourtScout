# Tennis Court Scout data collection

Tennis Court Scout collects a TennisRecord team profile, enriches its players with UTR
and public World Tennis Number (WTN) ratings, validates the result, and presents
the canonical dataset in a readable local web interface.

## Start the app

```bash
npm start
```

Open `http://localhost:4173`, paste a TennisRecord team profile URL, and choose
whether it is the home team or an opponent. Tennis Court Scout first resolves
the page for confirmation. Home-team confirmation previews every dated league
opponent that will be gathered; opponent-team confirmation gathers only the
resolved profile. After confirmation, choose which optional ratings to collect:

- **Exact UTR:** opens UTR in a separate browser so the user can sign in
  directly. Tennis Court Scout reuses that local browser session and never receives or
  stores the user's UTR password.
- **Public UTR:** requires no sign-in and preserves UTR's masked displays, such
  as `1.xx`. It never estimates or invents hidden decimals.
- **WTN:** requires no sign-in and collects public singles and doubles values for
  the team roster, with the confidence percentage reported by the WTN source.

UTR and WTN can be selected independently, together, or both left off.

TennisRecord currently chains to the GoDaddy TLS Root CA R1, which is newer
than the CA bundle in some Node installations. The collector pins that public
root only for `tennisrecord.com` requests; TLS verification remains enabled.

By default, Tennis Court Scout reads and writes reports in `./data`. To share reports
across Git worktrees, set `COURT_SCOUT_DATA_DIR` in a local `.env` file to the
shared data folder; see `.env.example`.

Completed datasets are saved in readable, timestamped folders such as
`data/collections/2026-sunnyvale-mtc-18aw3.0d-public-20260814T161807Z/team-data.json`.
The web interface provides roster, opponent, match, and source views plus a JSON
download for the next analysis phase.

Each new scouting run starts in an automatically created temporary event
collection. Teams can still be moved to another collection or made unfiled
later.

Within each event collection, Tennis Court Scout keeps local workspace roles separate
from the canonical datasets:

- Create **Event collections** for sectionals, nationals, or another event, then
  file each gathered team into the relevant collection.
- From a team report, create a collection and file that team into it.
- Pin one gathered dataset as **Our team**.
- Add up to four teams as **Scheduled opponents** for Match Day Cards.
- Keep other gathered flight teams in the **Scouting pool** for reports and
  reconnaissance without adding them to match preparation.

Event collections are shared through `data/team-collections.json`. Each scouting
run creates a temporary event collection. An opponent-team run gathers only the
pasted profile. A home-team run also discovers every dated league opponent on
the TennisRecord schedule and gathers all of those teams into the same
collection.

Team analysis is saved beside each raw dataset as
`analysis/<eligibility-scope>.json`. Match Cards reuse a saved analysis while it
matches the current dataset and regenerate it after source data changes. Each
Match Day Card stores its selected National, Sectional, or Local eligibility
target; existing cards default to National.
Local Match Day planning reads normalized schedule entries from Our team's
TennisRecord dataset, keeps future scoreless rows, and creates or resumes one
primary card per stable scheduled-match ID.
The preparation workspace shows up to three evidence-backed opponent lineup
scenarios and scores the editable Our-team lineup against each using
court-level DR/UTR edges, swing courts, risks, and limited-data disclosures.
Shared event schedules can be imported from CSV, mapped, corrected, excluded
row by row, reconciled against the confirmed schedule, and confirmed without
discarding cards for postponed or removed matches. Manual match entry remains
available as a fallback.
Unfiled teams and the aggregate **All gathered teams** view do not have team
roles. Team roles are cached in the current browser. Match Day Cards synchronize
through `data/match-cards.json` and retain browser storage as an offline cache.

For an existing gathered team, use **Refresh data** to repull any combination of
TennisRecord, UTR, and WTN for the team roster, opponents, or both. Unselected
ratings, sources, and curated player roles/notes are preserved. Initial UTR and
WTN gathering includes both roster and opponent profiles. Refresh runs against a
temporary copy, validates the result, and only then replaces the existing
dataset; a failed refresh leaves the previous data available.

## Validation

```bash
npm test
npm run validate:data -- --input data/<dataset-id>/team-data.json
```
