import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listTeamCatalog,
  readCatalogTeam
} from "../scripts/lib/team-catalog.mjs";

test("team catalog combines gathered reports with pending national teams", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "team-catalog-"));
  const teamDirectory = join(dataDirectory, "gathered");
  await mkdir(teamDirectory);
  await writeFile(join(dataDirectory, "team-catalog.json"), JSON.stringify({
    version: 1,
    teams: [
      {
        datasetId: "2026-gathered",
        name: "Eastern - Gathered Team",
        section: "Eastern",
        sourceUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=Gathered"
      },
      {
        datasetId: "2026-pending",
        name: "Florida - Pending Team",
        section: "Florida",
        sourceUrl: null
      }
    ]
  }));
  await writeFile(join(dataDirectory, "2026-national-rosters.json"), JSON.stringify({
    version: 1,
    event: "Test Nationals",
    activeAsOf: "2026-09-21",
    source: "Official registration",
    teams: [
      {
        datasetId: "2026-gathered",
        name: "Eastern - Gathered Team",
        section: "Eastern",
        captain: "Gathered Captain",
        roster: [{ name: "Active Player", ntrp: "3.0", gender: "F" }]
      },
      {
        datasetId: "2026-pending",
        name: "Florida - Pending Team",
        section: "Florida",
        captain: "Pending Captain",
        roster: [{ name: "Pending Player", ntrp: "2.5", gender: "F" }]
      }
    ]
  }));
  await writeFile(join(teamDirectory, "team-data.json"), JSON.stringify({
    datasetId: "2026-gathered",
    generatedAt: "2026-09-01T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: {
      name: "Gathered Team",
      section: "Adult 18+ Eastern F 3.0",
      season: 2026
    },
    roster: [{}],
    matches: [{}, {}]
  }));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));

  const teams = await listTeamCatalog(dataDirectory);
  assert.equal(teams.length, 2);
  assert.deepEqual(
    teams.map(team => team.team.name),
    ["Eastern - Gathered Team", "Florida - Pending Team"]
  );
  assert.equal(teams[0].reportAvailable, true);
  assert.equal(teams[0].team.sourceName, "Gathered Team");
  assert.equal(teams[0].team.captain, "Gathered Captain");
  assert.equal(teams[0].activeRosterSize, 1);
  assert.equal(teams[0].nationalRosterAsOf, "2026-09-21");
  assert.equal(teams[1].reportAvailable, false);
  assert.equal(teams[1].collectionStage, "report_pending");
  assert.equal(teams[1].activeRosterSize, 1);
  assert.equal(teams[1].team.captain, "Pending Captain");
  const dataset = await readCatalogTeam(dataDirectory, teams[0].id);
  assert.deepEqual(dataset.nationalRoster, [
    { name: "Active Player", ntrp: "3.0", gender: "F" }
  ]);
  assert.equal(dataset.team.nationalsRepresentative, true);
  await assert.rejects(
    () => readCatalogTeam(dataDirectory, teams[1].id),
    /Team dataset not found/
  );
});

test("team catalog infers mixed league format for legacy datasets", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "mixed-team-catalog-"));
  const teamDirectory = join(dataDirectory, "mixed");
  await mkdir(teamDirectory);
  await writeFile(join(teamDirectory, "team-data.json"), JSON.stringify({
    datasetId: "2027-mixed",
    generatedAt: "2026-09-01T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: {
      name: "Happy Mixed Nuts18-Park",
      section: "Mixed 18+ Pacific NW X 7.0",
      league: "2027 Mixed 18 & Over",
      gender: "Unknown",
      season: 2027
    },
    sources: [],
    roster: [],
    matches: []
  }));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));

  const [team] = await listTeamCatalog(dataDirectory);
  assert.equal(team.team.leagueFormat, "mixed");
  assert.equal(team.team.gender, "Mixed");
  const dataset = await readCatalogTeam(dataDirectory, team.id);
  assert.equal(dataset.team.leagueFormat, "mixed");
});

test("team catalog fills missing player gender from another report of the same team", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "team-metadata-"));
  await mkdir(join(dataDirectory, "current"));
  await mkdir(join(dataDirectory, "legacy"));
  const base = {
    datasetId: "2027-mixed",
    generatedAt: "2026-09-01T00:00:00.000Z",
    collectionStage: "step_1_complete",
    team: {
      name: "Mixed Team",
      section: "Mixed 18+ X 7.0",
      season: 2027
    },
    sources: [],
    matches: []
  };
  await writeFile(
    join(dataDirectory, "current", "team-data.json"),
    JSON.stringify({
      ...base,
      generatedAt: "2026-09-02T00:00:00.000Z",
      roster: [{
        name: "Player One",
        gender: null,
        ntrp: { level: "3.5", type: "unknown" }
      }]
    })
  );
  await writeFile(
    join(dataDirectory, "legacy", "team-data.json"),
    JSON.stringify({
      ...base,
      roster: [{
        name: "Player One",
        gender: "Women",
        ntrp: { level: "3.5", type: "C" }
      }]
    })
  );
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));

  const dataset = await readCatalogTeam(dataDirectory, "current");
  assert.equal(dataset.roster[0].gender, "Women");
  assert.equal(dataset.roster[0].ntrp.type, "C");
});
