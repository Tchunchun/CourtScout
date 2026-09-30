import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDoubles,
  analyzeEligibility,
  analyzeLineupPredictions,
  analyzeSingles,
  analyzeTeam
} from "../scripts/lib/analysis.mjs";

function rating(value, status = "verified") {
  return {
    value,
    exactValue: value,
    display: value === null ? "NR" : String(value),
    status
  };
}

function player(name, type, actual, defaults, dr, singles, doubles) {
  return {
    name,
    ntrp: { level: "3.0", type },
    dr,
    utr: {
      singles: rating(singles),
      doubles: rating(doubles)
    },
    records: {
      singles: { wins: 0, losses: 0 },
      doubles: { wins: 0, losses: 0 }
    },
    qualifyingAppearances: { actual, defaultsReceived: defaults },
    sectionalsAppearances: 0,
    nationalsEligibility: { status: "unknown", display: "Pending" }
  };
}

function court(targetPlayers, opponentPlayers, result, target, opponent, options = {}) {
  return {
    targetPlayers,
    opponentPlayers,
    result,
    onCourtResult: options.onCourtResult,
    status: `${result} · ${options.score ?? "6-4 6-4"}`,
    score: options.score ?? "6-4 6-4",
    adjudication: options.adjudication ?? null,
    targetRatings: targetPlayers.map((name, index) => ({
      name,
      dr: target[index].dr,
      historicalDr: {
        value: target[index].dr,
        evidenceType: targetPlayers.length === 1
          ? "individual_match_page_dr"
          : "pair_average_match_page_dr"
      },
      utr: {
        singles: rating(target[index].singles),
        doubles: rating(target[index].doubles)
      }
    })),
    opponentRatings: opponentPlayers.map((name, index) => ({
      name,
      historicalDr: {
        value: opponent[index].dr,
        evidenceType: opponentPlayers.length === 1
          ? "individual_match_page_dr"
          : "pair_average_match_page_dr"
      },
      utr: {
        singles: rating(opponent[index].singles),
        doubles: rating(opponent[index].doubles)
      }
    }))
  };
}

function dataset() {
  return {
    schemaVersion: "2.0.0",
    datasetId: "2026-test-team",
    generatedAt: "2026-08-14T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: {
      name: "Test Team",
      section: "Test",
      league: "Adult",
      level: "3.0",
      gender: "Women",
      season: 2026
    },
    sources: [],
    dataQuality: {},
    roster: [
      player("Computer", "C", 2, 1, 3.1, 3.2, 3.3),
      player("Self", "S", 3, 2, 3.0, 3.0, 3.1),
      player("Appeal", "A", 4, 0, 2.9, 2.8, null),
      player("DQ", "D", 9, 0, 3.5, 3.6, 3.7)
    ],
    matches: [{
      id: "local-1",
      date: "2026-05-01",
      phase: "local",
      opponent: "Opponent A",
      officialTeamResult: { wins: 2, losses: 0, result: "W" },
      courts: {
        S1: court(
          ["Computer"],
          ["Higher Player"],
          "W",
          [{ dr: 3.1, singles: 3.2, doubles: 3.3 }],
          [{ dr: 3.3, singles: 3.4, doubles: 3.5 }],
          { score: "6-4 3-6 1-0" }
        ),
        D1: court(
          ["Self", "Appeal"],
          ["Opponent One", "Opponent Two"],
          "W",
          [
            { dr: 3.0, singles: 3.0, doubles: 3.1 },
            { dr: 2.9, singles: 2.8, doubles: null }
          ],
          [
            { dr: 3.2, singles: 3.1, doubles: 3.2 },
            { dr: 3.2, singles: 3.1, doubles: 3.2 }
          ]
        )
      }
    }, {
      id: "sectional-1",
      date: "2026-08-01",
      phase: "sectionals_final",
      opponent: "Opponent B",
      officialTeamResult: { wins: 0, losses: 1, result: "L" },
      courts: {
        D1: court(
          ["Appeal", "Self"],
          ["Opponent Three", "Opponent Four"],
          "L",
          [
            { dr: 2.9, singles: 2.8, doubles: null },
            { dr: 3.0, singles: 3.0, doubles: 3.1 }
          ],
          [
            { dr: 2.8, singles: 2.7, doubles: 2.9 },
            { dr: 2.8, singles: 2.7, doubles: 2.9 }
          ]
        )
      }
    }]
  };
}

