import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectionFolderName,
  createAppServer,
  createUtrCommandQueue,
  mergePreservedRefreshData,
  parseRefreshSelections,
  parseRatingSelections,
  ratingSelectionSlug,
  resolveDataDirectory,
  validateTeamUrl
} from "../web/server.mjs";

test("linked worktrees reuse the primary checkout data directory", async t => {
  const parent = await mkdtemp(join(tmpdir(), "court-scout-worktrees-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const primaryRoot = join(parent, "primary");
  const worktreeRoot = join(parent, "worktree");
  const worktreeGitDirectory = join(
    primaryRoot,
    ".git",
    "worktrees",
    "court-scout"
  );
  await mkdir(join(primaryRoot, "data"), { recursive: true });
  await mkdir(worktreeGitDirectory, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(
    join(primaryRoot, "data", "team-collections.json"),
    JSON.stringify({ version: 1, collections: [] })
  );
  await writeFile(
    join(worktreeRoot, ".git"),
    `gitdir: ${worktreeGitDirectory}\n`
  );

  assert.equal(
    resolveDataDirectory(worktreeRoot),
    join(primaryRoot, "data")
  );
  assert.equal(
    resolveDataDirectory(worktreeRoot, join(parent, "configured-data")),
    join(parent, "configured-data")
  );
});

test("validateTeamUrl accepts a TennisRecord team profile", () => {
  const input = "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Example";
  assert.equal(validateTeamUrl(input), input);
});

test("validateTeamUrl rejects non-TennisRecord URLs", () => {
  assert.throws(
    () => validateTeamUrl("https://example.com/adult/teamprofile.aspx?teamname=Example"),
    /tennisrecord\.com/
  );
});

test("collectionFolderName uses readable team details and a timestamp", () => {
  const name = collectionFolderName(
    "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=SUNNYVALE%20MTC%2018AW3.0D",
    "public",
    new Date("2026-08-14T16:18:07.000Z")
  );

  assert.equal(
    name,
    "2026-sunnyvale-mtc-18aw3.0d-public-20260814T161807Z"
  );
});

test("rating selections allow UTR and WTN to be chosen independently", () => {
  assert.deepEqual(parseRatingSelections({
    utrMode: "none",
    includeWtn: true
  }), {
    utr: "none",
    wtn: true
  });
  assert.deepEqual(parseRatingSelections({
    utrMode: "authenticated",
    includeWtn: false
  }), {
    utr: "authenticated",
    wtn: false
  });
  assert.deepEqual(parseRatingSelections({
    utrMode: "none",
    includeWtn: false
  }), {
    utr: "none",
    wtn: false
  });
  assert.equal(
    ratingSelectionSlug({ utr: "public", wtn: true }),
    "public-utr-wtn"
  );
  assert.equal(
    ratingSelectionSlug({ utr: "none", wtn: false }),
    "no-ratings"
  );
  assert.throws(
    () => parseRatingSelections({ utrMode: "estimated", includeWtn: false }),
    /no UTR, public UTR, or signed-in UTR/
  );
  assert.throws(
    () => parseRatingSelections({ utrMode: "none", includeWtn: "yes" }),
    /true or false/
  );
});

test("refresh selections require at least one explicitly selected source", () => {
  assert.deepEqual(parseRefreshSelections({
    refreshTennisRecord: true,
    refreshUtr: false,
    utrMode: "none",
    refreshWtn: false
  }), {
    tennisrecord: true,
    utr: "none",
    wtn: false
  });
  assert.deepEqual(parseRefreshSelections({
    refreshTennisRecord: false,
    refreshUtr: true,
    utrMode: "authenticated",
    refreshWtn: true
  }), {
    tennisrecord: false,
    utr: "authenticated",
    wtn: true
  });
  assert.throws(() => parseRefreshSelections({
    refreshTennisRecord: false,
    refreshUtr: false,
    utrMode: "none",
    refreshWtn: false
  }), /at least one source/);
});

test("TennisRecord refresh preserves unselected ratings and curated analysis", () => {
  const current = {
    ratingSelections: { utr: "public", wtn: true },
    sources: [
      { type: "tennisrecord", retrievedAt: "old" },
      { type: "utr_sports_public_profiles", retrievedAt: "old" },
      { type: "world_tennis_number_public_profiles", retrievedAt: "old" }
    ],
    dataQuality: {
      unresolvedIdentities: [{ name: "Player One" }],
      unresolvedWtnIdentities: []
    },
    roster: [{
      name: "Player One",
      dr: 3,
      likelyRole: "Singles Anchor",
      note: "Curated note",
      utr: { lookupStatus: "public_profile_resolved" },
      wtn: { lookupStatus: "public_profile_resolved" }
    }],
    opponents: [{
      name: "Opponent One",
      utr: { lookupStatus: "public_profile_resolved" }
    }]
  };
  const fresh = {
    sources: [{ type: "tennisrecord", retrievedAt: "new" }],
    dataQuality: {},
    roster: [{ name: "Player One", dr: 3.1 }],
    opponents: [{ name: "Opponent One" }],
    matches: [{
      courts: {
        S1: {
          targetPlayers: ["Player One"],
          opponentPlayers: ["Opponent One"],
          targetRatings: [{ name: "Player One" }],
          opponentRatings: [{ name: "Opponent One" }]
        }
      }
    }]
  };

  const merged = mergePreservedRefreshData(fresh, current, {
    tennisrecord: true,
    utr: "none",
    wtn: false
  });

  assert.equal(merged.roster[0].dr, 3.1);
  assert.equal(merged.roster[0].utr.lookupStatus, "public_profile_resolved");
  assert.equal(merged.roster[0].wtn.lookupStatus, "public_profile_resolved");
  assert.equal(merged.roster[0].likelyRole, "Singles Anchor");
  assert.equal(merged.roster[0].note, "Curated note");
  assert.equal(merged.opponents[0].utr.lookupStatus, "public_profile_resolved");
  assert.equal(
    merged.matches[0].courts.S1.targetRatings[0].utr.lookupStatus,
    "public_profile_resolved"
  );
  assert.equal(
    merged.matches[0].courts.S1.opponentRatings[0].utr.lookupStatus,
    "public_profile_resolved"
  );
  assert.deepEqual(merged.ratingSelections, { utr: "public", wtn: true });
  assert.deepEqual(
    merged.sources.map(source => source.type),
    [
      "tennisrecord",
      "utr_sports_public_profiles",
      "world_tennis_number_public_profiles"
    ]
  );
});

test("UTR command queue prevents collection jobs from overlapping", async () => {
  const runUtrCommand = createUtrCommandQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const firstJob = {
    ratingSelections: { utr: "public", wtn: false },
    detail: ""
  };
  const secondJob = {
    ratingSelections: { utr: "authenticated", wtn: false },
    detail: ""
  };

  const first = runUtrCommand(firstJob, async () => {
    events.push("first-start");
    await firstGate;
    events.push("first-end");
  });
  const second = runUtrCommand(secondJob, async () => {
    events.push("second-start");
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events, ["first-start"]);
  assert.equal(
    secondJob.detail,
    "Waiting for the earlier UTR collection to finish"
  );

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("server serves the collection UI and reports invalid input", async t => {
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Gather team data/);
  assert.match(pageHtml, /Pull UTR ratings/);
  assert.match(pageHtml, /Pull WTN ratings/);
  assert.match(pageHtml, /Refresh data/);

  const response = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      teamUrl: "https://example.com/not-a-team",
      mode: "public"
    })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /tennisrecord\.com/);
});

test("server extracts text from a locally processed result screenshot", async t => {
  const recognizedImages = [];
  const server = createAppServer({
    recognizeImage: async image => {
      recognizedImages.push(image);
      return { data: { text: "S1 Alex Player", confidence: 91 } };
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/result-ocr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: "data:image/png;base64,aGVsbG8="
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: "S1 Alex Player",
    confidence: 91
  });
  assert.equal(recognizedImages[0].toString(), "hello");
});

test("server lists teams and returns national analysis by default", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-analysis-"));
  const teamDirectory = join(dataDirectory, "test-team");
  await mkdir(teamDirectory);
  await writeFile(join(teamDirectory, "team-data.json"), JSON.stringify({
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
    roster: [{
      name: "Player One",
      ntrp: { level: "3.0", type: "C" },
      dr: 3,
      utr: {
        singles: { value: 3, display: "3.00", status: "verified" },
        doubles: { value: 3, display: "3.00", status: "verified" }
      },
      records: {
        singles: { wins: 0, losses: 0 },
        doubles: { wins: 0, losses: 0 }
      },
      qualifyingAppearances: { actual: 3, defaultsReceived: 0 },
      sectionalsAppearances: 0,
      nationalsEligibility: { status: "confirmed_eligible", display: "Eligible" }
    }],
    matches: []
  }));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));

  const server = createAppServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const teamsResponse = await fetch(`http://127.0.0.1:${port}/api/teams`);
  assert.equal(teamsResponse.status, 200);
  const teams = await teamsResponse.json();
  assert.equal(teams.defaultEligibilityScope, "national");
  assert.equal(teams.teams[0].id, "test-team");
  assert.equal(teams.teams[0].rosterSize, 1);
  assert.equal(teams.teams[0].matchCount, 0);

  const dataResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-data?team=test-team`
  );
  assert.equal(dataResponse.status, 200);
  const data = await dataResponse.json();
  assert.equal(data.team.name, "Test Team");
  assert.equal(data.roster[0].utr.singles.display, "3.00");

  const emptyRefreshResponse = await fetch(
    `http://127.0.0.1:${port}/api/refresh-jobs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "test-team",
        refreshTennisRecord: false,
        refreshUtr: false,
        utrMode: "none",
        refreshWtn: false
      })
    }
  );
  assert.equal(emptyRefreshResponse.status, 400);
  assert.match((await emptyRefreshResponse.json()).error, /at least one source/);

  const analysisResponse = await fetch(
    `http://127.0.0.1:${port}/api/analysis?team=test-team`
  );
  assert.equal(analysisResponse.status, 200);
  const analysis = await analysisResponse.json();
  assert.equal(analysis.analysisVersion, "1.1.0");
  assert.equal(analysis.eligibility.scope, "national");
  assert.equal(analysis.eligibility.summary.eligible, 1);
  assert.deepEqual(analysis.lineupPredictions.predictions, []);

  const analysisPath = join(teamDirectory, "analysis", "national.json");
  const savedAnalysis = JSON.parse(await readFile(analysisPath, "utf8"));
  assert.deepEqual(savedAnalysis, analysis);

  const cachedResponse = await fetch(
    `http://127.0.0.1:${port}/api/analysis?team=test-team`
  );
  assert.equal(cachedResponse.status, 200);
  assert.deepEqual(await cachedResponse.json(), savedAnalysis);

  const refreshedResponse = await fetch(
    `http://127.0.0.1:${port}/api/analysis?team=test-team&refresh=true`
  );
  assert.equal(refreshedResponse.status, 200);
  const refreshedAnalysis = await refreshedResponse.json();
  assert.equal(refreshedAnalysis.dataset.generatedAt, data.generatedAt);
  assert.deepEqual(
    JSON.parse(await readFile(analysisPath, "utf8")),
    refreshedAnalysis
  );
});

