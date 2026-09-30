import test from "node:test";
import assert from "node:assert/strict";
import {
  TEAM_WORKSPACE_SCHEDULE_LIMIT,
  assignTeamRole,
  collectionMatchSchedule,
  defaultTeamWorkspace,
  emptyTeamWorkspace,
  groupWorkspaceTeams,
  parseTeamWorkspace,
  teamRole
} from "../web/public/team-workspace.mjs";

test("team workspace defaults to an unclassified scouting pool", () => {
  const workspace = parseTeamWorkspace(null);
  assert.deepEqual(workspace, emptyTeamWorkspace());
  assert.equal(teamRole(workspace, "team-a"), "scouting");
});

test("collection Match Day defaults resolve dataset IDs to current team IDs", () => {
  const workspace = defaultTeamWorkspace({
    teamDatasetIds: ["ours-dataset", "opponent-a", "opponent-b"],
    matchDayDefaults: {
      ourTeamDatasetId: "ours-dataset",
      opponentTeamDatasetIds: ["opponent-a", "opponent-b"]
    }
  }, [
    { id: "collections/ours-current", datasetId: "ours-dataset" },
    { id: "pending/opponent-a", datasetId: "opponent-a" },
    { id: "collections/opponent-b-current", datasetId: "opponent-b" },
    { id: "unrelated", datasetId: "other" }
  ]);

  assert.deepEqual(workspace, {
    ourTeamId: "collections/ours-current",
    scheduledOpponentIds: [
      "pending/opponent-a",
      "collections/opponent-b-current"
    ]
  });
});

test("collection Match Day schedule resolves each opponent team", () => {
  const schedule = collectionMatchSchedule({
    matchDayDefaults: {
      roundRobinMatches: [
        {
          opponentTeamDatasetId: "opponent-a",
          date: "2026-10-09",
          time: "8:00 AM",
          site: "Team USA Site"
        },
        {
          opponentTeamDatasetId: "missing",
          date: "2026-10-10",
          time: "3:00 PM",
          site: "Collegiate Site"
        }
      ]
    }
  }, [
    { id: "collections/opponent-a-current", datasetId: "opponent-a" }
  ]);

  assert.deepEqual(schedule, [{
    opponentTeamDatasetId: "opponent-a",
    opponentTeamId: "collections/opponent-a-current",
    date: "2026-10-09",
    time: "8:00 AM",
    site: "Team USA Site"
  }]);
});

test("assigning our team removes it from scheduled opponents", () => {
  const workspace = {
    ourTeamId: "team-a",
    scheduledOpponentIds: ["team-b", "team-c"]
  };
  const next = assignTeamRole(workspace, "team-b", "our");

  assert.equal(next.ourTeamId, "team-b");
  assert.deepEqual(next.scheduledOpponentIds, ["team-c"]);
  assert.equal(teamRole(next, "team-a"), "scouting");
});

test("scheduled opponents are capped at the flight schedule size", () => {
  let workspace = emptyTeamWorkspace();
  for (let index = 0; index < TEAM_WORKSPACE_SCHEDULE_LIMIT; index += 1) {
    workspace = assignTeamRole(workspace, `opponent-${index}`, "scheduled");
  }

  assert.throws(
    () => assignTeamRole(workspace, "opponent-extra", "scheduled"),
    /Move one to the scouting pool/
  );
});

test("workspace teams are grouped without hiding unclassified reports", () => {
  const teams = [
    { id: "ours" },
    { id: "scheduled" },
    { id: "research" }
  ];
  const groups = groupWorkspaceTeams(teams, {
    ourTeamId: "ours",
    scheduledOpponentIds: ["scheduled"]
  });

  assert.equal(groups.ourTeam.id, "ours");
  assert.deepEqual(groups.scheduledOpponents.map(team => team.id), ["scheduled"]);
  assert.deepEqual(groups.scoutingPool.map(team => team.id), ["research"]);
});

test("stored workspaces remove duplicates and our team conflicts", () => {
  const workspace = parseTeamWorkspace(JSON.stringify({
    ourTeamId: "ours",
    scheduledOpponentIds: ["ours", "opponent", "opponent"]
  }));

  assert.deepEqual(workspace, {
    ourTeamId: "ours",
    scheduledOpponentIds: ["opponent"]
  });
});
