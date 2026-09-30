import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOnsitePredictions,
  buildMatchupReadiness,
  challengeLineupAgainstPredictions,
  cloneMatchCard,
  compareCourtLine,
  confirmedOnsitePlayers,
  createMatchCard,
  createTournamentEvidence,
  draftFromPrediction,
  emptyDraft,
  extractLineupFromText,
  explainLineupPrediction,
  initializeBlankDraft,
  matchRosterNames,
  migrateMatchCardLeagueFormat,
  migrateLegacyMatchCards,
  mergeMatchCards,
  normalizeMatchCardEligibilityScope,
  orderScheduledMatches,
  parseStoredMatchCards,
  parseStoredTournamentEvidence,
  resolveScheduledOpponent,
  summarizeMatchup,
  summarizeRosterUsage,
  summarizeStackingStrategy,
  validateCardFinalization,
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

test("mixed match cards use three doubles courts and six players", () => {
  const card = createMatchCard({
    id: "mixed-card",
    ourTeamId: "ours",
    opponentTeamId: "theirs",
    leagueFormat: "mixed"
  });
  assert.deepEqual(Object.keys(card.draft), ["D1", "D2", "D3"]);
  assert.equal(
    validateDraft(card.draft, null, card.leagueFormat).requiredPlayers,
    6
  );
  assert.deepEqual(
    extractLineupFromText(
      "S1 Ignore Singles D1 Man One / Woman One D2 Man Two / Woman Two",
      ["Ignore Singles", "Man One", "Woman One", "Man Two", "Woman Two"],
      "mixed"
    ),
    {
      D1: ["Man One", "Woman One"],
      D2: ["Man Two", "Woman Two"],
      D3: ["", ""]
    }
  );
});

test("legacy cards migrate to mixed doubles courts without singles", () => {
  const card = createMatchCard({
    id: "legacy-mixed",
    ourTeamId: "ours",
    opponentTeamId: "theirs"
  });
  card.draft.S1[0] = "Singles Player";
  card.draft.D1 = ["Partner One", "Partner Two"];
  card.status = "final";

  const migrated = migrateMatchCardLeagueFormat(card, "mixed");
  assert.equal(migrated.changed, true);
  assert.equal(migrated.card.leagueFormat, "mixed");
  assert.deepEqual(Object.keys(migrated.card.draft), ["D1", "D2", "D3"]);
  assert.deepEqual(migrated.card.draft.D1, ["Partner One", "Partner Two"]);
  assert.equal(migrated.card.status, "draft");
});

test("match cards create and clone independent local drafts", () => {
  const card = createMatchCard({
    id: "card-1",
    title: "",
    date: "2026-10-01",
    ourTeamId: "ours",
    opponentTeamId: "theirs",
    eligibilityScope: "sectional",
    now: "2026-08-14T00:00:00.000Z"
  });
  card.draft.S1[0] = "Player One";
  const copy = cloneMatchCard(card, {
    id: "card-2",
    now: "2026-08-15T00:00:00.000Z"
  });
  copy.draft.S1[0] = "Player Two";

  assert.equal(card.title, "Match Day Card");
  assert.equal(card.status, "not_started");
  assert.equal(card.eligibilityScope, "sectional");
  assert.equal(card.draftInitialized, false);
  assert.equal(card.draft.S1[0], "Player One");
  assert.equal(copy.title, "Match Day Card copy");
  assert.equal(copy.eligibilityScope, "sectional");
  assert.equal(copy.draft.S1[0], "Player Two");
});

