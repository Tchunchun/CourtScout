import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSamples,
  benchmarkDataset,
  buildAsOfDataset,
  evaluatePredictions,
  formatMarkdown,
  scoreScenario
} from "../scripts/benchmark-lineups.mjs";

function player(name) {
  return {
    name,
    ntrp: { level: "3.0", type: "C" },
    qualifyingAppearances: { actual: 99, defaultsReceived: 2 },
    sectionalsAppearances: 12,
    nationalsEligibility: { status: "confirmed_eligible", display: "Eligible" },
    records: { singles: { wins: 0, losses: 0 }, doubles: { wins: 0, losses: 0 } },
    utr: {}
  };
}

function match(id, date, lines, phase = "local") {
  return {
    id,
    date,
    phase,
    courts: Object.fromEntries(Object.entries(lines).map(([court, players]) => [
      court,
      { targetPlayers: players, result: "W" }
    ]))
  };
}

function dataset() {
  return {
    schemaVersion: "2.0.0",
    datasetId: "benchmark-team",
    generatedAt: "2026-09-01T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: {
      name: "Benchmark Team",
      league: "Adult",
      section: "Test",
      level: "3.0",
      gender: "Women",
      season: 2026,
      leagueFormat: "single_gender"
    },
    sources: [],
    dataQuality: {},
    roster: ["A", "B", "C", "D", "E"].map(player),
    matches: [
      match("m1", "2026-05-01", { S1: ["A"], D1: ["B", "C"] }),
      match("m2", "2026-05-08", { S1: ["A"], D1: ["B", "C"] }),
      match("m3", "2026-05-08", { S1: ["D"], D1: ["B", "E"] }),
      match("m4", "2026-05-15", { S1: ["A"], D1: ["B", "C"] }, "sectionals")
    ]
  };
}

test("as-of dataset excludes same-day and future matches and rebuilds appearances", () => {
  const input = dataset();
  const target = input.matches[2];
  const asOf = buildAsOfDataset(input, target, input.matches.slice(0, 2));

  assert.deepEqual(asOf.matches.map(value => value.id), ["m1"]);
  assert.equal(asOf.roster.find(value => value.name === "A").qualifyingAppearances.actual, 1);
  assert.equal(asOf.roster.find(value => value.name === "D").qualifyingAppearances.actual, 0);
  assert.equal(asOf.roster.find(value => value.name === "A").sectionalsAppearances, 0);
  assert.equal(asOf.roster.find(value => value.name === "A").nationalsEligibility.status, "unknown");
  assert.equal(input.roster[0].qualifyingAppearances.actual, 99);
  assert.equal(JSON.stringify(asOf).includes("m3"), false);
  assert.equal(JSON.stringify(asOf).includes("m4"), false);
});

test("scenario scoring ignores doubles order and separates top-one from top-three", () => {
  const actual = match("target", "2026-06-01", {
    S1: ["A"],
    D1: ["B", "C"],
    D2: ["D", "E"]
  });
  const wrongTop = {
    rank: 1,
    lines: [
      { court: "S1", players: ["A"] },
      { court: "D1", players: ["B", "D"] },
      { court: "D2", players: ["C", "E"] }
    ]
  };
  const exactSecond = {
    rank: 2,
    lines: [
      { court: "S1", players: ["A"] },
      { court: "D1", players: ["C", "B"] },
      { court: "D2", players: ["E", "D"] }
    ]
  };

  const exactScore = scoreScenario(exactSecond, actual);
  assert.deepEqual(exactScore.doublesPairs, { correct: 2, actual: 2 });
  assert.deepEqual(exactScore.courts, { correct: 3, actual: 3 });
  assert.equal(exactScore.completeLineup, true);

  const evaluation = evaluatePredictions([wrongTop, exactSecond], actual);
  assert.equal(evaluation.top.completeLineup, false);
  assert.equal(evaluation.topThreeCompleteLineup, true);
  assert.equal(evaluation.closestScenarioRank, 2);
});

test("walk-forward benchmark records evidence IDs and treats no prediction as a miss", () => {
  const result = benchmarkDataset(dataset(), {
    knownMatchCounts: [0, 1, 2, 3],
    eligibilityScope: "local"
  });

  assert.equal(result.samples.length, 4);
  assert.equal(result.samples[0].predictionsGenerated, 0);
  assert.equal(result.samples[0].top.players.correct, 0);
  assert.deepEqual(result.samples[1].evidenceMatchIds, ["m1"]);
  assert.deepEqual(result.samples[2].evidenceMatchIds, ["m1"]);
  assert.deepEqual(result.samples[3].evidenceMatchIds, ["m1", "m2", "m3"]);
  assert.equal(result.samples[3].top.completeLineup, true);
});

test("aggregate report uses metric denominators and markdown exposes every metric", () => {
  const sample = benchmarkDataset(dataset(), {
    knownMatchCounts: [1],
    eligibilityScope: "local"
  }).samples[0];
  const aggregate = aggregateSamples([sample]);

  assert.equal(aggregate.samples, 1);
  assert.equal(aggregate.playerInclusionPrecision, 1);
  assert.equal(aggregate.playerInclusionRecall, 1);
  assert.equal(aggregate.doublesPairAccuracy, 1);
  assert.equal(aggregate.exactCourtAccuracy, 1);
  assert.equal(aggregate.topThreeCoverage, 1);
  assert.equal(aggregate.completeLineupAccuracy, 1);

  const markdown = formatMarkdown({
    benchmarkVersion: "1",
    analysisVersion: "1",
    eligibilityScope: "local",
    inputs: [{ datasetId: "benchmark-team" }],
    knownMatchCounts: [1],
    aggregate,
    byKnownMatches: { "1": aggregate }
  });
  assert.match(markdown, /Player recall/);
  assert.match(markdown, /Pair accuracy/);
  assert.match(markdown, /Top-three coverage/);
  assert.match(markdown, /Complete-lineup accuracy/);
});
