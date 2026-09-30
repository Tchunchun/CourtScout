import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./io.mjs";

const FILE_NAME = "match-cards.json";
let writeQueue = Promise.resolve();

function filePath(dataDirectory) {
  return join(dataDirectory, FILE_NAME);
}

function validCards(cards) {
  if (!Array.isArray(cards)) throw new Error("Match cards must be an array.");
  for (const card of cards) {
    if (
      !card ||
      typeof card.id !== "string" ||
      typeof card.ourTeamId !== "string" ||
      typeof card.opponentTeamId !== "string"
    ) {
      throw new Error("Every Match Day Card requires an ID and both teams.");
    }
  }
  return cards;
}

export async function readMatchCards(dataDirectory) {
  try {
    const store = JSON.parse(await readFile(filePath(dataDirectory), "utf8"));
    if (!store || store.version !== 1) {
      throw new Error("Match cards file is invalid.");
    }
    return validCards(store.cards);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function writeMatchCards(dataDirectory, cards) {
  const validated = validCards(cards);
  const operation = async () => {
    await writeJsonAtomic(filePath(dataDirectory), {
      version: 1,
      cards: validated,
      updatedAt: new Date().toISOString()
    });
    return validated;
  };
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}
