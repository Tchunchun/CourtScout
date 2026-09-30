import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./io.mjs";

const FILE_NAME = "event-schedules.json";
const EVENT_TYPES = new Set(["local", "sectionals", "nationals", "other"]);
const ELIGIBILITY_SCOPES = new Set(["local", "sectional", "national"]);
const MATCH_STATUSES = new Set([
  "scheduled",
  "postponed",
  "completed",
  "cancelled"
]);
const DESIGNATIONS = new Set(["home", "away", "neutral", "unknown"]);
const writeQueues = new Map();

function storeFile(dataDirectory) {
  return join(dataDirectory, FILE_NAME);
}

function emptyStore() {
  return { version: 1, schedules: [] };
}

function normalizeStore(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.schedules)) {
    throw new Error("Event schedules file is invalid.");
  }
  return value;
}

async function readStore(dataDirectory) {
  try {
    return normalizeStore(JSON.parse(
      await readFile(storeFile(dataDirectory), "utf8")
    ));
  } catch (error) {
    if (error.code === "ENOENT") return emptyStore();
    throw error;
  }
}

function queuedWrite(dataDirectory, operation) {
  const previous = writeQueues.get(dataDirectory) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const settled = next.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (writeQueues.get(dataDirectory) === settled) {
      writeQueues.delete(dataDirectory);
    }
  });
  writeQueues.set(dataDirectory, settled);
  return next;
}

