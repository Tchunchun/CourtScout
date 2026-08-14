export const MATCH_CARD_COURTS = Object.freeze([
  Object.freeze({ court: "S1", discipline: "singles", players: 1 }),
  Object.freeze({ court: "S2", discipline: "singles", players: 1 }),
  Object.freeze({ court: "D1", discipline: "doubles", players: 2 }),
  Object.freeze({ court: "D2", discipline: "doubles", players: 2 }),
  Object.freeze({ court: "D3", discipline: "doubles", players: 2 })
]);

function ratingValue(rating) {
  if (Number.isFinite(rating?.exactValue)) return rating.exactValue;
  return Number.isFinite(rating?.value) ? rating.value : null;
}

function average(values) {
  return values.length && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function emptyDraft() {
  return Object.fromEntries(
    MATCH_CARD_COURTS.map(({ court, players }) => [
      court,
      Array.from({ length: players }, () => "")
    ])
  );
}

export function draftFromPrediction(prediction) {
  const draft = emptyDraft();
  for (const line of prediction?.lines ?? []) {
    if (draft[line.court]) {
      draft[line.court] = line.players.slice(0, draft[line.court].length);
    }
  }
  return draft;
}

export function validateDraft(draft, eligibleNames = null) {
  const selected = MATCH_CARD_COURTS.flatMap(({ court }) => draft[court] ?? [])
    .filter(Boolean);
  const duplicateNames = [...new Set(
    selected.filter((name, index) => selected.indexOf(name) !== index)
  )];
  const unavailableNames = eligibleNames
    ? [...new Set(selected.filter(name => !eligibleNames.has(name)))]
    : [];
  const requiredPlayers = MATCH_CARD_COURTS.reduce(
    (sum, court) => sum + court.players,
    0
  );
  return {
    complete: selected.length === requiredPlayers,
    selectedPlayers: selected.length,
    requiredPlayers,
    duplicateNames,
    unavailableNames,
    valid: selected.length === requiredPlayers && duplicateNames.length === 0
  };
}

export function createMatchCard(input) {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    title: input.title?.trim() || "Match Day Card",
    date: input.date,
    location: input.location ?? "home",
    collectionId: input.collectionId ?? null,
    ourTeamId: input.ourTeamId,
    opponentTeamId: input.opponentTeamId,
    opponentPredictionRank: 1,
    draft: emptyDraft(),
    draftInitialized: false,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

function normalizedLines(lines = {}) {
  return Object.fromEntries(MATCH_CARD_COURTS.map(({ court, players }) => {
    const values = Array.isArray(lines[court])
      ? lines[court].slice(0, players)
      : [];
    const normalized = values.map(value =>
      typeof value === "string" ? value.trim() : ""
    );
    while (normalized.length < players) normalized.push("");
    return [court, normalized];
  }));
}

function evidencePlayers(lines) {
  return MATCH_CARD_COURTS.flatMap(({ court }) => lines[court]).filter(Boolean);
}

export function createTournamentEvidence(input) {
  if (
    typeof input?.id !== "string" ||
    typeof input.collectionId !== "string" ||
    typeof input.opponentTeamId !== "string"
  ) {
    throw new Error("Tournament evidence requires an ID, collection, and opponent.");
  }
  const lines = normalizedLines(input.lines);
  const observedPlayers = [
    ...(Array.isArray(input.observedPlayers) ? input.observedPlayers : []),
    ...evidencePlayers(lines)
  ]
    .filter(value => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean);
  return {
    id: input.id,
    collectionId: input.collectionId,
    opponentTeamId: input.opponentTeamId,
    sourceName: typeof input.sourceName === "string"
      ? input.sourceName.trim()
      : "Tournament result",
    imageDataUrl: typeof input.imageDataUrl === "string"
      ? input.imageDataUrl
      : null,
    matchDate: typeof input.matchDate === "string" ? input.matchDate : "",
    observedPlayers: [...new Set(observedPlayers)],
    lines,
    extractionMethod: input.extractionMethod === "browser-ocr"
      ? "browser-ocr"
      : "manual",
    createdAt: input.now ?? new Date().toISOString()
  };
}

export function parseStoredTournamentEvidence(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Stored tournament evidence must be an array.");
  }
  return parsed
    .filter(item =>
      item &&
      typeof item.id === "string" &&
      typeof item.collectionId === "string" &&
      typeof item.opponentTeamId === "string"
    )
    .map(item => createTournamentEvidence({
      ...item,
      now: typeof item.createdAt === "string" ? item.createdAt : undefined
    }));
}

export function confirmedOnsitePlayers(evidence, collectionId, opponentTeamId) {
  return new Set(evidence
    .filter(item =>
      item.collectionId === collectionId &&
      item.opponentTeamId === opponentTeamId
    )
    .flatMap(item => item.observedPlayers));
}

function normalizedText(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function matchRosterNames(text, rosterNames) {
  const searchable = ` ${normalizedText(text)} `;
  return rosterNames.filter(name => {
    const normalizedName = normalizedText(name);
    return normalizedName && searchable.includes(` ${normalizedName} `);
  });
}

export function extractLineupFromText(text, rosterNames) {
  const lines = normalizedLines();
  const courtPattern = /\b(S1|S2|D1|D2|D3)\b/gi;
  const matches = [...String(text ?? "").matchAll(courtPattern)];
  matches.forEach((match, index) => {
    const court = match[1].toUpperCase();
    const segment = String(text).slice(
      match.index + match[0].length,
      matches[index + 1]?.index ?? String(text).length
    );
    lines[court] = matchRosterNames(segment, rosterNames)
      .slice(0, lines[court].length);
    while (lines[court].length < (
      court.startsWith("S") ? 1 : 2
    )) {
      lines[court].push("");
    }
  });
  return lines;
}

function predictionSignature(lines) {
  return MATCH_CARD_COURTS.map(({ court }) => {
    const line = lines.find(item => item.court === court);
    return `${court}:${[...(line?.players ?? [])].sort((a, b) =>
      a.localeCompare(b)
    ).join("|")}`;
  }).join(";");
}

function predictionOnsiteDetails(prediction, onsiteNames) {
  const players = [...new Set(
    prediction.lines.flatMap(line => line.players).filter(Boolean)
  )];
  const onsiteConfirmed = players.filter(name => onsiteNames.has(name)).length;
  return {
    onsiteConfirmed,
    onsiteTotal: players.length,
    onsiteCoverage: players.length ? onsiteConfirmed / players.length : 0
  };
}

function completeEvidencePrediction(evidence, onsiteNames) {
  const validation = validateDraft(evidence.lines);
  if (!validation.valid) return null;
  const prediction = {
    confidence: "confirmed",
    historicalSupport: 0,
    observedTogether: 1,
    source: "tournament",
    evidenceId: evidence.id,
    evidenceDate: evidence.matchDate,
    lines: MATCH_CARD_COURTS.map(({ court }) => ({
      court,
      players: evidence.lines[court],
      appearances: 1,
      postseasonAppearances: 1,
      record: null,
      lastUsedDate: evidence.matchDate,
      usageShare: 1
    }))
  };
  return {
    ...prediction,
    ...predictionOnsiteDetails(prediction, onsiteNames)
  };
}

export function buildOnsitePredictions(predictions = [], evidence = []) {
  const onsiteNames = new Set(evidence.flatMap(item => item.observedPlayers));
  const evidencePredictions = evidence
    .map(item => completeEvidencePrediction(item, onsiteNames))
    .filter(Boolean)
    .sort((a, b) =>
      (b.evidenceDate ?? "").localeCompare(a.evidenceDate ?? "")
    );
  const historicalPredictions = predictions
    .map(prediction => {
      const onsite = predictionOnsiteDetails(prediction, onsiteNames);
      return {
        ...prediction,
        ...onsite,
        source: "historical",
        historicalRank: prediction.rank,
        onsiteScore:
          (Number(prediction.historicalSupport) || 0) / 100 * 0.55 +
          onsite.onsiteCoverage * 0.45
      };
    })
    .sort((a, b) =>
      b.onsiteScore - a.onsiteScore ||
      b.onsiteConfirmed - a.onsiteConfirmed ||
      a.historicalRank - b.historicalRank
    );
  const seen = new Set();
  return [...evidencePredictions, ...historicalPredictions]
    .filter(prediction => {
      const signature = predictionSignature(prediction.lines);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, 5)
    .map((prediction, index) => ({ ...prediction, rank: index + 1 }));
}

export function cloneMatchCard(card, input) {
  const now = input.now ?? new Date().toISOString();
  return {
    ...structuredClone(card),
    id: input.id,
    title: input.title ?? `${card.title} copy`,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

function playerMetrics(players, roster, discipline) {
  const byName = new Map(roster.map(player => [player.name, player]));
  const records = players.map(name => byName.get(name)).filter(Boolean);
  return {
    dr: round(average(records.map(player => player.dr))),
    utr: round(average(records.map(player => ratingValue(player.utr?.[discipline])))),
    resolvedPlayers: records.length
  };
}

export function compareCourtLine({
  court,
  ourPlayers,
  opponentPlayers,
  ourRoster,
  opponentRoster
}) {
  const discipline = court.startsWith("S") ? "singles" : "doubles";
  const ours = playerMetrics(ourPlayers, ourRoster, discipline);
  const opponent = playerMetrics(opponentPlayers, opponentRoster, discipline);
  const drMargin = Number.isFinite(ours.dr) && Number.isFinite(opponent.dr)
    ? round(ours.dr - opponent.dr)
    : null;
  const utrMargin = Number.isFinite(ours.utr) && Number.isFinite(opponent.utr)
    ? round(ours.utr - opponent.utr)
    : null;
  const signals = [
    Number.isFinite(drMargin) ? drMargin / 0.15 : null,
    Number.isFinite(utrMargin) ? utrMargin / 0.3 : null
  ].filter(Number.isFinite);
  const score = signals.length
    ? signals.reduce((sum, value) => sum + value, 0) / signals.length
    : null;
  const edge = !Number.isFinite(score)
    ? "limited"
    : score > 0.7 ? "favorable" : score < -0.7 ? "challenging" : "swing";
  const confidence = signals.length === 2 ? "high" : signals.length === 1 ? "medium" : "limited";
  return {
    court,
    discipline,
    ourPlayers,
    opponentPlayers,
    ours,
    opponent,
    margins: { dr: drMargin, utr: utrMargin },
    edge,
    confidence
  };
}

export function summarizeMatchup(comparisons) {
  const counts = {
    favorable: 0,
    swing: 0,
    challenging: 0,
    limited: 0
  };
  comparisons.forEach(item => {
    counts[item.edge] += 1;
  });
  return {
    ...counts,
    read: counts.favorable >= 3
      ? "Our draft shows an advantage on at least three courts."
      : counts.challenging >= 3
        ? "This draft carries significant risk across the card."
        : counts.limited >= 3
          ? "Rating coverage is too limited for a strong matchup read."
          : "The card is balanced; swing courts are likely to decide the match."
  };
}

export function parseStoredMatchCards(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Stored match cards must be an array.");
  return parsed
    .filter(card =>
      card &&
      typeof card.id === "string" &&
      typeof card.ourTeamId === "string" &&
      typeof card.opponentTeamId === "string" &&
      card.draft &&
      typeof card.draft === "object"
    )
    .map(card => {
      const normalizedDraft = emptyDraft();
      for (const { court, players } of MATCH_CARD_COURTS) {
        if (!Array.isArray(card.draft[court])) continue;
        normalizedDraft[court] = card.draft[court]
          .slice(0, players)
          .map(name => typeof name === "string" ? name : "");
        while (normalizedDraft[court].length < players) {
          normalizedDraft[court].push("");
        }
      }
      return {
        ...card,
        draft: normalizedDraft,
        draftInitialized: card.draftInitialized === true ||
          validateDraft(normalizedDraft).selectedPlayers > 0
      };
    });
}
