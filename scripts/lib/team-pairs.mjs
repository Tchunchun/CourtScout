import {
  DEFAULT_WORKSPACE_ID,
  StoreConflictError,
  storeFor,
  updateDocument,
  workspaceKey
} from "./store.mjs";

const STORE_KEY = workspaceKey(DEFAULT_WORKSPACE_ID, "team-pairs.json");

export class TeamPairsConflictError extends Error {
  constructor(current) {
    super("Doubles pairs were changed on another device. Reload and try again.");
    this.name = "TeamPairsConflictError";
    this.current = current;
  }
}

function emptyStore() {
  return { version: 1, teams: {} };
}

function normalizeStore(value) {
  if (!value || value.version !== 1 || !value.teams ||
      typeof value.teams !== "object" || Array.isArray(value.teams)) {
    throw new Error("Team pairs file is invalid.");
  }
  return value;
}

function pairKey(players) {
  return [...players].sort((a, b) => a.localeCompare(b)).join("\u0000");
}

// National teams name their active players separately from the gathered roster.
function activeRosterNames(dataset) {
  return new Set((dataset.nationalRoster ?? dataset.roster ?? []).map(player => player.name));
}

function pairHistory(dataset) {
  const roster = activeRosterNames(dataset);
  const histories = new Map();
  for (const match of dataset.matches ?? []) {
    for (const [court, result] of Object.entries(match.courts ?? {})) {
      const players = result.targetPlayers ?? [];
      if (!court.startsWith("D") || players.length !== 2 ||
          players.some(name => !roster.has(name))) continue;
      const key = pairKey(players);
      const history = histories.get(key) ?? {
        players: [...players].sort((a, b) => a.localeCompare(b)),
        appearances: 0,
        wins: 0,
        losses: 0,
        courts: new Map()
      };
      history.appearances += 1;
      if (result.result === "W") history.wins += 1;
      if (result.result === "L") history.losses += 1;
      history.courts.set(court, (history.courts.get(court) ?? 0) + 1);
      histories.set(key, history);
    }
  }
  return histories;
}

function historyFields(history) {
  if (!history) return { appearances: 0, wins: 0, losses: 0 };
  return {
    appearances: history.appearances,
    wins: history.wins,
    losses: history.losses
  };
}

export function suggestTeamPairs(dataset) {
  return [...pairHistory(dataset).values()]
    .map(history => ({
      players: history.players,
      tag: "suggested",
      preferredCourt: [...history.courts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
      ...historyFields(history),
      suggested: true
    }))
    .sort((a, b) =>
      b.appearances - a.appearances ||
      pairKey(a.players).localeCompare(pairKey(b.players))
    );
}

function validatePairs(dataset, input) {
  if (!Array.isArray(input)) throw new Error("Pairs must be a list.");
  const active = activeRosterNames(dataset);
  const roster = new Map((dataset.roster ?? []).map(player => [player.name, player]));
  const seen = new Set();
  return input.map(pair => {
    if (!pair || !Array.isArray(pair.players) || pair.players.length !== 2) {
      throw new Error("Each pair must contain exactly two players.");
    }
    const players = pair.players.map(name => String(name ?? "").trim());
    if (!players[0] || players[0] === players[1]) {
      throw new Error("A pair must contain two different players.");
    }
    if (players.some(name => !active.has(name))) {
      throw new Error("Pairs can only use players on the active roster.");
    }
    const key = pairKey(players);
    if (seen.has(key)) throw new Error("The same pair cannot be saved twice.");
    seen.add(key);
    if (!["go-to", "backup"].includes(pair.tag)) {
      throw new Error("Pair tag must be go-to or backup.");
    }
    if (dataset.team?.gender === "Mixed") {
      const genders = players.map(name => roster.get(name)?.gender);
      const known = genders.every(gender => gender === "Men" || gender === "Women");
      if (known && new Set(genders).size !== 2) {
        throw new Error("A Mixed pair must include one man and one woman.");
      }
    }
    const preferredCourt = pair.preferredCourt == null || pair.preferredCourt === ""
      ? null
      : String(pair.preferredCourt).trim().toUpperCase();
    if (preferredCourt && !/^D[1-9][0-9]*$/.test(preferredCourt)) {
      throw new Error("Preferred court must be a doubles court such as D1.");
    }
    return { players: [...players].sort((a, b) => a.localeCompare(b)), tag: pair.tag, preferredCourt };
  });
}

function response(teamId, stored, dataset) {
  const histories = pairHistory(dataset);
  const pairs = stored?.pairs ?? [];
  return {
    teamId,
    saved: Boolean(stored),
    pairs: pairs.map(pair => ({
      ...pair,
      ...historyFields(histories.get(pairKey(pair.players))),
      suggested: false
    })),
    suggestions: suggestTeamPairs(dataset).filter(suggestion =>
      !pairs.some(pair => pairKey(pair.players) === pairKey(suggestion.players))
    ),
    revision: stored?.revision ?? 0,
    updatedAt: stored?.updatedAt ?? null
  };
}

// Stored by dataset ID, which stays the same when a team moves between collections.
function storeId(teamId, dataset) {
  return dataset.datasetId ?? teamId;
}

export async function getTeamPairs(dataDirectory, teamId, dataset) {
  const document = await storeFor(dataDirectory).read(STORE_KEY);
  const store = document ? normalizeStore(document.value) : emptyStore();
  return response(teamId, store.teams[storeId(teamId, dataset)], dataset);
}

export async function saveTeamPairs(dataDirectory, teamId, dataset, input, { baseRevision } = {}) {
  const pairs = validatePairs(dataset, input);
  if (!Number.isInteger(baseRevision)) {
    throw new Error("Send baseRevision from the last load of these pairs.");
  }
  const id = storeId(teamId, dataset);
  try {
    const { value } = await updateDocument(storeFor(dataDirectory), STORE_KEY, current => {
      const store = normalizeStore(current);
      const previous = store.teams[id];
      if (baseRevision !== (previous?.revision ?? 0)) {
        throw new TeamPairsConflictError(response(teamId, previous, dataset));
      }
      return {
        ...store,
        teams: {
          ...store.teams,
          [id]: {
            pairs,
            revision: (previous?.revision ?? 0) + 1,
            updatedAt: new Date().toISOString()
          }
        }
      };
    }, { initial: emptyStore });
    return response(teamId, value.teams[id], dataset);
  } catch (error) {
    if (error instanceof StoreConflictError) {
      throw new TeamPairsConflictError(await getTeamPairs(dataDirectory, teamId, dataset));
    }
    throw error;
  }
}
