import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  API_CONTRACT_VERSION,
  MINIMUM_APP_VERSION,
  collectionFolderName,
  createAppServer,
  createUtrCommandQueue,
  findActiveScoutingJob,
  findExistingHomeCollection,
  mergePreservedRefreshData,
  parseTeamType,
  parseRefreshSelections,
  parseRatingSelections,
  ratingSelectionSlug,
  resolveDataDirectory,
  runScoutingJob,
  teamSourceKey,
  temporaryCollectionName,
  validateTeamUrl
} from "../web/server.mjs";
import { getEventSchedule } from "../scripts/lib/event-schedules.mjs";

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

test("team type and temporary collection names support scouting intent", () => {
  assert.equal(parseTeamType("home"), "home");
  assert.equal(parseTeamType("opponent"), "opponent");
  assert.equal(parseTeamType(), "opponent");
  assert.throws(() => parseTeamType("visitor"), /home team or an opponent team/);
  assert.equal(
    temporaryCollectionName(
      "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Example%20Team",
      "abcd1234"
    ),
    "Temporary — 2026 Example Team — abcd1234"
  );
});

test("active scouting jobs are reused for the same confirmed intake", () => {
  const active = {
    id: "active-job",
    teamUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2027&teamname=HOME",
    teamType: "home",
    status: "running"
  };
  assert.equal(
    findActiveScoutingJob(
      [active],
      active.teamUrl,
      active.teamType
    ),
    active
  );
  assert.equal(
    findActiveScoutingJob(
      [{ ...active, status: "complete" }],
      active.teamUrl,
      active.teamType
    ),
    null
  );
});