function optionalText(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function validDate(value) {
  return value == null || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stableImportedMatchId(collectionId, match) {
  const signature = [
    collectionId,
    match.date ?? "",
    match.time ?? "",
    match.round ?? "",
    match.sourceOpponentName.toLocaleLowerCase()
  ].join("|");
  return `import:${createHash("sha256").update(signature).digest("hex").slice(0, 16)}`;
}

export function defaultEligibilityScope(eventType) {
  if (eventType === "sectionals") return "sectional";
  if (eventType === "nationals") return "national";
  return "local";
}

export function normalizeScheduledMatch(match, collectionId) {
  const sourceOpponentName = optionalText(
    match.sourceOpponentName ?? match.opponent
  );
  if (!sourceOpponentName) {
    throw new Error("Each schedule row requires an opponent.");
  }
  const date = optionalText(match.date);
  if (!validDate(date)) {
    throw new Error(`Schedule date for ${sourceOpponentName} must use YYYY-MM-DD.`);
  }
  const status = MATCH_STATUSES.has(match.status)
    ? match.status
    : "scheduled";
  const designation = DESIGNATIONS.has(match.designation)
    ? match.designation
    : "unknown";
  const normalized = {
    id: optionalText(match.id),
    sourceOpponentName,
    sourceOpponentUrl: optionalText(match.sourceOpponentUrl),
    linkedOpponentTeamId: optionalText(match.linkedOpponentTeamId),
    date,
    time: optionalText(match.time),
    timezone: optionalText(match.timezone),
    round: optionalText(match.round),
    site: optionalText(match.site ?? match.location),
    designation,
    status,
    sourceType: optionalText(match.sourceType) ?? "manual",
    sourceReference: optionalText(match.sourceReference),
    sourceMatchId: optionalText(match.sourceMatchId),
    sourceResult: optionalText(match.sourceResult),
    sourceRetrievedAt: optionalText(match.sourceRetrievedAt),
    updatedAt: optionalText(match.updatedAt)
  };
  normalized.id ??= normalized.sourceMatchId
    ? `${normalized.sourceType}:${normalized.sourceMatchId}`
    : stableImportedMatchId(collectionId, normalized);
  return normalized;
}

function comparableMatch(match) {
  const {
    updatedAt,
    sourceRetrievedAt,
    ...comparable
  } = match;
  return comparable;
}

export function reconcileEventSchedule(currentMatches, proposedMatches) {
  const currentById = new Map(currentMatches.map(match => [match.id, match]));
  const proposedById = new Map(proposedMatches.map(match => [match.id, match]));
  const rows = proposedMatches.map(match => {
    const current = currentById.get(match.id);
    if (!current) return { change: "added", current: null, proposed: match };
    return {
      change: JSON.stringify(comparableMatch(current)) ===
        JSON.stringify(comparableMatch(match))
        ? "unchanged"
        : "changed",
      current,
      proposed: match
    };
  });
  for (const current of currentMatches) {
    if (!proposedById.has(current.id)) {
      rows.push({ change: "removed", current, proposed: null });
    }
  }
  return rows;
}

export async function getEventSchedule(dataDirectory, collectionId) {
  const schedule = (await readStore(dataDirectory)).schedules.find(
    item => item.collectionId === collectionId
  );
  return schedule ?? null;
}

export async function deleteEventSchedule(dataDirectory, collectionId) {
  return queuedWrite(dataDirectory, async () => {
    const store = await readStore(dataDirectory);
    const before = store.schedules.length;
    store.schedules = store.schedules.filter(
      item => item.collectionId !== collectionId
    );
    if (store.schedules.length !== before) {
      await writeJsonAtomic(storeFile(dataDirectory), store);
    }
  });
}

export async function confirmEventSchedule(dataDirectory, input) {
  if (typeof input.collectionId !== "string" || !input.collectionId) {
    throw new Error("Choose an event collection.");
  }
  if (typeof input.ourTeamId !== "string" || !input.ourTeamId) {
    throw new Error("Assign Our team before confirming a schedule.");
  }
  if (!EVENT_TYPES.has(input.eventType)) {
    throw new Error("Choose Local, Sectionals, Nationals, or Other.");
  }
  const eligibilityScope = input.eligibilityScope ??
    defaultEligibilityScope(input.eventType);
  if (!ELIGIBILITY_SCOPES.has(eligibilityScope)) {
    throw new Error("Choose a Local, Sectional, or National eligibility target.");
  }
  if (!Array.isArray(input.matches)) {
    throw new Error("Schedule matches must be an array.");
  }

  return queuedWrite(dataDirectory, async () => {
    const store = await readStore(dataDirectory);
    const existingIndex = store.schedules.findIndex(
      item => item.collectionId === input.collectionId
    );
    const existing = existingIndex >= 0
      ? store.schedules[existingIndex]
      : null;
    const now = new Date().toISOString();
    const proposed = input.matches.map(match =>
      normalizeScheduledMatch(match, input.collectionId)
    );
    const reconciliation = reconcileEventSchedule(
      existing?.matches ?? [],
      proposed
    );
    const removed = reconciliation
      .filter(row => row.change === "removed")
      .map(row => ({
        ...row.current,
        status: "cancelled",
        removedFromSource: true,
        updatedAt: now
      }));
    const schedule = {
      collectionId: input.collectionId,
      ourTeamId: input.ourTeamId,
      eventType: input.eventType,
      eligibilityScope,
      timezone: optionalText(input.timezone),
      source: {
        type: optionalText(input.source?.type) ?? "manual",
        reference: optionalText(input.source?.reference),
        fileName: optionalText(input.source?.fileName),
        importedAt: optionalText(input.source?.importedAt) ?? now
      },
      matches: [...proposed.map(match => ({
        ...match,
        sourceRetrievedAt: match.sourceRetrievedAt ?? now,
        updatedAt: now
      })), ...removed],
      lastSuccessfulSyncAt: now,
      updatedAt: now
    };
    if (existingIndex >= 0) store.schedules[existingIndex] = schedule;
    else store.schedules.push(schedule);
    await writeJsonAtomic(storeFile(dataDirectory), store);
    return { schedule, reconciliation };
  });
}

export async function linkScheduledOpponent(
  dataDirectory,
  collectionId,
  matchId,
  teamId
) {
  return queuedWrite(dataDirectory, async () => {
    const store = await readStore(dataDirectory);
    const schedule = store.schedules.find(
      item => item.collectionId === collectionId
    );
    if (!schedule) {
      const error = new Error("Confirmed event schedule not found.");
      error.statusCode = 404;
      throw error;
    }
    const match = schedule.matches.find(item => item.id === matchId);
    if (!match) {
      const error = new Error("Scheduled match not found.");
      error.statusCode = 404;
      throw error;
    }
    match.linkedOpponentTeamId = teamId || null;
    match.updatedAt = new Date().toISOString();
    schedule.updatedAt = match.updatedAt;
    await writeJsonAtomic(storeFile(dataDirectory), store);
    return schedule;
  });
}
