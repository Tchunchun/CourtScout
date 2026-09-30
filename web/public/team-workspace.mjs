export const TEAM_WORKSPACE_SCHEDULE_LIMIT = 4;

const TEAM_ROLES = new Set(["our", "scheduled", "scouting"]);

export function emptyTeamWorkspace() {
  return {
    ourTeamId: null,
    scheduledOpponentIds: []
  };
}

function validTeamId(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseTeamWorkspace(raw) {
  if (!raw) return emptyTeamWorkspace();
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Team workspace must be an object.");
  }
  const ourTeamId = validTeamId(parsed.ourTeamId);
  if (
    parsed.scheduledOpponentIds != null &&
    !Array.isArray(parsed.scheduledOpponentIds)
  ) {
    throw new Error("Scheduled opponents must be an array.");
  }
  const scheduledOpponentIds = [...new Set(
    (parsed.scheduledOpponentIds ?? [])
      .map(validTeamId)
      .filter(teamId => teamId && teamId !== ourTeamId)
  )].slice(0, TEAM_WORKSPACE_SCHEDULE_LIMIT);
  return { ourTeamId, scheduledOpponentIds };
}

export function teamRole(workspace, teamId) {
  if (workspace.ourTeamId === teamId) return "our";
  if (workspace.scheduledOpponentIds.includes(teamId)) return "scheduled";
  return "scouting";
}

export function assignTeamRole(workspace, teamId, role) {
  const normalizedTeamId = validTeamId(teamId);
  if (!normalizedTeamId) throw new Error("Choose a valid gathered team.");
  if (!TEAM_ROLES.has(role)) throw new Error("Choose a valid team role.");

  const next = {
    ourTeamId: workspace.ourTeamId,
    scheduledOpponentIds: [...workspace.scheduledOpponentIds]
  };
  next.scheduledOpponentIds = next.scheduledOpponentIds.filter(
    opponentId => opponentId !== normalizedTeamId
  );

  if (role === "our") {
    next.ourTeamId = normalizedTeamId;
    return next;
  }

  if (next.ourTeamId === normalizedTeamId) {
    next.ourTeamId = null;
  }
  if (role === "scheduled") {
    if (next.scheduledOpponentIds.length >= TEAM_WORKSPACE_SCHEDULE_LIMIT) {
      throw new Error(
        `Only ${TEAM_WORKSPACE_SCHEDULE_LIMIT} scheduled opponents can be active. Move one to the scouting pool first.`
      );
    }
    next.scheduledOpponentIds.push(normalizedTeamId);
  }
  return next;
}

export function groupWorkspaceTeams(teams, workspace) {
  const ourTeam = teams.find(team => team.id === workspace.ourTeamId) ?? null;
  const scheduledIdSet = new Set(workspace.scheduledOpponentIds);
  return {
    ourTeam,
    scheduledOpponents: workspace.scheduledOpponentIds
      .map(teamId => teams.find(team => team.id === teamId))
      .filter(Boolean),
    scoutingPool: teams.filter(team =>
      team.id !== workspace.ourTeamId && !scheduledIdSet.has(team.id)
    )
  };
}

export function rankTeamsBySchedule(teams, workspace) {
  const scheduleRanks = new Map(
    workspace.scheduledOpponentIds.map((teamId, index) => [teamId, index + 1])
  );
  return teams
    .map((team, originalIndex) => ({
      team,
      scheduleRank: scheduleRanks.get(team.id) ?? null,
      originalIndex
    }))
    .sort((left, right) =>
      (left.scheduleRank ?? Number.POSITIVE_INFINITY) -
        (right.scheduleRank ?? Number.POSITIVE_INFINITY) ||
      left.originalIndex - right.originalIndex
    )
    .map(({ team, scheduleRank }) => ({ team, scheduleRank }));
}
