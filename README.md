# Court Scout data collection

Court Scout collects a TennisRecord team profile, enriches its players with UTR
and public World Tennis Number (WTN) ratings, validates the result, and presents
the canonical dataset in a readable local web interface.

## Start the app

```bash
npm start
```

Open `http://localhost:4173`, paste a TennisRecord team profile URL, and choose
which optional ratings to collect:

- **Exact UTR:** opens UTR in a separate browser so the user can sign in
  directly. Court Scout reuses that local browser session and never receives or
  stores the user's UTR password.
- **Public UTR:** requires no sign-in and preserves UTR's masked displays, such
  as `1.xx`. It never estimates or invents hidden decimals.
- **WTN:** requires no sign-in and collects public singles and doubles values for
  the team roster, with the confidence percentage reported by the WTN source.

UTR and WTN can be selected independently, together, or both left off.

By default, Court Scout reads and writes reports in `./data`. Linked Git
worktrees automatically reuse the primary checkout’s data folder when it
contains `team-collections.json`, so prior collections remain available in
Reports & Analysis. Set `COURT_SCOUT_DATA_DIR` in a local `.env` file to
explicitly use another data folder; see `.env.example`.

Completed datasets are saved in readable, timestamped folders such as
`data/collections/2026-sunnyvale-mtc-18aw3.0d-public-20260814T161807Z/team-data.json`.
The web interface provides roster, opponent, match, and source views plus a JSON
download for the next analysis phase.

Event collections are optional. A team may remain unfiled as a standalone
scouting report and can be assigned to a collection later.

Within each event collection, Court Scout keeps local workspace roles separate
from the canonical datasets:

- Create **Event collections** for sectionals, nationals, or another event, then
  file each gathered team into the relevant collection.
- From a team report, create a collection and file that team into it.
- Pin one gathered dataset as **Our team**.
- Add up to four teams as **Scheduled opponents** for Match Day Cards.
- Keep other gathered flight teams in the **Scouting pool** for reports and
  reconnaissance without adding them to match preparation.

Event collections are shared through `data/team-collections.json`. Scouting
always creates a standalone report first; the completed report can then be filed
into a collection and assigned a role.

Team analysis is saved beside each raw dataset as
`analysis/<eligibility-scope>.json`. Match Cards reuse a saved analysis while it
matches the current dataset and regenerate it after source data changes.
Unfiled teams and the aggregate **All gathered teams** view do not have team
roles. Team roles and Match Day Cards are saved locally in the current browser.
Each Match Day Card preserves its National, Sectional, or Local eligibility
target. Team report tabs, analysis tabs, and saved cards also have URL routes so
browser back/forward navigation and bookmarks reopen the same workspace.

For an existing gathered team, use **Refresh data** to repull any combination of
TennisRecord, UTR, and WTN. Unselected sources and curated player roles/notes are
preserved. Refresh runs against a temporary copy, validates the result, and only
then replaces the existing dataset; a failed refresh leaves the previous data
available.

## Validation

```bash
npm test
npm run validate:data -- --input data/<dataset-id>/team-data.json
```
