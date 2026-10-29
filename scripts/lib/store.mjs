import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { writeJsonAtomic } from "./io.mjs";

// JSON documents by key, each read with an ETag. Keys are slash-separated
// paths, so the file-system store keeps today's data/ layout and a Blob
// Storage store can use the same keys as blob names.

export const DEFAULT_WORKSPACE_ID = "default";

const KEY_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export class StoreConflictError extends Error {
  constructor(key) {
    super(`${key} was changed by someone else. Reload and try again.`);
    this.name = "StoreConflictError";
    this.key = key;
  }
}

function validKey(key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key) ||
      key.split("/").some(part => part === "." || part === "..")) {
    throw new Error(`Invalid store key: ${key}`);
  }
  return key;
}

/** The default workspace keeps today's file names at the top level. */
export function workspaceKey(workspaceId, name) {
  return workspaceId === DEFAULT_WORKSPACE_ID
    ? validKey(name)
    : validKey(`workspaces/${workspaceId}/${name}`);
}

function etagOf(content) {
  return `"${createHash("sha256").update(content).digest("hex").slice(0, 32)}"`;
}

/**
 * Writes take `ifMatch`: omitted writes unconditionally, null requires that
 * the document does not exist yet, and an ETag requires that it is unchanged.
 */
export function createFileStore(rootDirectory) {
  const root = resolve(rootDirectory);
  const queues = new Map();

  function pathFor(key) {
    const path = resolve(root, ...validKey(key).split("/"));
    if (!path.startsWith(root + sep)) throw new Error(`Invalid store key: ${key}`);
    return path;
  }

  async function readRaw(key) {
    try {
      return await readFile(pathFor(key), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  // Check-then-write is atomic within this process; one server instance owns
  // the folder.
  function serialized(key, operation) {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const settled = next.then(() => undefined, () => undefined);
    queues.set(key, settled);
    settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return next;
  }

  async function checkMatch(key, ifMatch) {
    if (ifMatch === undefined) return;
    const content = await readRaw(key);
    const current = content == null ? null : etagOf(content);
    if (current !== ifMatch) throw new StoreConflictError(key);
  }

  return {
    async read(key) {
      const content = await readRaw(key);
      if (content == null) return null;
      return { value: JSON.parse(content), etag: etagOf(content) };
    },

    write(key, value, { ifMatch } = {}) {
      return serialized(key, async () => {
        await checkMatch(key, ifMatch);
        const path = pathFor(key);
        await writeJsonAtomic(path, value);
        return etagOf(await readFile(path, "utf8"));
      });
    },

    delete(key, { ifMatch } = {}) {
      return serialized(key, async () => {
        await checkMatch(key, ifMatch);
        await rm(pathFor(key), { force: true });
      });
    },

    /** Keys of the documents directly inside a folder key. */
    async list(prefix) {
      try {
        const entries = await readdir(pathFor(prefix), { withFileTypes: true });
        return entries
          .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
          .map(entry => `${prefix}/${entry.name}`)
          .sort();
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    }
  };
}

const stores = new Map();

/** The store for a data folder; the same object for every caller. */
export function storeFor(dataDirectory) {
  const root = resolve(dataDirectory);
  if (!stores.has(root)) stores.set(root, createFileStore(root));
  return stores.get(root);
}

/**
 * Read-modify-write that retries when another writer got there first.
 * `update` receives the current value (or `initial()`) and returns the next.
 */
export async function updateDocument(store, key, update, { initial, attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const current = await store.read(key);
    const value = await update(current ? current.value : initial?.());
    try {
      const etag = await store.write(key, value, { ifMatch: current?.etag ?? null });
      return { value, etag };
    } catch (error) {
      if (!(error instanceof StoreConflictError) || attempt >= attempts) throw error;
    }
  }
}