test("completed home-team intake reuses its exact source collection", () => {
  const teamUrl =
    "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2027&teamname=HOME";
  const collection = {
    id: "event",
    teamDatasetIds: ["2027-home", "2027-opponent"]
  };
  assert.equal(findExistingHomeCollection(
    [collection],
    [{
      datasetId: "2027-home",
      sourceUrl:
        "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=HOME&year=2027"
    }],
    teamUrl
  ), collection);
  assert.equal(findExistingHomeCollection(
    [collection],
    [{
      datasetId: "2027-home",
      sourceUrl: teamUrl
    }],
    `${teamUrl}-different`
  ), null);
  assert.equal(
    teamSourceKey(teamUrl),
    teamSourceKey(
      "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=HOME&year=2027"
    )
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

test("rating selections only allow optional UTR", () => {
  assert.deepEqual(parseRatingSelections({
    utrMode: "none",
    includeWtn: true
  }), {
    utr: "none",
    wtn: false
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
  assert.equal(ratingSelectionSlug({ utr: "public", wtn: true }), "public-utr");
  assert.equal(
    ratingSelectionSlug({ utr: "none", wtn: false }),
    "no-ratings"
  );
  assert.throws(
    () => parseRatingSelections({ utrMode: "estimated", includeWtn: false }),
    /no UTR, public UTR, or signed-in UTR/
  );
});

test("refresh selections require at least one explicitly selected source", () => {
  assert.deepEqual(parseRefreshSelections({
    refreshTennisRecord: true,
    refreshUtr: false,
    utrMode: "none"
  }), {
    tennisrecord: true,
    utr: "none",
    scope: "all"
  });
  assert.deepEqual(parseRefreshSelections({
    refreshTennisRecord: false,
    refreshUtr: true,
    utrMode: "authenticated"
  }), {
    tennisrecord: false,
    utr: "authenticated",
    scope: "all"
  });
  assert.throws(() => parseRefreshSelections({
    refreshTennisRecord: false,
    refreshUtr: false,
    utrMode: "none"
  }), /at least one source/);
  assert.throws(() => parseRefreshSelections({
    refreshTennisRecord: false,
    refreshUtr: true,
    utrMode: "public",
    refreshWtn: false,
    ratingScope: "scheduled"
  }), /team ratings, opponent ratings, or both/);
});

test("TennisRecord refresh preserves UTR and curated analysis but discards WTN", () => {
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
    utr: "none"
  });

  assert.equal(merged.roster[0].dr, 3.1);
  assert.equal(merged.roster[0].utr.lookupStatus, "public_profile_resolved");
  assert.equal(merged.roster[0].wtn, undefined);
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
  assert.deepEqual(merged.ratingSelections, { utr: "public", wtn: false });
  assert.deepEqual(
    merged.sources.map(source => source.type),
    [
      "tennisrecord",
      "utr_sports_public_profiles"
    ]
  );
});

test("scoped TennisRecord refresh preserves ratings outside the selected group", () => {
  const current = {
    roster: [{
      name: "Team Player",
      dr: 3,
      utr: { lookupStatus: "old-team-utr" },
      wtn: { lookupStatus: "old-team-wtn" }
    }],
    opponents: [{
      name: "Opponent Player",
      dr: 3.2,
      utr: { lookupStatus: "old-opponent-utr" },
      wtn: { lookupStatus: "old-opponent-wtn" }
    }],
    sources: [
      { type: "utr_sports_public_profiles" },
      { type: "world_tennis_number_public_profiles" }
    ],
    dataQuality: {},
    ratingSelections: { utr: "public", wtn: true }
  };
  const fresh = {
    roster: [{
      name: "Team Player",
      dr: 3.1,
      utr: { lookupStatus: "not_started" },
      wtn: { lookupStatus: "not_started" }
    }],
    opponents: [{
      name: "Opponent Player",
      dr: 3.3,
      utr: { lookupStatus: "not_started" },
      wtn: { lookupStatus: "not_started" }
    }],
    sources: [],
    dataQuality: {},
    matches: []
  };

  const merged = mergePreservedRefreshData(fresh, current, {
    tennisrecord: true,
    utr: "public",
    wtn: true,
    scope: "opponents"
  });

  assert.equal(merged.roster[0].dr, 3);
  assert.equal(merged.roster[0].utr.lookupStatus, "old-team-utr");
  assert.equal(merged.roster[0].wtn.lookupStatus, "old-team-wtn");
  assert.equal(merged.opponents[0].dr, 3.3);
  assert.equal(merged.opponents[0].utr.lookupStatus, "not_started");
  assert.equal(merged.opponents[0].wtn.lookupStatus, "not_started");
  assert.deepEqual(merged.sources, current.sources);
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
  const previewRequests = [];
  const server = createAppServer({
    previewTeam: async teamUrl => {
      previewRequests.push(teamUrl);
      return {
        team: {
          name: "Example Home",
          league: "2026 Adult 3.0",
          section: "Test Section",
          season: 2026
        },
        rosterSize: 12,
        leagueTeams: [{
          name: "Example Opponent",
          url: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Opponent"
        }]
      };
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /<section class="hero" id="intakeView" hidden>/);
  assert.match(pageHtml, /<section class="reports-view" id="reportsView">/);
  assert.match(pageHtml, /id="scoutCollectionTeam"/);
  assert.match(pageHtml, /id="scoutCollectionContext"/);
  assert.match(pageHtml, /id="refreshReportsSchedule"/);
  assert.match(pageHtml, /Build my scouting report/);
  assert.match(pageHtml, /See the team <em>before<\/em> you face them/);
  assert.match(pageHtml, /Pull UTR ratings/);
  assert.match(pageHtml, /<input type="checkbox" id="includeUtr">/);
  assert.match(pageHtml, /<div class="rating-detail" id="utrOptions" hidden>/);
  assert.match(pageHtml, /id="scoutCompetitionLevel"/);
  assert.doesNotMatch(pageHtml, /id="eligibilityScope"/);
  assert.doesNotMatch(pageHtml, /Change settings/);
  assert.doesNotMatch(pageHtml, /WTN|World Tennis Number/);
  assert.match(pageHtml, /Refresh data/);
  const scheduleModule = await fetch(
    `http://127.0.0.1:${port}/schedule.mjs`
  );
  assert.equal(scheduleModule.status, 200);
  assert.match(await scheduleModule.text(), /parseCsv/);

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

  const previewResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Example",
        teamType: "home"
      })
    }
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.team.name, "Example Home");
  assert.equal(preview.rosterSize, 12);
  assert.equal(preview.leagueTeams[0].name, "Example Opponent");
  assert.equal(previewRequests.length, 1);

  const opponentPreviewResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Example",
        teamType: "opponent"
      })
    }
  );
  assert.equal(opponentPreviewResponse.status, 200);
  assert.deepEqual((await opponentPreviewResponse.json()).leagueTeams, []);

  const card = {
    id: "server-card",
    ourTeamId: "ours",
    opponentTeamId: "theirs",
    updatedAt: "2026-09-30T12:00:00.000Z"
  };
  const saveCardsResponse = await fetch(
    `http://127.0.0.1:${port}/api/match-cards`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cards: [card] })
    }
  );
  assert.equal(saveCardsResponse.status, 200);
  const cardsResponse = await fetch(
    `http://127.0.0.1:${port}/api/match-cards`
  );
  assert.equal(cardsResponse.status, 200);
  assert.deepEqual((await cardsResponse.json()).cards, [card]);
});

