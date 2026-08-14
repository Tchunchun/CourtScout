import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "./io.mjs";

const FILE_NAME = "team-collections.json";
const writeQueues = new Map();

function collectionFile(dataDirectory) {
  return join(dataDirectory, FILE_NAME);
}

function normalizeStore(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.collections)) {
    throw new Error("Team collections file is invalid.");
  }
  return {
    version: 1,
    collections: value.collections.map(collection => ({
      id: String(collection.id),
      name: String(collection.name),
      teamDatasetIds: [...new Set(
        (collection.teamDatasetIds ?? []).filter(id => typeof id === "string" && id)
      )],
      createdAt: collection.createdAt
    }))
  };
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

export async function listTeamCollections(dataDirectory) {
  return (await readStore(dataDirectory)).collections;
}

export async function createTeamCollection(
  dataDirectory,
  name,
  createdAt = new Date(),
  datasetId = null
) {
  const normalizedName = validateTeamCollectionName(name);
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
