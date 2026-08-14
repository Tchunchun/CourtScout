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