test("server reuses an active home scouting job and its collection", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-active-home-"));
  let releaseJob;
  const jobGate = new Promise(resolve => {
    releaseJob = resolve;
  });
  const server = createAppServer({
    dataDirectory,
    runCollectionJob: async job => {
      job.status = "running";
      await jobGate;
      job.status = "failed";
      job.error = "Test job stopped";
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    releaseJob();
    server.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });
  const { port } = server.address();
  const body = JSON.stringify({
    teamUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2027&teamname=IDEMPOTENT-HOME",
    teamType: "home",
    utrMode: "none",
    includeWtn: false
  });
  const request = () => fetch(`http://127.0.0.1:${port}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });

  const first = await request();
  const second = await request();
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal((await first.json()).id, (await second.json()).id);

  const collectionsResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`
  );
  assert.equal(collectionsResponse.status, 200);
  assert.equal((await collectionsResponse.json()).collections.length, 1);
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
    contractVersion: API_CONTRACT_VERSION,
    minimumAppVersion: MINIMUM_APP_VERSION,
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
  const v1Data = await fetch(`http://127.0.0.1:${port}/api/v1/team-data?team=test-team`);
  assert.equal(v1Data.status, 200);
  assert.deepEqual(await v1Data.json(), data);
  const storedDataset = JSON.parse(await readFile(join(teamDirectory, "team-data.json"), "utf8"));
  assert.equal(storedDataset.contractVersion, undefined);
  assert.equal(storedDataset.minimumAppVersion, undefined);
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
        utrMode: "none"
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
  assert.equal(analysis.analysisVersion, "1.3.0");
  const v1Analysis = await fetch(`http://127.0.0.1:${port}/api/v1/analysis?team=test-team&eligibility=local`);
  assert.equal(v1Analysis.status, 200);
  assert.equal(withoutApiMetadata(await v1Analysis.json()).eligibility.scope, "local");
  assert.equal(analysis.eligibility.scope, "national");
  assert.equal(analysis.eligibility.summary.eligible, 1);
  assert.deepEqual(analysis.lineupPredictions.predictions, []);

  const analysisPath = join(teamDirectory, "analysis", "national.json");
  const savedAnalysis = JSON.parse(await readFile(analysisPath, "utf8"));
  assert.deepEqual({ ...savedAnalysis, contractVersion: API_CONTRACT_VERSION, minimumAppVersion: MINIMUM_APP_VERSION }, analysis);
  assert.equal(savedAnalysis.contractVersion, undefined);
  assert.equal(savedAnalysis.minimumAppVersion, undefined);

  const cachedResponse = await fetch(
    `http://127.0.0.1:${port}/api/analysis?team=test-team`
  );
  assert.equal(cachedResponse.status, 200);
  assert.deepEqual(await cachedResponse.json(), analysis);

  const refreshedResponse = await fetch(
    `http://127.0.0.1:${port}/api/analysis?team=test-team&refresh=true`
  );
  assert.equal(refreshedResponse.status, 200);
  const refreshedAnalysis = await refreshedResponse.json();
  assert.equal(refreshedAnalysis.dataset.generatedAt, data.generatedAt);
  assert.deepEqual(
    JSON.parse(await readFile(analysisPath, "utf8")),
    withoutApiMetadata(refreshedAnalysis)
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

  const missingCollectionResponse = await fetch(
    `http://127.0.0.1:${port}/api/jobs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Test",
        utrMode: "none",
        includeWtn: false,
        eventCollectionId: "missing"
      })
    }
  );
  assert.equal(missingCollectionResponse.status, 404);
  assert.match(
    (await missingCollectionResponse.json()).error,
    /Event collection not found/
  );

  const invalidLevelResponse = await fetch(
    `http://127.0.0.1:${port}/api/jobs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Test",
        utrMode: "none",
        competitionLevel: "regional"
      })
    }
  );
  assert.equal(invalidLevelResponse.status, 400);
  assert.match((await invalidLevelResponse.json()).error, /Local season/);

  const createResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "2026 3.0 Nationals Teams",
        competitionLevel: "national",
        datasetId: "2026-test-team"
      })
    }
  );
  assert.equal(createResponse.status, 201);
  const { collection } = await createResponse.json();
  assert.equal(collection.name, "2026 3.0 Nationals Teams");
  assert.equal(collection.competitionLevel, "national");
  assert.deepEqual(collection.teamDatasetIds, ["2026-test-team"]);

  const renameResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections/${collection.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "2026 Nationals Schedule" })
    }
  );
  assert.equal(renameResponse.status, 200);
  assert.equal(
    (await renameResponse.json()).collection.name,
    "2026 Nationals Schedule"
  );

  const scheduleResponse = await fetch(
    `http://127.0.0.1:${port}/api/event-schedules/${collection.id}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ourTeamId: "test-team",
        eventType: "sectionals",
        timezone: "America/Los_Angeles",
        source: { type: "csv", fileName: "schedule.csv" },
        matches: [{
          id: "match-one",
          sourceOpponentName: "Opponent One",
          date: "2026-10-01",
          status: "scheduled",
          designation: "neutral",
          sourceType: "csv"
        }]
      })
    }
  );
  assert.equal(scheduleResponse.status, 200);
  const confirmedSchedule = await scheduleResponse.json();
  assert.equal(confirmedSchedule.schedule.eligibilityScope, "national");

  const schedulePreviewResponse = await fetch(
    `http://127.0.0.1:${port}/api/event-schedules/${collection.id}/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matches: [{
          id: "match-one",
          sourceOpponentName: "Opponent One",
          date: "2026-10-02",
          status: "postponed",
          designation: "neutral",
          sourceType: "csv"
        }]
      })
    }
  );
  assert.equal(schedulePreviewResponse.status, 200);
  assert.equal(
    (await schedulePreviewResponse.json()).reconciliation[0].change,
    "changed"
  );

  const linkResponse = await fetch(
    `http://127.0.0.1:${port}/api/event-schedules/${collection.id}/link`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matchId: "match-one",
        teamId: "test-team"
      })
    }
  );
  assert.equal(linkResponse.status, 200);
  assert.equal(
    (await linkResponse.json()).schedule.matches[0].linkedOpponentTeamId,
    "test-team"
  );

  const duplicateResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "2026 Nationals Schedule",
        competitionLevel: "national"
      })
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
  assert.equal(listed.collections[0].name, "2026 Nationals Schedule");

  const moveResponse = await fetch(
    `http://127.0.0.1:${port}/api/team-collections`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "2026 Sectionals",
        competitionLevel: "sectional",
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

test("server shares team roles per season and refuses stale saves", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-team-roles-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  for (const [folder, datasetId] of [["our-team", "2027-our"], ["their-team", "2027-their"]]) {
    await mkdir(join(dataDirectory, folder));
    await writeFile(join(dataDirectory, folder, "team-data.json"), JSON.stringify({
      datasetId,
      generatedAt: "2027-01-01T00:00:00.000Z",
      collectionStage: "step_1_complete",
      team: { name: folder, season: 2027 },
      roster: [],
      matches: []
    }));
  }
  const server = createAppServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (method, path, body) => fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body)
  });

  const { collection } = await (await send("POST", "/api/team-collections", {
    name: "2027 Mixed 7.0",
    competitionLevel: "local",
    datasetId: "2027-our"
  })).json();
  assert.equal((await send("PUT", `/api/team-collections/${collection.id}/team`, {
    datasetId: "2027-their"
  })).status, 200);

  const unsaved = await (await send("GET", `/api/team-roles/${collection.id}`)).json();
  assert.equal(unsaved.saved, false);
  assert.equal(unsaved.revision, 0);

  const saved = await send("PUT", `/api/team-roles/${collection.id}`, {
    ourTeamId: "our-team",
    scheduledOpponentIds: ["their-team"],
    baseRevision: 0
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);

  const stale = await send("PUT", `/api/team-roles/${collection.id}`, {
    ourTeamId: "their-team",
    scheduledOpponentIds: [],
    baseRevision: 0
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.ourTeamId, "our-team");

  const outsider = await send("PUT", `/api/team-roles/${collection.id}`, {
    ourTeamId: "someone-else"
  });
  assert.equal(outsider.status, 400);
  assert.match((await outsider.json()).error, /teams in this season/);

  const read = await (await send("GET", `/api/team-roles/${collection.id}`)).json();
  assert.deepEqual(
    [read.saved, read.ourTeamId, read.scheduledOpponentIds],
    [true, "our-team", ["their-team"]]
  );
  assert.equal((await send("GET", "/api/team-roles/missing")).status, 404);

  assert.equal((await send("DELETE", `/api/team-collections/${collection.id}`)).status, 200);
  const stored = JSON.parse(await readFile(join(dataDirectory, "team-roles.json"), "utf8"));
  assert.deepEqual(stored.seasons, {});
});

