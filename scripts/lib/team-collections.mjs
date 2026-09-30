import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "./io.mjs";

const FILE_NAME = "team-collections.json";
const writeQueues = new Map();
const TEAM_COLLECTION_LEVELS = new Set(["local", "sectional", "national"]);
const MATCH_DAY_OPPONENT_LIMIT = 4;

function collectionFile(dataDirectory) {
  return join(dataDirectory, FILE_NAME);
}

function normalizeStore(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.collections)) {
    throw new Error("Team collections file is invalid.");
  }
  return {
    version: 1,
    collections: value.collections.map(collection => {
      const teamDatasetIds = [...new Set(
        (collection.teamDatasetIds ?? []).filter(id => typeof id === "string" && id)
      )];
      return {
        id: String(collection.id),
        name: String(collection.name),
        competitionLevel: normalizeStoredCompetitionLevel(
          collection.competitionLevel,
          collection.name
        ),
        teamDatasetIds,
        ...normalizeMatchDayDefaults(collection.matchDayDefaults, teamDatasetIds),
        createdAt: collection.createdAt
      };
    })
  };
}

function normalizeMatchDayDefaults(value, teamDatasetIds) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Match Day defaults must be an object.");
  }
  const ourTeamDatasetId = value.ourTeamDatasetId;
  const opponentTeamDatasetIds = value.opponentTeamDatasetIds;
  if (typeof ourTeamDatasetId !== "string" || !ourTeamDatasetId) {
    throw new Error("Match Day defaults require Our team.");
  }
  if (!Array.isArray(opponentTeamDatasetIds)) {
    throw new Error("Match Day default opponents must be an array.");
  }
  if (
    opponentTeamDatasetIds.length > MATCH_DAY_OPPONENT_LIMIT ||
    opponentTeamDatasetIds.some(id => typeof id !== "string" || !id)
  ) {
    throw new Error(
      `Match Day defaults support up to ${MATCH_DAY_OPPONENT_LIMIT} opponents.`
    );
  }
  const uniqueOpponentIds = [...new Set(opponentTeamDatasetIds)];
  if (uniqueOpponentIds.length !== opponentTeamDatasetIds.length) {
    throw new Error("Match Day default opponents must be unique.");
  }
  if (uniqueOpponentIds.includes(ourTeamDatasetId)) {
    throw new Error("Our team cannot be a Match Day opponent.");
  }
  if (
    !teamDatasetIds.includes(ourTeamDatasetId) ||
    uniqueOpponentIds.some(id => !teamDatasetIds.includes(id))
  ) {
    throw new Error("Match Day defaults must belong to their event collection.");
  }
  const roundRobinMatches = value.roundRobinMatches ?? [];
  if (!Array.isArray(roundRobinMatches)) {
    throw new Error("Match Day round-robin matches must be an array.");
  }
  const normalizedMatches = roundRobinMatches.map(match => {
    if (
      !match ||
      typeof match !== "object" ||
      Array.isArray(match) ||
      !uniqueOpponentIds.includes(match.opponentTeamDatasetId) ||
      typeof match.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(match.date) ||
      typeof match.time !== "string" ||
      !match.time.trim() ||
      typeof match.site !== "string" ||
      !match.site.trim()
    ) {
      throw new Error("Match Day round-robin match is invalid.");
    }
    return {
      opponentTeamDatasetId: match.opponentTeamDatasetId,
      date: match.date,
      time: match.time.trim(),
      site: match.site.trim()
    };
  });
  if (
    normalizedMatches.length > MATCH_DAY_OPPONENT_LIMIT ||
    new Set(normalizedMatches.map(match => match.opponentTeamDatasetId)).size !==
      normalizedMatches.length
  ) {
    throw new Error("Match Day round-robin opponents must be unique.");
  }
  return {
    matchDayDefaults: {
      ourTeamDatasetId,
      opponentTeamDatasetIds: uniqueOpponentIds,
      roundRobinMatches: normalizedMatches
    }
  };
}

function removeMatchDayDefault(collection, datasetId) {
  if (!collection.matchDayDefaults) return;
  if (collection.matchDayDefaults.ourTeamDatasetId === datasetId) {
    delete collection.matchDayDefaults;
    return;
  }
  collection.matchDayDefaults.opponentTeamDatasetIds =
    collection.matchDayDefaults.opponentTeamDatasetIds.filter(
      id => id !== datasetId
    );
  collection.matchDayDefaults.roundRobinMatches =
    collection.matchDayDefaults.roundRobinMatches.filter(
      match => match.opponentTeamDatasetId !== datasetId
    );
}

