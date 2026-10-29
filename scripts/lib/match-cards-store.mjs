import { DEFAULT_WORKSPACE_ID, storeFor, workspaceKey } from "./store.mjs";

const STORE_KEY = workspaceKey(DEFAULT_WORKSPACE_ID, "match-cards.json");
let writeQueue = Promise.resolve();

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
  const document = await storeFor(dataDirectory).read(STORE_KEY);
  if (!document) return [];
  const store = document.value;
  if (!store || store.version !== 1) {
    throw new Error("Match cards file is invalid.");
  }
  return validCards(store.cards);
}

export function writeMatchCards(dataDirectory, cards) {
  const validated = validCards(cards);
  const operation = async () => {
    await storeFor(dataDirectory).write(STORE_KEY, {
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