test("eligibility defaults to national and applies rating-type thresholds", () => {
  const analysis = analyzeTeam(dataset());

  assert.equal(analysis.eligibility.scope, "national");
  assert.equal(
    analysis.eligibility.players.find(item => item.name === "Computer").status,
    "eligible"
  );
  assert.equal(
    analysis.eligibility.players.find(item => item.name === "Self").status,
    "ineligible"
  );
  assert.equal(
    analysis.eligibility.players.find(item => item.name === "Appeal").status,
    "eligible"
  );
  assert.equal(
    analysis.eligibility.players.find(item => item.name === "DQ").status,
    "unavailable"
  );
  const computer = analysis.eligibility.players.find(item => item.name === "Computer");
  assert.equal(computer.dr, 3.1);
  assert.equal(computer.utr.singles.display, "3.2");
  assert.deepEqual(computer.local.singles.record, {
    wins: 1,
    losses: 0,
    ties: 0,
    unknown: 0,
    decisions: 1,
    winRate: 1
  });
  assert.equal(computer.local.singles.appearances, 1);
  assert.equal(computer.local.doubles.appearances, 0);
  assert.equal(computer.local.appearances, 1);
  assert.equal(computer.postseasonAppearances, 0);
  assert.equal(computer.role, "Singles Depth (S1)");
  assert.match(computer.standoutNote, /Highest eligible DR \(3\.10\)/);
  assert.match(computer.standoutNote, /Roster-high 1 local singles appearance at S1 \(1–0\)/);
  assert.match(computer.standoutNote, /2 singles upset signals/);

  const self = analysis.eligibility.players.find(item => item.name === "Self");
  assert.equal(self.postseasonAppearances, 1);
  assert.equal(self.role, "Ineligible — 1 match needed · Doubles Depth (D1)");

  const appeal = analysis.eligibility.players.find(item => item.name === "Appeal");
  assert.equal(appeal.role, "Doubles Depth (D1)");
  assert.match(appeal.standoutNote, /1 local doubles appearance, mainly D1 \(1–0\)/);
  assert.match(appeal.standoutNote, /1 postseason appearance, mainly D1/);

  const singlesComputer = analysis.singles.players.find(item => item.name === "Computer");
  assert.equal(singlesComputer.likelyRole, "S1 option");
  assert.equal(singlesComputer.appearances[0].ratings.singlesUtr.targetRating.display, "3.2");
  assert.equal(singlesComputer.appearances[0].ratings.singlesUtr.opponentRating.display, "3.4");
});

test("eligibility supports local and sectional selection", () => {
  const local = analyzeEligibility(dataset(), "local");
  const sectional = analyzeEligibility(dataset(), "sectional");

  assert.equal(local.summary.eligible, 3);
  assert.equal(sectional.players.find(item => item.name === "Self").status, "eligible");
  assert.equal(
    sectional.players.find(item => item.name === "Computer").countedMatches,
    3
  );
});

test("eligibility preserves curated player roles and standout notes", () => {
  const input = dataset();
  const computer = input.roster.find(item => item.name === "Computer");
  computer.likelyRole = "Singles Anchor (S1)";
  computer.note = "Roster-high DR and an unbeaten local singles record.";

  const result = analyzeEligibility(input).players.find(item => item.name === "Computer");

  assert.equal(result.role, "Singles Anchor (S1)");
  assert.equal(result.standoutNote, "Roster-high DR and an unbeaten local singles record.");
});

test("eligibility usage excludes defaults received from actual match counts", () => {
  const input = dataset();
  input.matches.push({
    id: "local-default",
    date: "2026-05-08",
    phase: "local",
    opponent: "Opponent Default",
    officialTeamResult: { wins: 1, losses: 0, result: "W" },
    courts: {
      S1: court(
        ["Computer"],
        [],
        "W",
        [{ dr: 3.1, singles: 3.2, doubles: 3.3 }],
        [],
        { adjudication: "default_received", score: "Default" }
      )
    }
  }, {
    id: "postseason-default",
    date: "2026-08-08",
    phase: "sectionals_final",
    opponent: "Opponent Postseason Default",
    officialTeamResult: { wins: 1, losses: 0, result: "W" },
    courts: {
      S1: court(
        ["Computer"],
        [],
        "W",
        [{ dr: 3.1, singles: 3.2, doubles: 3.3 }],
        [],
        { adjudication: "default_received", score: "Default" }
      )
    }
  });

  const result = analyzeEligibility(input).players.find(item =>
    item.name === "Computer"
  );

  assert.equal(result.local.singles.appearances, 1);
  assert.equal(result.local.appearances, 1);
  assert.equal(result.postseasonAppearances, 0);
  assert.deepEqual(result.courtUsage, [{ court: "S1", appearances: 1 }]);
});

test("eligibility discloses and repairs only pending zeroed appearance counts", () => {
  const input = dataset();
  const computer = input.roster.find(item => item.name === "Computer");
  computer.qualifyingAppearances = { actual: 0, defaultsReceived: 0 };
  computer.nationalsEligibility = { status: "unknown", display: "Pending collection" };

  const analysis = analyzeEligibility(input);
  const result = analysis.players.find(item => item.name === "Computer");

  assert.equal(result.appearanceSource, "match_ledger_fallback");
  assert.equal(result.actualMatches, 1);
  assert.equal(result.status, "ineligible");
  assert.equal(analysis.dataQualityIssues[0].resolution, "match_ledger_fallback");
});