function inferCompetitionLevel(name) {
  const normalizedName = String(name ?? "").toLowerCase();
  if (normalizedName.includes("national")) return "national";
  if (normalizedName.includes("sectional")) return "sectional";
  return "local";
}

function normalizeStoredCompetitionLevel(value, name) {
  if (value == null) return inferCompetitionLevel(name);
  return validateTeamCollectionCompetitionLevel(value);
}

async function readStore(dataDirectory) {
  try {
    return normalizeStore(JSON.parse(
      await readFile(collectionFile(dataDirectory), "utf8")
    ));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, collections: [] };
    throw error;
  }
}

function queuedWrite(dataDirectory, operation) {
  const previous = writeQueues.get(dataDirectory) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const queued = next.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (writeQueues.get(dataDirectory) === queued) {
      writeQueues.delete(dataDirectory);
    }
  });
  writeQueues.set(dataDirectory, queued);
  return next;
}

export function validateTeamCollectionName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter a collection name.");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > 80) {
    throw new Error("Collection names must be 80 characters or fewer.");
  }
  return name;
}

export function validateTeamCollectionCompetitionLevel(value) {
  if (!TEAM_COLLECTION_LEVELS.has(value)) {
    throw new Error("Choose Local season, Sectional, or National.");
  }
  return value;
}

export async function listTeamCollections(dataDirectory) {
  return (await readStore(dataDirectory)).collections;
}

export async function createTeamCollection(
  dataDirectory,
  name,
  createdAt = new Date(),
  datasetId = null,
  competitionLevel
) {
  const normalizedName = validateTeamCollectionName(name);
  const normalizedCompetitionLevel =
    validateTeamCollectionCompetitionLevel(competitionLevel);
  if (datasetId != null && (typeof datasetId !== "string" || !datasetId)) {
    throw new Error("Choose a gathered team.");
  }
  return queuedWrite(dataDirectory, async () => {
    const store = await readStore(dataDirectory);
    if (store.collections.some(collection =>
      collection.name.localeCompare(normalizedName, undefined, {
        sensitivity: "accent"
      }) === 0
    )) {
      const error = new Error("A collection with this name already exists.");
      error.statusCode = 409;
      throw error;
    }
    const collection = {
      id: randomUUID().slice(0, 8),
      name: normalizedName,
      competitionLevel: normalizedCompetitionLevel,
      teamDatasetIds: datasetId ? [datasetId] : [],
      createdAt: createdAt.toISOString()
    };
    if (datasetId) {
      for (const existing of store.collections) {
        existing.teamDatasetIds = existing.teamDatasetIds.filter(
          id => id !== datasetId
        );
      }
    }
    store.collections.push(collection);
    await writeJsonAtomic(collectionFile(dataDirectory), store);
    return collection;
  });
}

export async function deleteTeamCollection(dataDirectory, collectionId) {
  if (typeof collectionId !== "string" || !collectionId) {
    throw new Error("Choose an event collection.");
  }
  return queuedWrite(dataDirectory, async () => {
    const store = await readStore(dataDirectory);
    const index = store.collections.findIndex(
      collection => collection.id === collectionId
    );
    if (index < 0) {
      const error = new Error("Event collection not found.");
      error.statusCode = 404;
      throw error;
    }
    const [collection] = store.collections.splice(index, 1);
    await writeJsonAtomic(collectionFile(dataDirectory), store);
    return { collection, collections: store.collections };
  });
}

export async function getTeamCollection(dataDirectory, collectionId) {
  if (typeof collectionId !== "string" || !collectionId) {
    throw new Error("Choose an event collection.");
  }
  const collection = (await listTeamCollections(dataDirectory))
    .find(item => item.id === collectionId);
  if (!collection) {
    const error = new Error("Event collection not found.");
    error.statusCode = 404;
    throw error;
  }
  return collection;
}

export async function assignTeamToCollection(
  dataDirectory,
  collectionId,
  datasetId
) {
  if (typeof datasetId !== "string" || !datasetId) {
    throw new Error("Choose a gathered team.");
  }
  return queuedWrite(dataDirectory, async () => {
    const store = await readStore(dataDirectory);
    if (collectionId != null && !store.collections.some(
      collection => collection.id === collectionId
    )) {
      const error = new Error("Event collection not found.");
      error.statusCode = 404;
      throw error;
    }
    for (const collection of store.collections) {
      collection.teamDatasetIds = collection.teamDatasetIds.filter(
        id => id !== datasetId
      );
      removeMatchDayDefault(collection, datasetId);
    }
    if (collectionId != null) {
      store.collections.find(collection =>
        collection.id === collectionId
      ).teamDatasetIds.push(datasetId);
    }
    await writeJsonAtomic(collectionFile(dataDirectory), store);
    return store.collections;
  });
}