test("server suggests and saves doubles pairs for a gathered team", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-team-pairs-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  await mkdir(join(dataDirectory, "our-team"));
  await writeFile(join(dataDirectory, "our-team", "team-data.json"), JSON.stringify({
    datasetId: "2027-our",
    generatedAt: "2027-01-01T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: { name: "Our team", season: 2027, gender: "Women" },
    roster: [{ name: "Alice" }, { name: "Beth" }, { name: "Cara" }],
    matches: [{ courts: {
      D1: { targetPlayers: ["Alice", "Beth"], result: "W" },
      D2: { targetPlayers: ["Alice", "Cara"], result: "L" }
    } }]
  }));
  const server = createAppServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (method, prefix, body) => fetch(`${base}${prefix}/team-pairs/our-team`, {
    method,
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body)
  });

  const suggested = await (await send("GET", "/api")).json();
  assert.equal(suggested.saved, false);
  assert.equal(suggested.suggestions.length, 2);

  const savedResponse = await send("PUT", "/api/v1", {
    pairs: [{ players: ["Alice", "Beth"], tag: "go-to", preferredCourt: "D1" }],
    baseRevision: 0
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.revision, 1);
  assert.equal(saved.contractVersion, API_CONTRACT_VERSION);
  assert.equal(saved.pairs[0].appearances, 1);

  const stale = await send("PUT", "/api", { pairs: [], baseRevision: 0 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.revision, 1);
  assert.equal((await fetch(`${base}/api/team-pairs/missing`)).status, 404);
});