test("new and untouched auto-filled cards initialize to Choose player", () => {
  const fresh = createMatchCard({
    id: "fresh",
    ourTeamId: "ours",
    opponentTeamId: "theirs",
    leagueFormat: "mixed"
  });
  const initializedFresh = initializeBlankDraft(fresh);
  assert.equal(initializedFresh.changed, true);
  assert.deepEqual(initializedFresh.card.draft, {
    D1: ["", ""],
    D2: ["", ""],
    D3: ["", ""]
  });

  const legacyAutoFilled = {
    ...initializedFresh.card,
    status: "not_started",
    draft: {
      D1: ["One", "Two"],
      D2: ["Three", "Four"],
      D3: ["Five", "Six"]
    }
  };
  assert.equal(initializeBlankDraft(legacyAutoFilled).card.draft.D1[0], "");

  const savedDraft = { ...legacyAutoFilled, status: "draft" };
  assert.equal(initializeBlankDraft(savedDraft).changed, false);
  assert.equal(initializeBlankDraft(savedDraft).card.draft.D1[0], "One");
});

test("finalization requires a complete non-duplicate lineup", () => {
  const card = createMatchCard({
    id: "finalize",
    ourTeamId: "ours",
    opponentTeamId: "theirs",
    leagueFormat: "mixed"
  });
  assert.equal(validateCardFinalization(card).allowed, false);
  card.draft = {
    D1: ["One", "Two"],
    D2: ["Three", "Four"],
    D3: ["Five", "Six"]
  };
  assert.equal(validateCardFinalization(card).allowed, true);
  card.draft.D3[1] = "One";
  assert.match(validateCardFinalization(card).message, /duplicate/);
});

test("match card eligibility defaults safely and rejects unsupported targets", () => {
  assert.equal(normalizeMatchCardEligibilityScope(), "national");
  assert.equal(normalizeMatchCardEligibilityScope("local"), "local");
  assert.throws(
    () => normalizeMatchCardEligibilityScope("regional"),
    /National, Sectional, or Local/
  );
});

test("matchup readiness reports freshness, identity, eligibility, and scenarios", () => {
  const readiness = buildMatchupReadiness({
    ourData: {
      generatedAt: "2026-09-29T12:00:00.000Z",
      team: { name: "Our Team" },
      roster: [{ name: "One" }, { name: "Two" }],
      dataQuality: {
        unresolvedIdentities: [{ name: "Player One" }],
        unresolvedWtnIdentities: [{ name: "Player One" }]
      }
    },
    opponentData: {
      generatedAt: "2026-09-01T12:00:00.000Z",
      team: { name: "Opponent" },
      roster: [{ name: "Three" }],
      dataQuality: {}
    },
    ourAnalysis: {
      eligibility: { summary: { eligible: 2, rosterSize: 2 } },
      lineupPredictions: { predictions: [{ rank: 1 }] }
    },
    opponentAnalysis: {
      eligibility: { summary: { eligible: 0, rosterSize: 1 } },
      lineupPredictions: { predictions: [] }
    },
    now: new Date("2026-09-30T12:00:00.000Z")
  });

  assert.equal(readiness.teams[0].freshnessStatus, "current");
  assert.equal(readiness.teams[0].unresolvedIdentities, 1);
  assert.equal(readiness.teams[0].eligiblePlayers, 2);
  assert.equal(readiness.teams[0].lineupScenarios, 1);
  assert.equal(readiness.teams[1].freshnessStatus, "stale");
  assert.equal(readiness.teams[1].needsAttention, true);
});

test("scheduled opponents resolve only by stable URL or one exact name", () => {
  const teams = [
    {
      id: "opponent-a",
      sourceUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=A&year=2027",
      team: { name: "Opponent A" }
    },
    {
      id: "opponent-b",
      sourceUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=B&year=2027",
      team: { name: "Opponent B" }
    }
  ];
  assert.equal(resolveScheduledOpponent({
    sourceOpponentName: "Different text",
    sourceOpponentUrl:
      "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2027&teamname=A"
  }, teams).id, "opponent-a");
  assert.equal(resolveScheduledOpponent({
    sourceOpponentName: "Opponent B"
  }, teams).id, "opponent-b");
  assert.equal(resolveScheduledOpponent({
    sourceOpponentName: "Unknown"
  }, teams), null);
});

