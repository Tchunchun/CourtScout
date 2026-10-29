import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeTeam } from "../scripts/lib/analysis.mjs";
import { buildThreatBoard } from "../scripts/lib/threat-board.mjs";
import { createAppServer } from "../web/server.mjs";

const QUEENS = "data/collections/2026-adult-18-3.0-women-nationals/2026-southern-eanderson-queens/team-data.json";

test("a gathered team's board orders players and reads its stacking", async () => {
  const dataset = JSON.parse(await readFile(QUEENS, "utf8"));
  const analysis = analyzeTeam(dataset, { eligibilityScope: "national" });
  const board = buildThreatBoard({ dataset, analysis, today: new Date("2026-10-29") });

  assert.equal(board.players.length, analysis.eligibility.players.length);
  const available = board.players.filter(player => player.available);
  assert.deepEqual(board.players.slice(0, available.length), available);
  const drs = available.map(player => player.dr ?? -Infinity);
  assert.deepEqual(drs, [...drs].sort((a, b) => b - a));

  const top = board.players[0];
  assert.equal(top.utr.source, "exact");
  assert.ok(top.usualCourts.length > 0);
  assert.ok(board.pairs.every(pair => pair.appearances >= 2 && pair.courts.every(court => /^D\d$/.test(court))));

  const doubles = board.stacking.find(read => read.discipline === "doubles");
  assert.ok(doubles.matchesCompared >= 4);
  assert.equal(doubles.strongestOnTop <= doubles.matchesCompared, true);
  assert.match(doubles.note, /D1/);

  assert.ok(board.predictions.length > 0 && board.predictions.length <= 3);
  assert.deepEqual(
    board.predictions[0].lines.map(line => line.court),
    ["S1", "S2", "D1", "D2", "D3"]
  );
  assert.ok(board.coverage.some(warning => /days old/.test(warning)));
});

function analysisFor(players, { stacking = [], predictions = [], phases = { local: {} } } = {}) {
  return {
    team: { name: "Opponent", leagueFormat: "single_gender" },
    summary: { phases },
    eligibility: { scope: "local", label: "Local", players },
    doubles: { repeatedPairs: [], matchStacking: stacking },
    singles: { matchStacking: [] },
    lineupPredictions: { predictions },
    disclosures: { warnings: [] }
  };
}

function eligibilityPlayer(name, status, dr) {
  return { name, status, dr, role: "Doubles Depth (D1)", localCourtUsage: [{ court: "D1", appearances: 2 }] };
}

test("ratings, eligibility, and thin evidence become coverage gaps", () => {
  const dataset = {
    team: { name: "Opponent" },
    sources: [{ type: "tennisrecord", retrievedAt: "2026-10-20" }],
    roster: [
      { name: "Band", utr: { doubles: { value: 3.5, exactValue: null, display: "3.xx" }, retrievedAt: "2026-10-20" } },
      { name: "Unrated", utr: { doubles: { value: null, display: "NR" } } },
      { name: "Unsure", utr: { doubles: { value: 3.9, exactValue: 3.9, display: "3.90" }, retrievedAt: "2026-08-01" } }
    ]
  };
  const analysis = analysisFor([
    eligibilityPlayer("Unsure", "unknown", 3.4),
    eligibilityPlayer("Unrated", "eligible", null),
    eligibilityPlayer("Band", "eligible", 3.1)
  ], {
    phases: { local: {}, sectionals: {} },
    predictions: [{
      rank: 1,
      confidence: "low",
      historicalSupport: 1,
      lines: [{ court: "D1", players: ["Band", "Unrated"], appearances: 1, postseasonAppearances: 0 }]
    }]
  });
  const board = buildThreatBoard({ dataset, analysis, today: new Date("2026-10-29") });

  assert.deepEqual(board.players.map(player => player.name), ["Band", "Unrated", "Unsure"]);
  assert.deepEqual(board.players.map(player => player.utr.source), ["public", "none", "exact"]);
  assert.deepEqual(board.predictions[0].lines[0].gaps, [
    "No postseason appearances on this court",
    "Seen here once",
    "No rating for Unrated"
  ]);
  assert.deepEqual(board.coverage, [
    "Some UTR ratings are 89 days old.",
    "1 player has only a public UTR band, so close matchups are uncertain.",
    "1 player has no DR or UTR.",
    "Eligibility could not be confirmed for 1 player."
  ]);
});

test("stacking needs enough rated matches before it names a pattern", () => {
  const match = strongest => ({
    strongestCourtByDr: strongest,
    lines: [{ court: "D1", averageDr: 3 }, { court: "D2", averageDr: 3.2 }]
  });
  const read = stacking => buildThreatBoard({
    dataset: { roster: [] },
    analysis: analysisFor([], { stacking })
  }).stacking[0];

  assert.match(read([match("D2"), match("D2")]).note, /No clear pattern yet: only 2 matches/);
  const stacked = read([match("D2"), match("D2"), match("D2"), match("D1")]);
  assert.equal(stacked.stacks, true);
  assert.equal(stacked.usualStrongestCourt, "D2");
  assert.match(stacked.note, /below D1 in 3 of 4 matches, most often at D2/);
});

test("the server serves a team's threat board for an eligibility level", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-threat-board-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  await mkdir(join(dataDirectory, "queens"));
  await writeFile(join(dataDirectory, "queens", "team-data.json"), await readFile(QUEENS));
  const server = createAppServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${base}/api/threat-board?team=queens&eligibility=national`);
  assert.equal(response.status, 200);
  const board = await response.json();
  assert.equal(board.teamId, "queens");
  assert.equal(board.eligibility.scope, "national");
  assert.ok(board.players.length > 0);

  assert.equal((await fetch(`${base}/api/threat-board`)).status, 400);
});
