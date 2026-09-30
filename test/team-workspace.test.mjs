import test from "node:test";
import assert from "node:assert/strict";
import {
  TEAM_WORKSPACE_SCHEDULE_LIMIT,
  assignTeamRole,
  emptyTeamWorkspace,
  groupWorkspaceTeams,
  parseTeamWorkspace,
  rankTeamsBySchedule,
  teamRole
} from "../web/public/team-workspace.mjs";

test("team workspace defaults to an unclassified scouting pool", () => {
  const workspace = parseTeamWorkspace(null);
  assert.deepEqual(workspace, emptyTeamWorkspace());
  assert.equal(teamRole(workspace, "team-a"), "scouting");
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

test("report teams follow match schedule order and retain unscheduled teams", () => {
  const teams = [
    { id: "research-a" },
    { id: "opponent-two" },
    { id: "ours" },
    { id: "opponent-one" },
    { id: "research-b" }
  ];

  const ranked = rankTeamsBySchedule(teams, {
    ourTeamId: "ours",
    scheduledOpponentIds: ["opponent-one", "opponent-two"]
  });

  assert.deepEqual(
    ranked.map(({ team, scheduleRank }) => [team.id, scheduleRank]),
    [
      ["opponent-one", 1],
      ["opponent-two", 2],
      ["research-a", null],
      ["ours", null],
      ["research-b", null]
    ]
  );
});

test("report teams keep their gathered order when no schedule is available", () => {
  const teams = [{ id: "team-b" }, { id: "team-a" }];

  assert.deepEqual(
    rankTeamsBySchedule(teams, emptyTeamWorkspace()),
    [
      { team: teams[0], scheduleRank: null },
      { team: teams[1], scheduleRank: null }
    ]
  );
});