test("scheduled matches order upcoming before completed and cancelled", () => {
  assert.deepEqual(orderScheduledMatches([
    { id: "cancelled", date: "2026-10-01", status: "cancelled" },
    { id: "future-2", date: "2026-10-10", status: "scheduled" },
    { id: "completed", date: "2026-09-01", status: "completed" },
    { id: "future-1", date: "2026-10-02", status: "scheduled" }
  ]).map(match => match.id), [
    "future-1",
    "future-2",
    "completed",
    "cancelled"
  ]);
});

test("legacy cards migrate only when one schedule match is exact", () => {
  const team = {
    id: "opponent",
    sourceUrl: "https://example.test/opponent",
    team: { name: "Opponent" }
  };
  const card = {
    id: "legacy",
    collectionId: "event",
    ourTeamId: "ours",
    opponentTeamId: "opponent",
    date: "2026-10-01"
  };
  const match = {
    id: "scheduled",
    sourceOpponentName: "Opponent",
    sourceOpponentUrl: team.sourceUrl,
    date: "2026-10-01"
  };
  const migrated = migrateLegacyMatchCards({
    cards: [card],
    matches: [match],
    teams: [team],
    ourTeamId: "ours",
    collectionId: "event"
  });
  assert.equal(migrated.cards[0].scheduledMatchId, "scheduled");
  assert.equal(migrated.migrated, 1);

  const ambiguous = migrateLegacyMatchCards({
    cards: [card],
    matches: [match, { ...match, id: "scheduled-2" }],
    teams: [team],
    ourTeamId: "ours",
    collectionId: "event"
  });
  assert.equal(ambiguous.cards[0].scheduledMatchId, undefined);
  assert.equal(ambiguous.unresolved, 1);
});

