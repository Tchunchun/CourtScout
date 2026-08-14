# Team Data Contract for Downstream Analysis

## Contract files

- Schema: `contracts/team-data.schema.json`
- Dataset: `data/<dataset-id>/team-data.json`
- Current contract version: `2.0.0`

The collector owns factual acquisition and normalization. Downstream analysis reads the canonical dataset and must not scrape source websites or silently repair source data.

## Readiness states

| `collectionStage` | Meaning | Analysis allowed |
|---|---|---|
| `tennisrecord_complete` | Team, roster, and available TennisRecord matches collected | Preliminary analysis only |
| `utr_partial` | UTR enrichment started but unresolved work remains | Preliminary analysis with missing-rating warnings |
| `step_1_complete` | Collection, rating enrichment, reconciliation, and validation complete | Final report generation |

Final reports must require `collectionStage == "step_1_complete"`.

`ratingSelections` records the user's optional rating choices. `utr` is `none`,
`public`, or `authenticated`; `wtn` is boolean. A missing rating source is not a
collection failure when that source was not selected. Once all selected sources
have run and validation passes, the dataset is complete even when one or both
rating systems were intentionally skipped.

## Authoritative entities

### `team`

Team identity, league attributes, season, and official aggregate totals.

### `roster[]`

One record per target-team player:

- `name` and optional `location`
- `ntrp.level` and `ntrp.type`
- current TennisRecord `dr`
- `utr.singles` and `utr.doubles`
- public `wtn.singles` and `wtn.doubles`, including source confidence
- singles/doubles records
- actual/default qualifying appearances
- Sectionals usage
- Nationals eligibility

### `opponents[]`

One normalized record per unique opponent:

- identity and candidate profile information
- exact authenticated singles/doubles UTR when resolved
- public singles/doubles WTN and confidence for roster players when resolved
- explicit unresolved status otherwise
- every appearance against the target team
- historical DR evidence attached to each appearance

### `matches[]`

One record per team match. `courts` is keyed by the source court label (`S1`, `S2`, `D1`, `D2`, `D3`, or another format).

Each court contains:

- both teams' player names
- result from the target team's perspective
- score and adjudication
- normalized target-player rating joins
- normalized opponent-player rating joins
- source rating evidence

`teamResult` is the result currently selected under source precedence and records its source and whether it is authoritative. `officialTeamResult` is nullable until an official USTA result has been reconciled.

The reusable contract uses `targetPlayers` and `targetRatings` for the team named in `team`. Opposing players use `opponentPlayers` and `opponentRatings`.

## Rating rules

1. `value`/`exactValue` is numeric only when the exact value was observed.
2. `null` means missing, unrated, or unresolved. Never treat it as zero.
3. `display == "NR"` means no usable rating.
4. Projected ratings remain marked as projected; analysis may not present them as verified.
5. Exact authenticated UTR values override public masked bands such as `3.xx`.
6. Never convert a public band into a decimal estimate.
7. Singles and doubles UTR are distinct and must not be substituted for one another.
8. WTN uses the inverse 1–40 scale; lower values indicate stronger players.
9. Singles and doubles WTN are distinct and include the source confidence percentage.
10. Singles opponent historical DR is individual evidence.
11. Doubles historical DR may be pair-average evidence. It must not be copied to each player as an individual DR.

## Result and source precedence

Use this order when sources conflict:

1. Official USTA/TennisLink adjudicated result
2. TennisRecord match detail
3. TennisRecord team aggregate
4. Derived totals

Preserve both `onCourtResult` and the official result for DQ reversals. Final records and eligibility use the official adjudicated result unless the eligibility regulation explicitly requires actual participation.

## Analysis may derive

- Nationals eligibility summaries
- Local, Sectional, or Nationals eligibility using a user-selected scope
- player singles/doubles records
- pair records and pair ratings
- court strength and stacking patterns
- postseason-weighted usage
- probable lineups
- strategy and attack points
- HTML reports

## Analysis service

The backend exposes factual, report-ready analysis without changing the canonical
team dataset:

- `GET /api/teams` lists selectable datasets and the supported eligibility
  scopes. The default scope is `national`.
- `GET /api/analysis?team=<catalog-id>&eligibility=<scope>` returns overview,
  eligibility, singles, doubles, source, and data-quality metrics. Supported
  scopes are `local`, `sectional`, and `national`.

Eligibility thresholds are:

| Scope | Computer rated | Self rated or appealed |
|---|---:|---:|
| Local | 0 | 0 |
| Sectional | 2 | 3 |
| National | 3 | 4 |

One received default may count for a computer-rated player. Self-rated and
appealed players must meet the threshold with actual matches. Disqualified
players remain unavailable at every scope.

The service reconciles roster appearance counters with the match ledger. A
zeroed counter still marked `unknown` may use the match ledger as an explicitly
identified fallback. Other mismatches retain the roster value and are disclosed
in `eligibility.dataQualityIssues`; the canonical dataset is never rewritten.
Each eligibility player also includes current DR and UTR, local singles and
doubles appearances with records, postseason appearances, a lineup role, and a
factual standout note. Source-provided `likelyRole` and `note` values take
precedence; otherwise the service derives them from discipline share, primary
court responsibility, roster-relative DR/UTR strength, records, postseason use,
eligibility-floor risk, singles upset evidence, and primary partnerships.

Singles output includes court and player records, phase/postseason splits,
court usage, curated or usage-derived likely roles, every known result, exact
scores, source rating displays, DR and singles-UTR comparisons, lower-rated
wins, favorite losses, and per-match stacking.

Doubles output includes court records, normalized pair records regardless of
player order, repeat and one-off pair groupings, phase/postseason splits,
current pair DR/UTR and rating completeness, every known result, lower-rated
wins, favorite losses, and per-match stacking. Historical pair-average DR
evidence remains pair evidence and is not assigned to either individual.

Lineup prediction output includes up to three complete, non-overlapping court
configurations. Court choices are ranked from eligible-player history using
frequency, recency, and postseason weighting. Each prediction discloses
historical support, court-level evidence, and whether the full configuration
was previously observed together; predictions do not override source facts.

## Analysis must not override

- source identity matches
- exact ratings
- official match results
- DQ/default/retirement adjudications
- source precedence
- unresolved-profile status

If analysis discovers a factual conflict, it must add a data-quality issue and send the dataset back through collection/reconciliation rather than silently changing the fact.

## Required report disclosures

- Retrieval dates for TennisRecord, UTR, WTN, and USTA
- Projected and unresolved ratings
- Identity ambiguities
- Missing official postseason data
- DQ/default adjustments
- Whether the report used a complete or partial dataset

## Minimum semantic validation

Before final analysis:

1. Roster names are unique.
2. Match IDs are unique.
3. Each court has the expected player count unless defaulted.
4. Player arrays and rating-join arrays have equal lengths.
5. Every target player joins to the roster.
6. Every opponent joins to `opponents[]`.
7. Court totals equal aggregate totals when official totals are available.
8. Resolved UTR profiles include provenance and retrieval date.
9. Unresolved profiles have `null` exact values and an explicit blocker.
10. Resolved WTN profiles include provenance, retrieval date, and confidence.
11. `schemaVersion` and `collectionStage` are supported by the analysis program.