test("server saves jobs and reports one interrupted by a restart", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-saved-jobs-"));
  let releaseJob;
  const jobGate = new Promise(resolve => {
    releaseJob = resolve;
  });
  const server = createAppServer({
    dataDirectory,
    runCollectionJob: async job => {
      job.status = "running";
      await jobGate;
      job.status = "failed";
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    releaseJob();
    server.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const started = await (await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      teamUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2027&teamname=SAVED-JOB",
      utrMode: "none",
      includeWtn: false
    })
  })).json();
  let snapshot;
  for (let attempt = 0; attempt < 50 && !snapshot; attempt += 1) {
    snapshot = await readFile(join(dataDirectory, "jobs", `${started.id}.json`), "utf8")
      .catch(() => null);
    if (!snapshot) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(JSON.parse(snapshot).id, started.id);

  // A job this server never ran, saved mid-gather by an earlier process.
  const orphanId = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
  await writeFile(join(dataDirectory, "jobs", `${orphanId}.json`), JSON.stringify({
    id: orphanId,
    kind: "league-collection",
    status: "running",
    phase: "opponents",
    progress: 40,
    detail: "Gathering opponents",
    discoveredOpponentCount: 10,
    collectedTeamCount: 4
  }));
  const orphan = await (await fetch(`${base}/api/jobs/${orphanId}`)).json();
  assert.equal(orphan.status, "failed");
  assert.equal(orphan.collectedTeamCount, 4);
  assert.match(orphan.error, /server restarted/);

  const unknown = await fetch(`${base}/api/jobs/${orphanId.replace("0e", "ff")}`);
  assert.equal(unknown.status, 404);
});

