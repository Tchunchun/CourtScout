# Cold-Start Lineup Prediction Proposal

Date: 2026-09-30

Status: Draft

## Summary

Court Scout currently predicts up to three complete lineups from eligible-player
court history, weighted by frequency, recency, and postseason use. That approach
is useful once a team has played several matches, but it has little or no
evidence at the start of a new season.

This proposal extends the existing lineup prediction pipeline with a
confidence-aware cold-start model. The model will combine:

- current-season match evidence;
- linked prior-season lineup history;
- current roster and eligibility facts;
- singles and doubles strength ratings;
- returning-player and pair continuity; and
- team-specific lineup behavior learned from prior seasons.

The model will gradually replace preseason priors with current-season evidence
as matches are collected. It will continue to return up to three legal,
evidence-backed scenarios and explain why each scenario was generated.

## Goals

1. Produce useful lineup scenarios when a team has zero or few current-season
   matches.
2. Preserve current-season evidence as the strongest signal once enough
   matches exist.
3. Distinguish player availability, singles ordering, and doubles pairing
   instead of treating lineup prediction as one undifferentiated ranking.
4. Show confidence, evidence coverage, and human-readable reasons for every
   scenario.
5. Preserve source provenance and keep all inferred values out of the canonical
   team dataset.
6. Measure whether the new model improves early-season predictions through
   retrospective backtesting.

## Non-goals

- Predicting injuries or private availability information.
- Treating a rating as proof that a player will participate.
- Automatically merging teams or players across seasons from a name alone.
- Replacing eligibility rules with predicted future eligibility.
- Optimizing Our team's lineup against an opponent; the existing Match Day Card
  challenge workflow remains responsible for that.
- Introducing a black-box machine-learning service in the first release.

## Product principles

### Facts and inferences remain separate

Collected ratings, match results, roster membership, and eligibility remain
source facts. Cross-season links, availability likelihood, candidate scores,
and scenario confidence are derived analysis with explicit provenance.

### Sparse evidence lowers confidence, not usability

A team with no current-season matches may still receive scenarios, but the UI
must label them as preseason estimates and disclose the evidence used. Missing
evidence must not be silently replaced with invented values.

### Current evidence takes over progressively

Prior-season and rating-based signals are regularizers, not permanent overrides.
Their influence must decay as current-season observations accumulate.

### Legal lineups are a hard constraint

The existing eligibility scope, one-court-per-player rule, court structure, and
mixed-doubles gender rules remain hard constraints. A high score can never make
an invalid lineup eligible.

## Proposed user experience

The Team Report and Match Day Card continue to show up to three lineup
scenarios. Each scenario adds:

- an evidence state: `preseason`, `limited`, `developing`, or `established`;
- a calibrated confidence percentage and label;
- the number of current-season and prior-season matches supporting it;
- the share of players supported by direct lineup evidence versus rating-based
  inference;
- a short summary of the most influential reasons; and
- court-level reasons for player placement or pairing.

Example:

> **Preseason estimate — 61% confidence**
>
> Four of six players return from last season's final three lineups. Singles 1
> and Singles 2 are supported by current singles ratings. Doubles 2 is a new
> pairing inferred from doubles strength and has limited direct evidence.

Users can inspect the evidence and still edit Our team's lineup as they do
today. An optional "Ignore prior seasons" control should allow users to compare
the cold-start result with current-season-only evidence.

## Evidence model

### 1. Current-season evidence

Retain the existing signals:

- court and pair frequency;
- recency;
- postseason weighting;
- full-lineup observations; and
- current eligibility.

Current-season observations receive full weight.

### 2. Prior-season evidence

For a confirmed team continuity link, derive:

- returning players on the current roster;
- each returning player's prior court distribution;
- the last three valid lineups from the prior season;
- postseason lineup usage;
- stable doubles pairs;
- lineup volatility; and
- whether the team typically orders singles by rating strength.

Prior evidence is time-decayed and cannot introduce a player who is absent from
the current roster.

Recommended initial decay:

| Evidence age | Weight relative to a current match |
|---|---:|
| Previous season | 0.50 |
| Two seasons ago | 0.20 |
| Older | 0.00 |