test("server and local cards merge by latest update without data loss", () => {
  const merged = mergeMatchCards(
    [
      { id: "shared", updatedAt: "2026-09-30T12:00:00Z", notes: "local" },
      { id: "local-only", updatedAt: "2026-09-30T11:00:00Z" }
    ],
    [
      { id: "shared", updatedAt: "2026-09-30T10:00:00Z", notes: "server" },
      { id: "server-only", updatedAt: "2026-09-30T11:00:00Z" }
    ]
  );
  assert.equal(merged.length, 3);
  assert.equal(merged.find(card => card.id === "shared").notes, "local");
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
  assert.deepEqual(comparison.ours.players.map(player => player.name), ["A", "B"]);
  assert.equal(comparison.ours.players[0].dr, 3.2);
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

test("lineup challenge scores top scenarios and explains pros and risks", () => {
  const challenge = challengeLineupAgainstPredictions({
    leagueFormat: "mixed",
    draft: {
      D1: ["Our A", "Our B"],
      D2: ["Our C", "Our D"],
      D3: ["Our E", "Our F"]
    },
    predictions: [{
      rank: 1,
      confidence: "high",
      historicalSupport: 42,
      lines: [
        { court: "D1", players: ["Opp A", "Opp B"] },
        { court: "D2", players: ["Opp C", "Opp D"] },
        { court: "D3", players: ["Opp E", "Opp F"] }
      ]
    }],
    ourRoster: [
      ["Our A", 4], ["Our B", 4], ["Our C", 3], ["Our D", 3],
      ["Our E", 2], ["Our F", 2]
    ].map(([name, dr]) => ({ name, dr, utr: { doubles: { value: dr } } })),
    opponentRoster: [
      ["Opp A", 3], ["Opp B", 3], ["Opp C", 3], ["Opp D", 3],
      ["Opp E", 3], ["Opp F", 3]
    ].map(([name, dr]) => ({ name, dr, utr: { doubles: { value: dr } } }))
  });

  assert.equal(challenge.length, 1);
  assert.equal(challenge[0].summary.favorable, 1);
  assert.equal(challenge[0].summary.swing, 1);
  assert.equal(challenge[0].summary.challenging, 1);
  assert.equal(challenge[0].score, 4.5);
  assert.deepEqual(challenge[0].ratingCoverage, {
    drCourts: 3,
    utrCourts: 3,
    totalCourts: 3
  });
  assert.match(challenge[0].pros[0], /D1/);
  assert.match(challenge[0].risks.join(" "), /D3/);
});

test("stacking summary identifies stronger lower courts without overclaiming", () => {
  const summary = summarizeStackingStrategy([{
    date: "2026-09-19",
    opponentTeam: "Opponent",
    lines: [
      { court: "D1", averageDr: 3.0, targetPlayers: ["A", "B"] },
      { court: "D2", averageDr: 3.3, targetPlayers: ["C", "D"] },
      { court: "D3", averageDr: 2.8, targetPlayers: ["E", "F"] }
    ]
  }]);

  assert.equal(summary.label, "Possible lower-court stacking pattern");
  assert.equal(summary.confidence, "single-match evidence");
  assert.equal(summary.inversions[0].lowerCourt, "D2");
  assert.equal(summary.strongestCourtByDr, "D2");
  assert.equal(summary.lowerCourtStrengthMatches, 1);
  assert.equal(summary.matchesWithRatingEvidence, 1);
  assert.equal(summarizeStackingStrategy([]), null);
});

test("stacking summary identifies repeated opponent strategy across matches", () => {
  const summary = summarizeStackingStrategy([
    {
      date: "2026-09-19",
      lines: [
        { court: "D1", averageDr: 3.0 },
        { court: "D2", averageDr: 3.3 },
        { court: "D3", averageDr: 2.8 }
      ]
    },
    {
      date: "2026-09-12",
      lines: [
        { court: "D1", averageDr: 3.1 },
        { court: "D2", averageDr: 3.0 },
        { court: "D3", averageDr: 3.4 }
      ]
    },
    {
      date: "2026-09-05",
      lines: [
        { court: "D1", averageDr: 3.3 },
        { court: "D2", averageDr: 3.1 },
        { court: "D3", averageDr: 2.9 }
      ]
    }
  ]);

  assert.equal(summary.label, "Repeated lower-court strength pattern");
  assert.equal(summary.lowerCourtStrengthMatches, 2);
  assert.equal(summary.traditionalOrderMatches, 1);
  assert.equal(summary.matchesWithRatingEvidence, 3);
  assert.equal(summary.confidence, "established");
});

test("roster usage distinguishes played players from unused roster players", () => {
  const usage = summarizeRosterUsage(
    [{ name: "Played" }, { name: "Unused" }],
    [{
      id: "match-1",
      courts: {
        D1: { targetPlayers: ["Played"] },
        D2: { targetPlayers: ["Played"] }
      }
    }]
  );

  assert.deepEqual(usage, [
    {
      name: "Played",
      appearances: 1,
      courts: ["D1", "D2"],
      playedBefore: true
    },
    {
      name: "Unused",
      appearances: 0,
      courts: [],
      playedBefore: false
    }
  ]);
});

test("lineup rationale explains evidence ranking without calling it strongest", () => {
  const rationale = explainLineupPrediction({
    historicalSupport: 42,
    observedTogether: 1,
    evidence: {
      totalCourtAppearances: 6,
      postseasonCourtAppearances: 0
    },
    lines: [{
      court: "D1",
      appearances: 2,
      usageShare: 0.5,
      lastUsedDate: "2026-09-19"
    }]
  });

  assert.match(rationale.summary, /not a strongest-ratings lineup/);
  assert.match(rationale.reasons.join(" "), /observed together/);
  assert.match(rationale.courts[0].reason, /50%/);
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
  assert.equal(cards[0].eligibilityScope, "national");
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