test("starting a season again reuses its teams and gathers only missing opponents", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tennis-season-again-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const profile = name =>
    `https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=${name}&year=2027`;
  const writeTeam = async (folder, datasetId, url, extra = {}) => {
    await mkdir(join(dataDirectory, "collections", folder), { recursive: true });
    await writeFile(join(dataDirectory, "collections", folder, "team-data.json"), JSON.stringify({
      datasetId,
      generatedAt: "2027-01-01T00:00:00.000Z",
      collectionStage: "step_1_complete",
      team: { name: folder, season: 2027 },
      sources: [{ type: "tennisrecord", url }],
      roster: [],
      matches: [],
      ...extra
    }));
  };
  // The home team's league lists Gathered (already in the season, linked with
  // different parameter order) and Missing.
  await writeTeam("home", "2027-home", profile("Home"), {
    leagueTeams: [
      { name: "Home", url: profile("Home") },
      { name: "Gathered", url: `${profile("Gathered")}&s=2` },
      { name: "Missing", url: profile("Missing") }
    ],
    leagueSchedule: []
  });
  await writeTeam("gathered", "2027-gathered", profile("Gathered"));

  const gathered = [];
  const server = createAppServer({
    dataDirectory,
    runCollectionJob: async job => {
      gathered.push(job.teamUrl);
      job.status = "complete";
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (method, path, body) => fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body)
  });

  const { collection } = await (await send("POST", "/api/team-collections", {
    name: "2027 Season",
    competitionLevel: "local",
    datasetId: "2027-home"
  })).json();
  await send("PUT", `/api/team-collections/${collection.id}/team`, { datasetId: "2027-gathered" });

  const started = await (await send("POST", "/api/jobs", {
    teamUrl: profile("Home"),
    teamType: "home",
    utrMode: "none",
    eventCollectionId: collection.id
  })).json();
  assert.equal(started.teamId, "collections/home");

  let job = started;
  for (let attempt = 0; attempt < 50 && job.status !== "complete"; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
    job = await (await send("GET", `/api/jobs/${started.id}`)).json();
  }
  assert.equal(job.status, "complete");
  assert.deepEqual(gathered, [profile("Missing")]);
  assert.equal(job.discoveredOpponentCount, 2);
  assert.equal(job.collectedTeamCount, 3);
  assert.match(job.detail, /All 3 league teams are in this season; gathered 1 missing/);
  assert.equal(await getEventSchedule(dataDirectory, collection.id), null);
});

function withoutApiMetadata({ contractVersion, minimumAppVersion, ...body }) {
  assert.equal(contractVersion, API_CONTRACT_VERSION);
  assert.equal(minimumAppVersion, MINIMUM_APP_VERSION);
  return body;
}

test("v1 and legacy routes share reads, writes, query parameters and errors", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "court-scout-api-v1-"));
  const server = createAppServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDirectory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, method = "GET", body) {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    assert.match(response.headers.get("content-type"), /application\/json/);
    return { status: response.status, body: withoutApiMetadata(await response.json()) };
  }
  for (const path of ["teams", "team-collections", "match-cards", "jobs/deadbeef", "jobs/deadbeef/data", "team-data?team=missing", "analysis?team=missing&eligibility=local", "unknown"]) {
    assert.deepEqual(await call(`/api/v1/${path}`), await call(`/api/${path}`), path);
  }
  const created = await call("/api/v1/team-collections", "POST", { name: "API season", competitionLevel: "local" });
  assert.equal(created.status, 201);
  const id = created.body.collection.id;
  assert.equal((await call("/api/team-collections")).body.collections[0].id, id);
  assert.equal((await call(`/api/v1/team-collections/${id}`, "PATCH", { name: "Renamed" })).status, 200);
  assert.equal((await call("/api/team-collections")).body.collections[0].name, "Renamed");
  for (const path of [`team-roles/${id}`, `event-schedules/${id}`]) {
    assert.deepEqual(await call(`/api/v1/${path}`), await call(`/api/${path}`));
  }
  const roles = { ourTeamId: null, scheduledOpponentIds: [], baseRevision: 0 };
  assert.equal((await call(`/api/v1/team-roles/${id}`, "PUT", roles)).status, 200);
  const conflict = await call(`/api/team-roles/${id}`, "PUT", roles);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.current.revision, 1);
  const card = { id: "card", ourTeamId: "ours", opponentTeamId: "theirs" };
  assert.equal((await call("/api/v1/match-cards", "PUT", { cards: [card] })).status, 200);
  assert.deepEqual((await call("/api/match-cards")).body.cards, [card]);
  assert.equal((await call("/api/match-cards", "PUT", { cards: [] })).status, 200);
  assert.deepEqual((await call("/api/v1/match-cards")).body.cards, []);
  for (const prefix of ["/api", "/api/v1"]) {
    assert.equal((await call(`${prefix}/match-cards`, "PUT", { cards: null })).status, 400);
    assert.equal((await call(`${prefix}/teams`, "POST", {})).status, 405);
    const malformed = await fetch(`${base}${prefix}/team-collections`, { method: "POST", body: "{" });
    assert.equal(malformed.status, 400);
    assert.match(withoutApiMetadata(await malformed.json()).error, /valid JSON/);
  }
  for (const path of ["/api/v10/teams", "/api/v2/teams", "/api/v1extra/teams"]) {
    assert.equal((await call(path)).status, 404);
  }
  assert.equal((await call(`/api/v1/team-collections/${id}`, "DELETE")).status, 200);
  assert.deepEqual((await call("/api/team-collections")).body.collections, []);
  const page = await fetch(base + "/");
  assert.match(page.headers.get("content-type"), /text\/html/);
});
