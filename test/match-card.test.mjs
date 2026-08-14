import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOnsitePredictions,
  cloneMatchCard,
  compareCourtLine,
  confirmedOnsitePlayers,
  createMatchCard,
  createTournamentEvidence,
  draftFromPrediction,
  emptyDraft,
  extractLineupFromText,
  matchRosterNames,
  parseStoredMatchCards,
  parseStoredTournamentEvidence,
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

test("tournament evidence normalizes reviewed onsite players and lineups", () => {
  const evidence = createTournamentEvidence({
    id: "evidence-1",
    collectionId: "nationals",
    opponentTeamId: "opponent",
    sourceName: "round-1.png",
    imageDataUrl: "data:image/jpeg;base64,abc",
    matchDate: "2026-08-14",
    observedPlayers: [" Player One ", "Player Two", "Player One"],
    lines: {
      S1: ["Player One"],
      S2: ["Player Two"],
      D1: ["Player Three", "Player Four"]
    },
    extractionMethod: "browser-ocr",
    now: "2026-08-14T12:00:00.000Z"
  });

  assert.deepEqual(evidence.observedPlayers, [
    "Player One", "Player Two", "Player Three", "Player Four"
  ]);
  assert.deepEqual(evidence.lines.S1, ["Player One"]);
  assert.deepEqual(evidence.lines.D2, ["", ""]);
  assert.equal(evidence.extractionMethod, "browser-ocr");

  const parsed = parseStoredTournamentEvidence(JSON.stringify([
    evidence,
    { id: 2, collectionId: "nationals" }
  ]));
  assert.equal(parsed.length, 1);
  assert.deepEqual(
    [...confirmedOnsitePlayers(parsed, "nationals", "opponent")],
    ["Player One", "Player Two", "Player Three", "Player Four"]
  );
});

test("OCR roster matching tolerates case and whitespace without fuzzy identity guesses", () => {
  assert.deepEqual(
    matchRosterNames(
      "S1  ALEX\nPLAYER def. Casey Rival\nD1 Morgan   Lee / Taylor Wu",
      ["Alex Player", "Casey Rival", "Morgan Lee", "Taylor Wu", "Ali Player"]
    ),
    ["Alex Player", "Casey Rival", "Morgan Lee", "Taylor Wu"]
  );
});

test("OCR lineup extraction assigns detected roster names to labeled courts", () => {
  assert.deepEqual(
    extractLineupFromText(
      "S1 Alex Player def Rival\nS2 Casey Rival\nD1 Morgan Lee / Taylor Wu\nD2 Pat Kim + Sam Fox",
      ["Alex Player", "Casey Rival", "Morgan Lee", "Taylor Wu", "Pat Kim", "Sam Fox"]
    ),
    {
      S1: ["Alex Player"],
      S2: ["Casey Rival"],
      D1: ["Morgan Lee", "Taylor Wu"],
      D2: ["Pat Kim", "Sam Fox"],
      D3: ["", ""]
    }
  );
});

test("onsite evidence adds reviewed lineups and weights historical scenarios without filtering them", () => {
  const predictions = [
    {
      rank: 1,
      historicalSupport: 45,
      lines: [
        { court: "S1", players: ["Unseen One"] },
        { court: "S2", players: ["Unseen Two"] },
        { court: "D1", players: ["Unseen Three", "Unseen Four"] },
        { court: "D2", players: ["Onsite One", "Onsite Two"] },
        { court: "D3", players: ["Unseen Five", "Unseen Six"] }
      ]
    },
    {
      rank: 2,
      historicalSupport: 30,
      lines: [
        { court: "S1", players: ["Onsite One"] },
        { court: "S2", players: ["Onsite Two"] },
        { court: "D1", players: ["Onsite Three", "Onsite Four"] },
        { court: "D2", players: ["Onsite Five", "Onsite Six"] },
        { court: "D3", players: ["Onsite Seven", "Onsite Eight"] }
      ]
    }
  ];
  const reviewedLineup = createTournamentEvidence({
    id: "evidence-1",
    collectionId: "nationals",
    opponentTeamId: "opponent",
    sourceName: "result.png",
    matchDate: "2026-08-14",
    observedPlayers: [
      "Onsite One", "Onsite Two", "Onsite Three", "Onsite Four",
      "Onsite Five", "Onsite Six", "Onsite Seven", "Onsite Eight"
    ],
    lines: {
      S1: ["Onsite One"],
      S2: ["Onsite Two"],
      D1: ["Onsite Three", "Onsite Four"],
      D2: ["Onsite Five", "Onsite Six"],
      D3: ["Onsite Seven", "Onsite Eight"]
    }
  });

  const ranked = buildOnsitePredictions(predictions, [reviewedLineup]);
  assert.equal(ranked[0].source, "tournament");
  assert.equal(ranked[0].evidenceDate, "2026-08-14");
  assert.equal(ranked[0].onsiteConfirmed, 8);
  assert.equal(ranked[1].source, "historical");
  assert.equal(ranked[1].historicalRank, 1);
  assert.equal(ranked[1].onsiteConfirmed, 2);
  assert.equal(ranked.length, 2);
});

test("onsite predictions deduplicate doubles pairs regardless of player order", () => {
  const evidence = createTournamentEvidence({
    id: "evidence-1",
    collectionId: "nationals",
    opponentTeamId: "opponent",
    sourceName: "result.png",
    observedPlayers: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"],
    lines: {
      S1: ["One"],
      S2: ["Two"],
      D1: ["Four", "Three"],
      D2: ["Six", "Five"],
      D3: ["Eight", "Seven"]
    }
  });
  const predictions = [{
    rank: 1,
    historicalSupport: 40,
    lines: [
      { court: "S1", players: ["One"] },
      { court: "S2", players: ["Two"] },
      { court: "D1", players: ["Three", "Four"] },
      { court: "D2", players: ["Five", "Six"] },
      { court: "D3", players: ["Seven", "Eight"] }
    ]
  }];

  assert.equal(buildOnsitePredictions(predictions, [evidence]).length, 1);
});
