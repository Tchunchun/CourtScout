import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeTeam } from "../scripts/lib/analysis.mjs";
import { buildMatchup, normalizeMatchupDraft } from "../scripts/lib/matchup.mjs";
import { createAppServer } from "../web/server.mjs";

function rating(value) {
  return { value, exactValue: value, display: value.toFixed(2), status: "Rated", reliability: 100 };
}

function player(name, strength, { gender = "Women", actual = 3 } = {}) {
  return {
    name,
    gender,
    ntrp: { level: "3.0", type: "C" },
    dr: strength,
    utr: { singles: rating(strength), doubles: rating(strength) },
    records: { singles: { wins: 0, losses: 0 }, doubles: { wins: 0, losses: 0 } },
    qualifyingAppearances: { actual, defaultsReceived: 0 },
    sectionalsAppearances: 0,
    nationalsEligibility: { status: "confirmed_eligible", display: "Eligible" }
  };
}

function dataset(datasetId, name, base, overrides = {}) {
  return {
    schemaVersion: "2.0.0",
    datasetId,
    generatedAt: "2026-08-14T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: {
      name,
      section: "Test",
      league: "Adult",
      leagueFormat: "single_gender",
      level: "3.0",
      gender: "Women",
      season: 2026
    },
    sources: [],
    dataQuality: {},
    roster: Array.from({ length: 8 }, (_, index) =>
      player(`${name} ${index + 1}`, base - index * 0.05)
    ),
    matches: [],
    ...overrides
  };
}

function matchupFor(ourData, opponentData, draft = null) {
  return buildMatchup({
    ourData,
    ourAnalysis: analyzeTeam(ourData, { eligibilityScope: "national" }),
    opponentData,
    opponentAnalysis: analyzeTeam(opponentData, { eligibilityScope: "national" }),
    draft
  });
}

const ours = dataset("2026-ours", "Ours", 3.5);
const theirs = dataset("2026-theirs", "Theirs", 2.6);
const fullDraft = {
  S1: ["Ours 1"],
  S2: ["Ours 2"],
  D1: ["Ours 3", "Ours 4"],
  D2: ["Ours 5", "Ours 6"],
  D3: ["Ours 7", "Ours 8"]
};

test("matchup without history starts empty and tests the rating ceiling", () => {
  const matchup = matchupFor(ours, theirs);
  assert.equal(matchup.suggestedDraftSource, "none");
  assert.equal(matchup.validation.complete, false);
  assert.deepEqual(matchup.scenarios.map(item => item.scenarioType), ["rating_ceiling"]);
  assert.equal(matchup.challenges.length, 1);
  assert.ok(matchup.challenges[0].comparisons.every(item => item.edge === "limited"));
  assert.deepEqual(matchup.scenarioCoverage, {
    historicalPredictions: 0,
    historicalScenarios: 0,
    ratingCeiling: true,
    opponentPlayersWithoutGender: 0,
    opponentRosterSize: 8
  });
});

test("a full lineup is compared court by court against each scenario", () => {
  const matchup = matchupFor(ours, theirs, fullDraft);
  assert.equal(matchup.validation.valid, true);
  const [challenge] = matchup.challenges;
  assert.equal(challenge.scenarioType, "rating_ceiling");
  assert.deepEqual(challenge.comparisons.map(item => item.court), ["S1", "S2", "D1", "D2", "D3"]);
  assert.ok(challenge.comparisons.every(item => item.edge === "favorable"));
  assert.deepEqual(matchup.overall, { worstScorePercent: 100, averageScorePercent: 100 });
  assert.equal(matchup.ourPlayers[0].name, "Ours 1");
  assert.equal(matchup.ourPlayers[0].utrDoubles, "3.50");
});

test("drafts are trimmed to the format's courts and slots", () => {
  assert.deepEqual(
    normalizeMatchupDraft({ S1: ["A", "extra"], D1: ["B"], X9: ["C"] }, "single_gender"),
    { S1: ["A"], S2: [""], D1: ["B", ""], D2: ["", ""], D3: ["", ""] }
  );
  assert.deepEqual(Object.keys(normalizeMatchupDraft(null, "mixed")), ["D1", "D2", "D3"]);
  assert.throws(() => normalizeMatchupDraft(["S1"], "single_gender"), /map each court/);
  assert.throws(() => normalizeMatchupDraft({ S1: "A" }, "single_gender"), /list of players/);
});

test("ineligible and repeated players are flagged in the lineup", () => {
  const shortHanded = dataset("2026-ours", "Ours", 3.5);
  shortHanded.roster[7] = player("Ours 8", 3.15, { actual: 0 });
  const matchup = matchupFor(shortHanded, theirs, { ...fullDraft, S2: ["Ours 1"] });
  assert.deepEqual(matchup.validation.duplicateNames, ["Ours 1"]);
  assert.deepEqual(matchup.validation.unavailableNames, ["Ours 8"]);
  assert.equal(matchup.ourPlayers.at(-1).status, "ineligible");
});

test("mixed opponents without recorded genders are reported, not guessed", () => {
  const mixedTeam = { ...ours.team, leagueFormat: "mixed", gender: "Mixed", level: "7.0" };
  const mixedOurs = dataset("2026-ours", "Ours", 3.5, {
    team: mixedTeam,
    roster: ours.roster.map((item, index) => ({ ...item, gender: index % 2 ? "Men" : "Women" }))
  });
  const mixedTheirs = dataset("2026-theirs", "Theirs", 2.6, {
    team: mixedTeam,
    roster: theirs.roster.map(item => ({ ...item, gender: "Unknown" }))
  });
  const matchup = matchupFor(mixedOurs, mixedTheirs);
  assert.deepEqual(matchup.courts.map(item => item.court), ["D1", "D2", "D3"]);
  assert.deepEqual(matchup.scenarios, []);
  assert.equal(matchup.scenarioCoverage.opponentPlayersWithoutGender, 8);
  assert.equal(matchup.overall, null);
});

test("server compares Our lineup through POST /api/matchup", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-matchup-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  for (const [folder, data] of [["ours", ours], ["theirs", theirs]]) {
    await mkdir(join(dataDirectory, folder));
    await writeFile(join(dataDirectory, folder, "team-data.json"), JSON.stringify(data));
  }
  const server = createAppServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const post = body => fetch(`http://127.0.0.1:${port}/api/matchup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const response = await post({ ourTeamId: "ours", opponentTeamId: "theirs", draft: fullDraft });
  assert.equal(response.status, 200);
  const matchup = await response.json();
  assert.equal(matchup.eligibilityScope, "national");
  assert.equal(matchup.opponentTeam.name, "Theirs");
  assert.equal(matchup.challenges[0].scorePercent, 100);

  const same = await post({ ourTeamId: "ours", opponentTeamId: "ours" });
  assert.equal(same.status, 400);
  assert.match((await same.json()).error, /different teams/);

  const badDraft = await post({ ourTeamId: "ours", opponentTeamId: "theirs", draft: { S1: "Ours 1" } });
  assert.equal(badDraft.status, 400);

  const unknown = await post({ ourTeamId: "ours", opponentTeamId: "missing" });
  assert.equal(unknown.status, 404);
});
