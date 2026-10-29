import { normalizeTeamWorkspace } from "../../web/public/team-workspace.mjs";
import {
  DEFAULT_WORKSPACE_ID,
  StoreConflictError,
  storeFor,
  updateDocument,
  workspaceKey
} from "./store.mjs";

// Our team and scheduled opponents for each season, shared by the web app
// and the phone. Every other gathered team in a season is in the scouting
// pool. Each season carries a revision so a stale client cannot overwrite a
// newer choice.

const STORE_KEY = workspaceKey(DEFAULT_WORKSPACE_ID, "team-roles.json");

export class TeamRolesConflictError extends Error {
  constructor(current) {
    super("Team roles were changed on another device. Reload and try again.");
    this.name = "TeamRolesConflictError";
    this.current = current;
  }
}

function emptyStore() {
  return { version: 1, seasons: {} };
}

function normalizeStore(value) {
  if (!value || value.version !== 1 || !value.seasons ||
      typeof value.seasons !== "object" || Array.isArray(value.seasons)) {
    throw new Error("Team roles file is invalid.");
  }
  return value;
}

function seasonRoles(collectionId, stored) {
  return {
    collectionId,
    saved: Boolean(stored),
    ourTeamId: stored?.ourTeamId ?? null,
    scheduledOpponentIds: stored?.scheduledOpponentIds ?? [],
    revision: stored?.revision ?? 0,
    updatedAt: stored?.updatedAt ?? null
  };
}

export async function getTeamRoles(dataDirectory, collectionId) {
  const document = await storeFor(dataDirectory).read(STORE_KEY);
  const store = document ? normalizeStore(document.value) : emptyStore();
  return seasonRoles(collectionId, store.seasons[collectionId]);
}

/**
 * Saves a season's roles. `teamIds` are the catalog IDs of the season's teams;
 * roles may only name those. With `baseRevision`, the save is refused when
 * someone saved a newer revision first.
 */
export async function saveTeamRoles(dataDirectory, collectionId, input, { teamIds, baseRevision } = {}) {
  const roles = normalizeTeamWorkspace(input);
  const allowed = new Set(teamIds);
  for (const teamId of [roles.ourTeamId, ...roles.scheduledOpponentIds]) {
    if (teamId && !allowed.has(teamId)) {
      throw new Error("Team roles can only name teams in this season.");
    }
  }
  try {
    const { value } = await updateDocument(storeFor(dataDirectory), STORE_KEY, current => {
      const store = normalizeStore(current);
      const previous = store.seasons[collectionId];
      if (baseRevision != null && baseRevision !== (previous?.revision ?? 0)) {
        throw new TeamRolesConflictError(seasonRoles(collectionId, previous));
      }
      return {
        ...store,
        seasons: {
          ...store.seasons,
          [collectionId]: {
            ...roles,
            revision: (previous?.revision ?? 0) + 1,
            updatedAt: new Date().toISOString()
          }
        }
      };
    }, { initial: emptyStore });
    return seasonRoles(collectionId, value.seasons[collectionId]);
  } catch (error) {
    if (error instanceof StoreConflictError) {
      throw new TeamRolesConflictError(await getTeamRoles(dataDirectory, collectionId));
    }
    throw error;
  }
}

/** Drops a deleted season's roles. */
export async function deleteTeamRoles(dataDirectory, collectionId) {
  const store = storeFor(dataDirectory);
  if (!(await store.read(STORE_KEY))) return;
  await updateDocument(store, STORE_KEY, current => {
    const next = normalizeStore(current);
    const { [collectionId]: _removed, ...seasons } = next.seasons;
    return { ...next, seasons };
  }, { initial: emptyStore });
}