Postseason and end-of-season observations retain the existing postseason and
recency multipliers before the seasonal decay is applied.

### 3. Player strength

Use discipline-specific evidence:

- singles DR, exact singles UTR, and singles WTN for singles;
- doubles DR evidence, exact doubles UTR, and doubles WTN for doubles.

Rating scales must be normalized independently. Public masked UTR values remain
bands and must not be converted into exact decimals. WTN remains inverse, with a
lower value representing a stronger player. Missing ratings contribute no
signal rather than a zero.

Strength is used to rank plausible placements among current roster members. It
does not prove availability and does not override observed lineup behavior.

### 4. Coach and team tendencies

Derive transparent team-level features from linked historical seasons:

- lineup stability versus rotation;
- promotion rate for newly appearing players;
- frequency of ordering singles by rating;
- doubles pair reuse rate;
- frequency of using the same complete lineup; and
- frequency of materially different lineups in consecutive matches.

These features control the breadth of generated scenarios. A stable team should
produce a concentrated top scenario; a high-rotation team should distribute
probability across more alternatives.

### 5. Availability likelihood

Availability is a derived likelihood for scenario generation, not a medical or
roster fact. Initial inputs are:

- membership on the current roster;
- current-season participation;
- prior-season participation for returning players;
- recent omission patterns when current matches exist; and
- explicit eligibility or disqualification status.

Eligibility remains a hard filter. Availability likelihood only ranks players
who are legal under the selected scope.

## Cross-season identity and storage

### Team continuity

Create local workspace metadata for confirmed cross-season links. Resolve team
continuity in this order:

1. exact stable source identifier, when available;
2. an existing user-confirmed continuity link; or
3. a suggested match requiring confirmation.

A normalized team name alone must never create an automatic link.

### Player continuity

Resolve returning players with:

1. an exact source player identifier or profile URL;
2. a user-confirmed player link; or
3. a high-confidence suggestion using normalized name, confirmed team
   continuity, and compatible gender.

Ambiguous players remain unlinked and generate a disclosure.

### Persistence

Store confirmed team and player continuity as local workspace metadata, for
example in `data/team-history-links.json`. Do not add derived continuity to
`team-data.json`.

Analysis snapshots may embed the resolved evidence summary and link provenance
so a saved result remains explainable. Snapshot invalidation must include:

- current dataset timestamp;
- linked historical dataset timestamps;
- history-link metadata timestamp;
- eligibility scope; and
- prediction model version.

## Prediction design

### Step 1: determine the evidence state

Use the number of current-season team matches:

| Current matches | Evidence state | Intended behavior |
|---:|---|---|
| 0 | `preseason` | Priors and ratings dominate |
| 1-3 | `limited` | Priors remain strong; current evidence updates them |
| 4-8 | `developing` | Current and prior evidence are blended |
| 9+ | `established` | Current evidence dominates |

These thresholds are initial defaults and must be calibrated by backtesting.

### Step 2: calculate adaptive prior influence

Use a continuous decay rather than a sudden threshold:

`priorInfluence = exp(-currentMatchCount / 4)`

This produces approximately 100% prior influence before the first match, 47%
after three matches, 22% after six matches, and 11% after nine matches.

The value controls how much historical and rating-based pseudo-evidence enters
candidate scoring. It does not reduce the weight of observed current matches.

### Step 3: model the three prediction components

#### Availability

Rank eligible roster members by participation evidence and continuity. Retain
uncertainty for players with no participation evidence.

#### Singles placement

For each player and singles court, combine:

- current court usage;
- decayed prior court usage;
- prior end-of-season placement;
- discipline-specific relative strength; and
- the team's observed ordering tendency.

The model must be allowed to generate plausible placements for a new player
with ratings but no court history.

#### Doubles pairing

For each legal pair and doubles court, combine:

- current pair usage;
- decayed prior pair usage;
- individual doubles strength;
- pair continuity;
- team pair-reuse tendency; and
- court-specific history.

An observed stable pair should normally outrank a synthetic pair with a small
rating advantage.

### Step 4: generate complete scenarios

Extend the existing constrained beam search:

