import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneMatchCard,
  compareCourtLine,
  createMatchCard,
  draftFromPrediction,
  emptyDraft,
  parseStoredMatchCards,
  summarizeMatchup,
  validateDraft
} from "../web/public/match-card.mjs";

test("match card drafts cover every court and prevent duplicate players", () => {
  const draft = emptyDraft();
  assert.deepEqual(Object.keys(draft), ["S1", "S2", "D1", "D2", "D3"]);
  assert.equal(validateDraft(draft).complete, false);

  const filled = draftFromPrediction({
    lines: [
      { court: "S1", players: ["One"] },
      { court: "S2", players: ["Two"] },
      { court: "D1", players: ["Three", "Four"] },
      { court: "D2", players: ["Five", "Six"] },
      { court: "D3", players: ["Seven", "One"] }
    ]
  });
  const validation = validateDraft(filled, new Set([
    "One", "Two", "Three", "Four", "Five", "Six", "Seven"
  ]));
  assert.equal(validation.complete, true);
  assert.deepEqual(validation.duplicateNames, ["One"]);
  assert.equal(validation.valid, false);
});

test("match cards create and clone independent local drafts", () => {
  const card = createMatchCard({
    id: "card-1",
    title: "",
    date: "2026-10-01",
    ourTeamId: "ours",
    opponentTeamId: "theirs",
    now: "2026-08-14T00:00:00.000Z"
  });
  card.draft.S1[0] = "Player One";
  const copy = cloneMatchCard(card, {
    id: "card-2",
    now: "2026-08-15T00:00:00.000Z"
  });
  copy.draft.S1[0] = "Player Two";

  assert.equal(card.title, "Match Day Card");
  assert.equal(card.draftInitialized, false);
  assert.equal(card.draft.S1[0], "Player One");
  assert.equal(copy.title, "Match Day Card copy");
  assert.equal(copy.draft.S1[0], "Player Two");
});

test("court comparisons report rating edges without inventing missing UTR", () => {
  const comparison = compareCourtLine({
    court: "D1",
    ourPlayers: ["A", "B"],
    opponentPlayers: ["C", "D"],
    ourRoster: [
      { name: "A", dr: 3.2, utr: { doubles: { value: 3.4 } } },
      { name: "B", dr: 3.1, utr: { doubles: { value: 3.3 } } }
    ],
    opponentRoster: [
      { name: "C", dr: 3.0, utr: { doubles: { value: null, display: "3.xx" } } },
      { name: "D", dr: 3.0, utr: { doubles: { value: null, display: "3.xx" } } }
    ]
  });

  assert.equal(comparison.ours.dr, 3.15);
  assert.equal(comparison.opponent.dr, 3);
  assert.equal(comparison.margins.utr, null);
  assert.equal(comparison.edge, "favorable");
  assert.equal(comparison.confidence, "medium");
});

test("matchup summary distinguishes favorable and balanced cards", () => {
  assert.match(summarizeMatchup([
    { edge: "favorable" },
    { edge: "favorable" },
    { edge: "favorable" },
    { edge: "swing" },
    { edge: "challenging" }
  ]).read, /advantage/);
  assert.match(summarizeMatchup([
    { edge: "favorable" },
    { edge: "swing" },
    { edge: "swing" },
    { edge: "challenging" },
    { edge: "limited" }
  ]).read, /balanced/);
});

test("stored match cards reject invalid JSON shapes", () => {
  assert.deepEqual(parseStoredMatchCards(null), []);
  assert.throws(() => parseStoredMatchCards("{}"), /must be an array/);
  const cards = parseStoredMatchCards(JSON.stringify([
    {
      id: "one",
      ourTeamId: "ours",
      opponentTeamId: "theirs",
      draft: { S1: ["Player One"], D1: ["Player Two", 7] }
    },
    { id: 2 }
  ]));
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].draft.S1, ["Player One"]);
  assert.deepEqual(cards[0].draft.S2, [""]);
  assert.deepEqual(cards[0].draft.D1, ["Player Two", ""]);
  assert.equal(cards[0].draftInitialized, true);
});
