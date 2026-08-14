# Reusable Team Data Collector

The pipeline accepts a TennisRecord team URL and produces the versioned data contract consumed by scouting analysis.

## What the pipeline collects

1. Target team identity and roster
2. Target-player location, NTRP level/type, DR, and TennisRecord records
3. Every completed match exposed on the TennisRecord team page
4. Both teams' lineups, scores, results, defaults, and historical match DR
5. Opponent-team roster location and current DR
6. Exact authenticated singles/doubles UTR for target and opponent players
7. Public singles/doubles WTN and confidence for target-team roster players
8. Eligibility inputs, appearances, records, provenance, unresolved identities, and coverage warnings

## Prerequisites

```bash
npm install
command -v agent-browser
```

## 1. Collect TennisRecord data

```bash
npm run collect -- \
  --team-url "https://www.tennisrecord.com/adult/teamprofile.aspx?..." \
  --output "data/<team-id>/team-data.json" \
  --delay-ms 250
```

This stage is unattended and writes `collectionStage: "tennisrecord_complete"`.
TennisRecord uses both `Courts Won` and `Points Won` match summaries. The
collector supports either label and derives court win/loss totals from the
individual court results, so different league scoring formats remain
comparable.

## 2. Enrich UTR ratings

First run UTR visibly so the user can sign in:

```bash
npm run enrich:utr -- \
  --input "data/<team-id>/team-data.json" \
  --session utr-collector \
  --headed \
  --delay-ms 10000
```

After sign-in, rerun the same command if necessary. The script:

- processes one profile at a time;
- spaces authenticated UTR requests ten seconds apart by default;
- pauses all UTR activity with exponential backoff when UTR returns a rate limit;
- atomically checkpoints after every player;
- resumes from `data/.cache/utr-profiles.json`;
- reuses profiles across all 17 teams;
- matches exact names and prefers location matches;
- leaves ambiguous identities unresolved unless `--accept-ambiguous` is explicitly provided.

For large batches, do not delete the cache. It prevents duplicate UTR requests when players appear on multiple teams.

Public enrichment also uses a persistent cross-team cache at
`data/.cache/utr-public-profiles.json` and spaces searches three seconds apart.
The web app serializes UTR enrichment across collection jobs, so starting
several team collections cannot create concurrent UTR request bursts.

## 3. Enrich WTN ratings

WTN enrichment uses the public player search and does not require sign-in:

```bash
npm run enrich:wtn -- --input "data/<team-id>/team-data.json"
```

It matches exact names and genders, prefers location matches, and leaves tied
identities unresolved when location cannot disambiguate them.

## 4. Validate

```bash
npm run validate:data -- --input "data/<team-id>/team-data.json"
```

Use `--allow-partial` only while diagnosing the TennisRecord stage:

```bash
npm run validate:data -- \
  --input "data/<team-id>/team-data.json" \
  --allow-partial
```

## Batch workflow

Run collection for all teams first. Then use one authenticated UTR session and
the shared cache for UTR enrichment, followed by public WTN enrichment:

```bash
while IFS= read -r url; do
  npm run collect -- --team-url "$url"
done < team-urls.txt

while IFS= read -r team; do
  npm run enrich:utr -- --input "$team" --session utr-collector --delay-ms 10000
  npm run enrich:wtn -- --input "$team"
done < team-data-paths.txt
```

UTR enrichment should remain sequential, not parallel, to avoid throttling.

## Important coverage limitation

A TennisRecord URL can only expose matches known to TennisRecord. It may omit Sectionals, use a scheduled rather than played date, or retain a result later changed by USTA adjudication.

Therefore the dataset records:

```json
{
  "dataQuality": {
    "coverage": {
      "officialUstaReconciled": false
    }
  }
}
```

Final analysis must disclose this state. When official USTA scorecards are available, merge them under the source-precedence rules in `contracts/DATA_CONTRACT.md`; official USTA results supersede TennisRecord.

## Contract

- Human-readable: `contracts/DATA_CONTRACT.md`
- Machine-readable: `contracts/team-data.schema.json`
- Current schema: `2.0.0`