1. create observed and inferred candidates for each expected court;
2. exclude ineligible players and invalid mixed pairs;
3. prevent a player from occupying multiple courts;
4. score complete lineups using candidate evidence;
5. add a bonus for an observed complete lineup;
6. retain materially distinct alternatives; and
7. return at most three scenarios.

Scenario probabilities should be calculated from the normalized scores of all
retained complete lineups. Avoid presenting the top score as a probability
until it has been calibrated against historical outcomes.

### Step 5: calculate confidence

Confidence should combine:

- top-scenario separation from alternatives;
- current-season evidence coverage;
- direct historical evidence coverage;
- identity-link confidence;
- rating completeness;
- lineup volatility; and
- backtest calibration.

Until calibration is complete, the UI should show categorical confidence and an
evidence coverage percentage, not a probability of correctness.

## Proposed analysis contract

Preserve the current `lineupPredictions.predictions[]` shape where practical and
add fields without removing existing fields:

```json
{
  "modelVersion": "2.0.0",
  "summary": {
    "evidenceState": "limited",
    "currentSeasonMatches": 2,
    "priorSeasonMatches": 8,
    "priorInfluence": 0.61,
    "historyLinkStatus": "confirmed"
  },
  "predictions": [
    {
      "rank": 1,
      "confidence": "medium",
      "confidenceScore": null,
      "evidenceCoverage": 0.78,
      "source": "blended",
      "reasons": [
        {
          "code": "returning_lineup_core",
          "message": "Four players return from the prior season's final lineups."
        }
      ],
      "lines": [
        {
          "court": "D1",
          "players": ["Player A", "Player B"],
          "candidateType": "observed_pair",
          "evidence": {
            "currentAppearances": 1,
            "priorWeightedAppearances": 2.5,
            "ratingSignals": 2
          }
        }
      ]
    }
  ],
  "disclosures": []
}
```

`confidenceScore` remains `null` until retrospective calibration supports a
meaningful probability. Reason codes should be stable for tests and UI
localization; messages may evolve.

## Architecture and implementation surfaces

### Data and history context

- Add a small history-link store following the existing local workspace-store
  patterns.
- Add a history-context builder that loads only confirmed linked datasets and
  produces normalized prior evidence.
- Leave the canonical team data schema unchanged for the first release.

### Analysis

Refactor lineup candidate generation into independently testable functions for:

- evidence-state calculation;
- prior influence;
- availability scoring;
- singles candidates;
- doubles-pair candidates;
- constrained scenario generation; and
- confidence/evidence coverage.

The existing prediction output should remain available when no history context
is supplied. This provides backward compatibility and an immediate fallback.

### Server

The analysis endpoint should resolve history context from local metadata and
include linked dataset timestamps in snapshot cache validation. A query option
may disable history for comparison and debugging.

### UI

Extend existing lineup explanations in Team Reports and Match Day Cards to show:

- evidence state;
- current versus historical support;
- inferred placements and pairs;
- unresolved identity warnings; and
- the "Ignore prior seasons" comparison control.

The UI must not label an inferred scenario as observed.

## Delivery plan

### Phase 0: retrospective benchmark

1. Build a test fixture runner that treats prior seasons as known history.
2. Hide the first `N` matches of the target season for `N = 0, 1, 3, 5, 8`.
3. Predict each hidden next lineup using only evidence available before it.
4. Record the baseline accuracy of the current model.
5. Define go/no-go thresholds before changing production ranking.

Deliverable: a repeatable cold-start evaluation report.

### Phase 1: history linking and context

1. Add confirmed team and player continuity metadata.
2. Add history-link review and ambiguity disclosures.
3. Build normalized prior-season court, pair, and lineup evidence.
4. Include history dependencies in analysis cache invalidation.

Deliverable: explainable history context without changing predictions.

### Phase 2: blended prediction engine

1. Add evidence states and continuous prior influence.
2. Generate candidates from history and discipline-specific ratings.
3. Split singles and doubles candidate scoring.
4. Extend constrained beam search to sparse-data candidates.
5. Return structured reasons and evidence coverage.
6. Preserve the current algorithm as a fallback behind a model-version switch.