test("singles reports court use, score profile, and lower-rated wins", () => {
  const singles = analyzeSingles(dataset());
  const computer = singles.players.find(item => item.name === "Computer");

  assert.deepEqual(singles.summary.record, {
    wins: 1,
    losses: 0,
    ties: 0,
    unknown: 0,
    decisions: 1,
    winRate: 1
  });
  assert.equal(computer.primaryCourt, "S1");
  assert.equal(computer.comparisonMetrics.lowerDrWins, 1);
  assert.equal(computer.comparisonMetrics.lowerUtrWins, 1);
  assert.equal(computer.appearances[0].scoreProfile.matchTiebreak, true);
});

test("stacking preserves ratingsText match-page DR when joins lack historical DR", () => {
  const input = dataset();
  const singlesCourt = input.matches[0].courts.S1;
  delete singlesCourt.targetRatings[0].historicalDr;
  delete singlesCourt.opponentRatings[0].historicalDr;
  singlesCourt.targetRatings[0].dr = 3.45;
  singlesCourt.ratingsText = "Team DR 3.10 / UTR 3.20 Opp DR 3.30 / UTR 3.40";

  const line = analyzeSingles(input).matchStacking[0].lines[0];

  assert.equal(line.averageDr, 3.1);
  assert.equal(line.opponentAverageDr, 3.3);
  assert.equal(line.averageUtr, 3.2);
  assert.equal(line.opponentAverageUtr, 3.4);
  assert.deepEqual(line.opponentPlayers, ["Higher Player"]);
  assert.equal(line.score, "6-4 3-6 1-0");
});

test("doubles normalizes pair order and preserves incomplete pair UTR", () => {
  const doubles = analyzeDoubles(dataset());
  const pair = doubles.pairs[0];

  assert.equal(doubles.summary.uniquePairs, 1);
  assert.equal(doubles.summary.repeatedPairs, 1);
  assert.equal(pair.pair, "Appeal + Self");
  assert.equal(pair.appearances, 2);
  assert.equal(pair.record.wins, 1);
  assert.equal(pair.record.losses, 1);
  assert.equal(pair.currentRatings.doublesUtrComplete, false);
  assert.equal(pair.comparisonMetrics.lowerDrWins, 1);
  assert.equal(pair.comparisonMetrics.favoriteDrLosses, 1);
});

test("lineup predictions return three ranked non-overlapping options", () => {
  const input = dataset();
  input.matches.push({
    id: "local-2",
    date: "2026-07-01",
    phase: "local",
    opponent: "Opponent C",
    courts: {
      S1: court(
        ["Appeal"],
        ["Opponent Five"],
        "W",
        [{ dr: 2.9, singles: 2.8, doubles: null }],
        [{ dr: 3.0, singles: 3.0, doubles: 3.0 }]
      ),
      D1: court(
        ["Computer", "Self"],
        ["Opponent Six", "Opponent Seven"],
        "W",
        [
          { dr: 3.1, singles: 3.2, doubles: 3.3 },
          { dr: 3.0, singles: 3.0, doubles: 3.1 }
        ],
        [
          { dr: 3.0, singles: 3.0, doubles: 3.0 },
          { dr: 3.0, singles: 3.0, doubles: 3.0 }
        ]
      )
    }
  }, {
    id: "sectional-2",
    date: "2026-08-10",
    phase: "sectionals_final",
    opponent: "Opponent D",
    courts: {
      S1: court(
        ["Self"],
        ["Opponent Eight"],
        "W",
        [{ dr: 3.0, singles: 3.0, doubles: 3.1 }],
        [{ dr: 3.0, singles: 3.0, doubles: 3.0 }]
      ),
      D1: court(
        ["Appeal", "Computer"],
        ["Opponent Nine", "Opponent Ten"],
        "W",
        [
          { dr: 2.9, singles: 2.8, doubles: null },
          { dr: 3.1, singles: 3.2, doubles: 3.3 }
        ],
        [
          { dr: 3.0, singles: 3.0, doubles: 3.0 },
          { dr: 3.0, singles: 3.0, doubles: 3.0 }
        ]
      )
    }
  });
  const localEligibility = analyzeEligibility(input, "local");

  const result = analyzeLineupPredictions(input, localEligibility);

  assert.equal(result.predictions.length, 3);
  assert.deepEqual(result.summary.courts, ["S1", "D1"]);
  assert.deepEqual(result.predictions.map(item => item.rank), [1, 2, 3]);
  for (const prediction of result.predictions) {
    const players = prediction.lines.flatMap(line => line.players);
    assert.equal(new Set(players).size, players.length);
    assert.equal(prediction.lines.length, 2);
    assert.ok(prediction.historicalSupport > 0);
    assert.ok(!players.includes("DQ"));
  }
});