test("server creates event collections and assigns gathered teams", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-collections-"));
  const teamDirectory = join(dataDirectory, "test-team");
  await mkdir(teamDirectory);
  await writeFile(join(teamDirectory, "team-data.json"), JSON.stringify({
    datasetId: "2026-test-team",
    generatedAt: "2026-08-14T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: { name: "Test Team", season: 2026 },
    roster: [],
    matches: []
  }));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));

  const server = createAppServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const createResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "2026 3.0 Nationals Teams",
        datasetId: "2026-test-team"
      })
    }
  );
  assert.equal(createResponse.status, 201);
  const { collection } = await createResponse.json();
  assert.equal(collection.name, "2026 3.0 Nationals Teams");
  assert.deepEqual(collection.teamDatasetIds, ["2026-test-team"]);

  const duplicateResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "2026 3.0 Nationals Teams" })
    }
  );
  assert.equal(duplicateResponse.status, 409);

  const assignResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections/${collection.id}/team`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        datasetId: "2026-test-team",
        collectionId: collection.id
      })
    }
  );
  assert.equal(assignResponse.status, 200);
  const assigned = await assignResponse.json();
  assert.deepEqual(assigned.collections[0].teamDatasetIds, ["2026-test-team"]);

  const listResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`
  );
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.collections[0].name, "2026 3.0 Nationals Teams");

  const moveResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "2026 Sectionals",
        datasetId: "2026-test-team"
      })
    }
  );
  assert.equal(moveResponse.status, 201);
  const moved = await moveResponse.json();
  assert.deepEqual(moved.collections[0].teamDatasetIds, []);
  assert.deepEqual(moved.collection.teamDatasetIds, ["2026-test-team"]);

  const deleteMovedResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections/${moved.collection.id}`,
    { method: "DELETE" }
  );
  assert.equal(deleteMovedResponse.status, 200);

  const deleteResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections/${collection.id}`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  assert.equal(deleted.collection.id, collection.id);
  assert.deepEqual(deleted.collections, []);

  const missingDeleteResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections/${collection.id}`,
    { method: "DELETE" }
  );
  assert.equal(missingDeleteResponse.status, 404);
});
