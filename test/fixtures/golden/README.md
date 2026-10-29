# Analysis golden files

These fixed, anonymized inputs and complete JSON outputs are the parity baseline
for ports and refactors of `scripts/lib/analysis.mjs`. Each input has expected
`analysis/local.json`, `analysis/sectional.json`, and `analysis/national.json`.

| Input | Roster | Matches | Coverage |
| --- | ---: | ---: | --- |
| women-sparse | 4 | 0 | Empty history, preliminary disclosure, no lineup predictions |
| women-rich | 15 | 6 | Singles and doubles, local and sectional play, repeated pairs, rating comparisons |
| mixed-sparse | 6 | 1 | Doubles-only history, one deliberately unresolved player gender |
| mixed-rich | 14 | 3 | Multiple lineups and pairs, missing ratings, eligibility exclusions |

Inputs were trimmed from the committed Hawaii Game Set Matcha and PL-Sych
collections under `data/collections/`. Player and opponent names, team names,
match IDs, and source URLs were replaced with fixture identifiers. Profile
candidates, external IDs, locations, source pages, schedules, and free-form
identity notes were removed. Ratings, scores, match dates, rating types, and
season appearance counts were retained. Appearance counts may therefore exceed
the trimmed history; these inputs are regression cases, not complete reports.
The empty-history case is marked preliminary, and one Mixed player's gender was
set to `Unknown` to exercise the disclosure and permissive pairing path.

`npm test` validates inputs against `contracts/team-data.schema.json`, validates
both expected and actual outputs against `contracts/analysis.schema.json`, and
compares the entire persisted JSON structure. The output schema checks the
envelope, summaries, eligibility counts, and lineup fields; detailed evidence
objects remain extensible and are protected by the full golden comparison.

Only the top-level analysis `generatedAt` is normalized to
`2026-01-01T00:00:00.000Z`. Source timestamps, array ordering, numeric precision,
nulls, disclosures, and all other fields are compared exactly. JSON serialization
matches persisted reports (including omission of undefined properties).

## Intentional analysis changes

1. Review the analysis change and any failing golden differences.
2. Run `npm run golden:analysis` to regenerate all twelve expected outputs from
   these fixed inputs. This validates all results before writing any output and
   does not read live collections or change the inputs.
3. Review the resulting JSON diff, then run `npm test` and commit the expectations
   with the intentional logic change.

Ordinary test runs never regenerate files. To run only the analysis tests, use
`node --test test/analysis.test.mjs`. Missing expectations fail the tests.