Deliverable: version 2 predictions available behind a feature flag.

### Phase 3: Team Report and Match Day Card

1. Add evidence-state and support summaries.
2. Add court-level explanations for inferred candidates.
3. Add identity and low-coverage warnings.
4. Add current-season-only comparison.
5. Preserve manual lineup editing and saved-card behavior.

Deliverable: transparent cold-start predictions in the existing workflow.

### Phase 4: calibration and default rollout

1. Run retrospective evaluation across available seasons and teams.
2. Tune decay, pseudo-evidence, and scenario diversity.
3. Calibrate confidence bands.
4. Compare version 2 with the production baseline.
5. Make version 2 the default only if it passes the success thresholds.

Deliverable: measured rollout with a reversible model-version switch.

## Success metrics

Evaluate by season stage and discipline:

- **Player inclusion accuracy:** percentage of actual lineup players included in
  the top scenario.
- **Exact court accuracy:** percentage of actual court assignments predicted
  exactly.
- **Pair accuracy:** percentage of actual doubles pairs predicted.
- **Top-three coverage:** percentage of actual complete or near-complete lineups
  represented by any returned scenario.
- **Scenario quality:** average edit distance from the actual lineup.
- **Confidence calibration:** whether higher confidence corresponds to higher
  observed accuracy.
- **Cold-start improvement:** version 2 improvement over the current model at
  zero, one, three, and five known matches.

Recommended initial rollout requirements:

- improve top-three player inclusion by at least 15 percentage points with
  zero to three current-season matches;
- do not reduce established-season exact-court accuracy by more than two
  percentage points;
- never generate an invalid or ineligible lineup; and
- produce a structured disclosure for every inferred court assignment.

## Testing strategy

### Unit tests

- prior influence at representative match counts;
- season-decay boundaries;
- missing and masked rating behavior;
- WTN direction and discipline separation;
- returning-player filtering against the current roster;
- singles inference for a new rated player;
- stable-pair preference over a marginal rating advantage;
- mixed-doubles constraints;
- duplicate-player prevention;
- deterministic ranking and tie-breaking;
- confidence/evidence coverage calculations; and
- fallback behavior with no history context.

### Integration tests

- confirmed history links load the intended datasets only;
- ambiguous links do not enter prediction evidence;
- linked dataset updates invalidate snapshots;
- model-version changes invalidate snapshots;
- Team Reports and Match Day Cards render both historical and inferred reasons;
- disabling history reproduces current-season-only behavior; and
- saved Match Day Cards continue to open after the analysis contract expands.

### Retrospective tests

Run walk-forward evaluation so no future match, later rating, or later roster
fact leaks into an earlier prediction. The evaluator must record the evidence
cutoff for every prediction.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Incorrect cross-season identity | Require stable identifiers or explicit confirmation; disclose ambiguity |
| Ratings overpower actual coach behavior | Cap rating pseudo-evidence and decay it quickly |
| Freshmen or transfers have sparse ratings | Generate low-confidence candidates without inventing values |
| Prior lineup becomes stale after roster changes | Filter every prior candidate through the current roster |
| Confidence appears more precise than evidence permits | Withhold numeric probability until calibrated |
| Historical data leaks future information | Use strict as-of timestamps in backtesting and analysis |
| Model changes break saved cards | Add fields compatibly and retain a model-version fallback |
| Eligibility is confused with future qualification | Keep selected-scope eligibility as a hard current fact |

## Open decisions

The following decisions should be made after Phase 0 evidence is available:

1. Whether the exponential prior decay outperforms a simpler match-count table.
2. How much rating-based pseudo-evidence is safe for new players.
3. Whether two prior seasons add enough value to justify the identity and
   storage complexity.
4. What difference makes two scenarios materially distinct.
5. Whether calibrated numeric confidence is reliable enough to display.

## Recommended first milestone

Implement Phase 0 and Phase 1 before modifying production ranking. They create
the benchmark and trustworthy history context needed to evaluate every later
choice. Once those are available, implement version 2 behind a feature flag and
promote it only after cold-start improvement is demonstrated without degrading
established-season predictions.
