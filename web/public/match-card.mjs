export const MATCH_CARD_COURTS = Object.freeze([
  Object.freeze({ court: "S1", discipline: "singles", players: 1 }),
  Object.freeze({ court: "S2", discipline: "singles", players: 1 }),
  Object.freeze({ court: "D1", discipline: "doubles", players: 2 }),
  Object.freeze({ court: "D2", discipline: "doubles", players: 2 }),
  Object.freeze({ court: "D3", discipline: "doubles", players: 2 })
]);
export const MIXED_MATCH_CARD_COURTS = Object.freeze([
  Object.freeze({ court: "D1", discipline: "doubles", players: 2 }),
  Object.freeze({ court: "D2", discipline: "doubles", players: 2 }),
  Object.freeze({ court: "D3", discipline: "doubles", players: 2 })
]);
export const MATCH_CARD_ELIGIBILITY_SCOPES = Object.freeze([
  "national",
  "sectional",
  "local"
]);
export const MATCHUP_FRESHNESS_LIMIT_DAYS = 14;
export const MATCH_CARD_STATUSES = Object.freeze([
  "not_started",
  "draft",
  "final",
  "archived"
]);

export function normalizeMatchCardEligibilityScope(value) {
  const scope = value ?? "national";
  if (!MATCH_CARD_ELIGIBILITY_SCOPES.includes(scope)) {
    throw new Error("Choose a National, Sectional, or Local eligibility target.");
  }
  return scope;
}

export function matchCardCourtDefinitions(leagueFormat) {
  return leagueFormat === "mixed"
    ? MIXED_MATCH_CARD_COURTS
    : MATCH_CARD_COURTS;
}

function readinessAge(generatedAt, now) {
  const generated = Date.parse(generatedAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(generated) || !Number.isFinite(current)) return null;
  return Math.max(0, Math.floor((current - generated) / 86_400_000));
}

function unresolvedIdentityCount(data) {
  const names = [
    ...(data.dataQuality?.unresolvedIdentities ?? []),
    ...(data.dataQuality?.unresolvedWtnIdentities ?? [])
  ].map(identity =>
    typeof identity === "string" ? identity : identity?.name
  ).filter(Boolean);
  return new Set(names.map(name => name.trim().toLocaleLowerCase())).size;
}

export function buildMatchupReadiness({
  ourData,
  opponentData,
  ourAnalysis,
  opponentAnalysis,
  now = new Date()
}) {
  const team = (side, data, analysis) => {
    const ageDays = readinessAge(data.generatedAt, now);
    const freshnessStatus = ageDays == null
      ? "unknown"
      : ageDays > MATCHUP_FRESHNESS_LIMIT_DAYS ? "stale" : "current";
    const unresolvedIdentities = unresolvedIdentityCount(data);
    const eligiblePlayers = analysis.eligibility?.summary?.eligible ?? 0;
    const rosterSize = analysis.eligibility?.summary?.rosterSize ??
      data.roster?.length ?? 0;
    const lineupScenarios =
      analysis.lineupPredictions?.predictions?.length ?? 0;
    return {
      side,
      teamName: data.team?.name ?? "Unknown team",
      generatedAt: data.generatedAt ?? null,
      ageDays,
      freshnessStatus,
      unresolvedIdentities,
      eligiblePlayers,
      rosterSize,
      lineupScenarios,
      needsAttention: freshnessStatus !== "current" ||
        unresolvedIdentities > 0 ||
        eligiblePlayers === 0 ||
        lineupScenarios === 0
    };
  };

  return {
    freshnessLimitDays: MATCHUP_FRESHNESS_LIMIT_DAYS,
    teams: [
      team("our", ourData, ourAnalysis),
      team("opponent", opponentData, opponentAnalysis)
    ]
  };
}

const ELIGIBILITY_SCOPES = new Set(["national", "sectional", "local"]);

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

export function emptyDraft(leagueFormat = "single_gender") {
  const courts = matchCardCourtDefinitions(leagueFormat);
  return Object.fromEntries(
    courts.map(({ court, players }) => [
      court,
      Array.from({ length: players }, () => "")
    ])
  );
}

export function draftFromPrediction(prediction, leagueFormat = "single_gender") {
  const draft = emptyDraft(leagueFormat);
  for (const line of prediction?.lines ?? []) {
    if (draft[line.court]) {
      draft[line.court] = line.players.slice(0, draft[line.court].length);
    }
  }
  return draft;
}

export function initializeBlankDraft(card) {
  const selectedPlayers = validateDraft(
    card.draft,
    null,
    card.leagueFormat
  ).selectedPlayers;
  const shouldInitialize = !card.draftInitialized ||
    (card.status === "not_started" && selectedPlayers > 0);
  if (!shouldInitialize) return { card, changed: false };
  return {
    card: {
      ...card,
      draft: emptyDraft(card.leagueFormat),
      draftInitialized: true
    },
    changed: true
  };
}

export function migrateMatchCardLeagueFormat(card, leagueFormat) {
  const normalizedFormat = leagueFormat === "mixed"
    ? "mixed"
    : "single_gender";
  if (card.leagueFormat === normalizedFormat) {
    return { card, changed: false };
  }
  const draft = emptyDraft(normalizedFormat);
  for (const { court, players } of matchCardCourtDefinitions(normalizedFormat)) {
    draft[court] = (card.draft?.[court] ?? [])
      .slice(0, players)
      .concat(Array.from({ length: players }, () => ""))
      .slice(0, players);
  }
  return {
    changed: true,
    card: {
      ...card,
      leagueFormat: normalizedFormat,
      draft,
      draftInitialized: true,
      opponentPredictionRank: 1,
      status: card.status === "final" ? "draft" : card.status
    }
  };
}

export function normalizePlayerGender(value) {
  if (/^(m|men|male)$/i.test(value ?? "")) return "Men";
  if (/^(f|w|women|female)$/i.test(value ?? "")) return "Women";
  return null;
}

export function validateMixedPair(
  players,
  genderByName,
  ntrpByName = null,
  maxCombinedNtrp = null
) {
  const selected = players.filter(Boolean);
  if (selected.length < 2) {
    return {
      valid: false,
      complete: false,
      unresolvedNames: [],
      unresolvedNtrpNames: [],
      combinedNtrp: null,
      exceedsNtrpLimit: false
    };
  }
  const genders = selected.map(name =>
    normalizePlayerGender(genderByName?.get(name))
  );
  const ntrpValues = selected.map(name => {
    const value = Number(ntrpByName?.get(name));
    return Number.isFinite(value) ? value : null;
  });
  const combinedNtrp = ntrpValues.every(Number.isFinite)
    ? ntrpValues.reduce((sum, value) => sum + value, 0)
    : null;
  const exceedsNtrpLimit = Number.isFinite(maxCombinedNtrp) &&
    Number.isFinite(combinedNtrp) &&
    combinedNtrp > maxCombinedNtrp;
  const unresolvedNtrpNames = Number.isFinite(maxCombinedNtrp)
    ? selected.filter((_, index) => !Number.isFinite(ntrpValues[index]))
    : [];
  const validGender = genders.includes("Men") && genders.includes("Women");
  return {
    complete: true,
    valid: validGender &&
      !exceedsNtrpLimit &&
      !unresolvedNtrpNames.length,
    validGender,
    unresolvedNames: selected.filter((_, index) => !genders[index]),
    unresolvedNtrpNames,
    combinedNtrp,
    exceedsNtrpLimit
  };
}

export function validateDraft(
  draft,
  eligibleNames = null,
  leagueFormat = "single_gender",
  genderByName = null,
  ntrpByName = null,
  maxCombinedNtrp = null
) {
  const courts = matchCardCourtDefinitions(leagueFormat);
  const selected = courts.flatMap(({ court }) => draft[court] ?? [])
    .filter(Boolean);
  const duplicateNames = [...new Set(
    selected.filter((name, index) => selected.indexOf(name) !== index)
  )];
  const unavailableNames = eligibleNames
    ? [...new Set(selected.filter(name => !eligibleNames.has(name)))]
    : [];
  const requiredPlayers = courts.reduce(
    (sum, court) => sum + court.players,
    0
  );
  const mixedPairIssues = leagueFormat === "mixed" && genderByName
    ? courts.flatMap(({ court }) => {
        const pair = validateMixedPair(
          draft[court] ?? [],
          genderByName,
          ntrpByName,
          maxCombinedNtrp
        );
        return pair.complete && !pair.valid
          ? [{
              court,
              unresolvedNames: pair.unresolvedNames,
              unresolvedNtrpNames: pair.unresolvedNtrpNames,
              invalidGender: !pair.validGender,
              exceedsNtrpLimit: pair.exceedsNtrpLimit,
              combinedNtrp: pair.combinedNtrp
            }]
          : [];
      })
    : [];
  return {
    complete: selected.length === requiredPlayers,
    selectedPlayers: selected.length,
    requiredPlayers,
    duplicateNames,
    unavailableNames,
    invalidGenderCourts: mixedPairIssues
      .filter(issue => issue.invalidGender)
      .map(issue => issue.court),
    invalidNtrpCourts: mixedPairIssues
      .filter(issue => issue.exceedsNtrpLimit)
      .map(issue => issue.court),
    unresolvedNtrpCourts: mixedPairIssues
      .filter(issue => issue.unresolvedNtrpNames.length)
      .map(issue => issue.court),
    unresolvedGenderNames: [...new Set(
      mixedPairIssues.flatMap(issue => issue.unresolvedNames)
    )],
    unresolvedNtrpNames: [...new Set(
      mixedPairIssues.flatMap(issue => issue.unresolvedNtrpNames)
    )],
    valid: selected.length === requiredPlayers &&
      duplicateNames.length === 0 &&
      mixedPairIssues.length === 0
  };
}

export function validateCardFinalization(
  card,
  eligibleNames = null,
  genderByName = null,
  ntrpByName = null,
  maxCombinedNtrp = null
) {
  const validation = validateDraft(
    card.draft,
    eligibleNames,
    card.leagueFormat,
    genderByName,
    ntrpByName,
    maxCombinedNtrp
  );
  return {
    ...validation,
    allowed: validation.valid,
    message: validation.valid
      ? null
      : validation.duplicateNames.length
        ? `Remove duplicate assignments for ${validation.duplicateNames.join(", ")}.`
        : validation.invalidNtrpCourts.length
          ? `Mixed pair NTRP exceeds ${maxCombinedNtrp.toFixed(1)} on ${validation.invalidNtrpCourts.join(", ")}.`
        : validation.unresolvedNtrpNames.length
          ? `Refresh player NTRP levels before finalizing ${validation.unresolvedNtrpCourts.join(", ")}.`
        : validation.unresolvedGenderNames.length
          ? `Refresh player genders before finalizing ${validation.invalidGenderCourts.join(", ")}.`
          : validation.invalidGenderCourts.length
            ? `Each Mixed pair must include one man and one woman: ${validation.invalidGenderCourts.join(", ")}.`
        : `Select all ${validation.requiredPlayers} required players.`
  };
}

export function resolveScheduledOpponent(match, teams) {
  if (match.linkedOpponentTeamId) {
    const linkedTeam = teams.find(
      team => team.id === match.linkedOpponentTeamId
    );
    if (linkedTeam) return linkedTeam;
  }
  if (match.sourceOpponentUrl) {
    const sourceKey = normalizedTeamSourceUrl(match.sourceOpponentUrl);
    const sourceMatches = teams.filter(
      team => team.sourceUrl &&
        normalizedTeamSourceUrl(team.sourceUrl) === sourceKey
    );
    if (sourceMatches.length === 1) return sourceMatches[0];
    if (sourceMatches.length > 1) return null;
  }
  const name = match.sourceOpponentName?.trim().toLocaleLowerCase();
  if (!name) return null;
  const nameMatches = teams.filter(team =>
    team.team?.name?.trim().toLocaleLowerCase() === name
  );
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function normalizedTeamSourceUrl(value) {
  const url = new URL(value);
  const parameters = [...url.searchParams.entries()]
    .sort(([nameA, valueA], [nameB, valueB]) =>
      nameA.localeCompare(nameB) || valueA.localeCompare(valueB)
    );
  url.search = "";
  for (const [name, parameterValue] of parameters) {
    url.searchParams.append(name, parameterValue);
  }
  return url.href;
}

export function orderScheduledMatches(matches) {
  const statusRank = {
    scheduled: 0,
    postponed: 1,
    completed: 2,
    cancelled: 3
  };
  return [...matches].sort((a, b) =>
    (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4) ||
    (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31") ||
    (a.time ?? "").localeCompare(b.time ?? "") ||
    a.id.localeCompare(b.id)
  );
}

export function migrateLegacyMatchCards({
  cards,
  matches,
  teams,
  ourTeamId,
  collectionId
}) {
  let migrated = 0;
  let unresolved = 0;
  const migratedCards = cards.map(card => {
    if (
      card.scheduledMatchId ||
      card.collectionId !== collectionId ||
      card.ourTeamId !== ourTeamId
    ) {
      return card;
    }
    const candidates = matches.filter(match => {
      const opponent = resolveScheduledOpponent(match, teams);
      return opponent?.id === card.opponentTeamId &&
        match.date === card.date;
    });
    if (candidates.length !== 1) {
      unresolved += 1;
      return card;
    }
    migrated += 1;
    return {
      ...card,
      scheduledMatchId: candidates[0].id,
      updatedAt: card.updatedAt ?? new Date().toISOString()
    };
  });
  return { cards: migratedCards, migrated, unresolved };
}

export function mergeMatchCards(localCards, serverCards) {
  const merged = new Map();
  for (const card of [...serverCards, ...localCards]) {
    const existing = merged.get(card.id);
    if (
      !existing ||
      (card.updatedAt ?? card.createdAt ?? "") >
        (existing.updatedAt ?? existing.createdAt ?? "")
    ) {
      merged.set(card.id, card);
    }
  }
  return [...merged.values()];
}

export function createMatchCard(input) {
  const now = input.now ?? new Date().toISOString();
  const leagueFormat = input.leagueFormat === "mixed"
    ? "mixed"
    : "single_gender";
  return {
    id: input.id,
    title: input.title?.trim() || "Match Day Card",
    date: input.date,
    location: input.location ?? "home",
    collectionId: input.collectionId ?? null,
    scheduledMatchId: input.scheduledMatchId ?? null,
    ourTeamId: input.ourTeamId,
    opponentTeamId: input.opponentTeamId,
    leagueFormat,
    eligibilityScope: normalizeMatchCardEligibilityScope(input.eligibilityScope),
    opponentPredictionRank: 1,
    draft: emptyDraft(leagueFormat),
    draftInitialized: false,
    status: "not_started",
    notes: "",
    createdAt: now,
    updatedAt: now
  };
}

function normalizedLines(lines = {}, leagueFormat = "single_gender") {
  return Object.fromEntries(
    matchCardCourtDefinitions(leagueFormat).map(({ court, players }) => {
    const values = Array.isArray(lines[court])
      ? lines[court].slice(0, players)
      : [];
    const normalized = values.map(value =>
      typeof value === "string" ? value.trim() : ""
    );
    while (normalized.length < players) normalized.push("");
    return [court, normalized];
    })
  );
}

function evidencePlayers(lines, leagueFormat) {
  return matchCardCourtDefinitions(leagueFormat)
    .flatMap(({ court }) => lines[court])
    .filter(Boolean);
}

export function createTournamentEvidence(input) {
  if (
    typeof input?.id !== "string" ||
    typeof input.collectionId !== "string" ||
    typeof input.opponentTeamId !== "string"
  ) {
    throw new Error("Tournament evidence requires an ID, collection, and opponent.");
  }
  const leagueFormat = input.leagueFormat === "mixed"
    ? "mixed"
    : "single_gender";
  const lines = normalizedLines(input.lines, leagueFormat);
  const observedPlayers = [
    ...(Array.isArray(input.observedPlayers) ? input.observedPlayers : []),
    ...evidencePlayers(lines, leagueFormat)
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
    leagueFormat,
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
      leagueFormat: item.leagueFormat,
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

export function extractLineupFromText(
  text,
  rosterNames,
  leagueFormat = "single_gender"
) {
  const lines = normalizedLines({}, leagueFormat);
  const courtPattern = /\b(S1|S2|D1|D2|D3)\b/gi;
  const matches = [...String(text ?? "").matchAll(courtPattern)];
  matches.forEach((match, index) => {
    const court = match[1].toUpperCase();
    if (!lines[court]) return;
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
  return [...lines]
    .sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }))
    .map(line => `${line.court}:${[...(line.players ?? [])].sort((a, b) =>
      a.localeCompare(b)
    ).join("|")}`)
    .join(";");
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
  const courts = matchCardCourtDefinitions(evidence.leagueFormat);
  const validation = validateDraft(
    evidence.lines,
    null,
    evidence.leagueFormat
  );
  if (!validation.valid) return null;
  const prediction = {
    confidence: "confirmed",
    historicalSupport: 0,
    observedTogether: 1,
    source: "tournament",
    evidenceId: evidence.id,
    evidenceDate: evidence.matchDate,
    lines: courts.map(({ court }) => ({
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

function ratingStrength(player, discipline) {
  const utr = ratingValue(player.utr?.[discipline]);
  if (Number.isFinite(utr)) {
    return { score: utr, source: `${discipline} UTR` };
  }
  if (Number.isFinite(player.dr)) {
    return { score: player.dr, source: "DR" };
  }
  return { score: null, source: null };
}

function pairKey(players) {
  return [...players].sort((a, b) => a.localeCompare(b)).join("|");
}

function knownPairMap(pairs = []) {
  return new Map(pairs.map(pair => [
    pairKey(pair.players ?? []),
    pair
  ]));
}

function playerPair(left, right, pairHistory) {
  const history = pairHistory.get(pairKey([left.name, right.name]));
  const scores = [
    ratingStrength(left, "doubles").score,
    ratingStrength(right, "doubles").score
  ].filter(Number.isFinite);
  return {
    players: [left.name, right.name],
    strength: scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : -Infinity,
    history
  };
}

function mixedRatingPairs(candidates, pairHistory, maxCombinedNtrp) {
  const men = candidates.filter(player =>
    normalizePlayerGender(player.gender) === "Men"
  ).slice(0, 10);
  const women = candidates.filter(player =>
    normalizePlayerGender(player.gender) === "Women"
  ).slice(0, 10);
  if (men.length < 3 || women.length < 3) return null;
  let best = null;
  const search = (manIndex, selectedPairs, usedWomen, score) => {
    if (selectedPairs.length === 3) {
      if (!best || score > best.score) {
        best = { pairs: selectedPairs, score };
      }
      return;
    }
    if (men.length - manIndex < 3 - selectedPairs.length) return;
    for (let index = manIndex; index < men.length; index += 1) {
      const man = men[index];
      for (const woman of women) {
        if (usedWomen.has(woman.name)) continue;
        const ntrpValues = [
          Number(man.ntrp?.level),
          Number(woman.ntrp?.level)
        ];
        if (
          Number.isFinite(maxCombinedNtrp) &&
          (
            !ntrpValues.every(Number.isFinite) ||
            ntrpValues[0] + ntrpValues[1] > maxCombinedNtrp
          )
        ) {
          continue;
        }
        const pair = playerPair(man, woman, pairHistory);
        const partnerBonus = (pair.history?.appearances ?? 0) * 0.05;
        search(
          index + 1,
          [...selectedPairs, pair],
          new Set([...usedWomen, woman.name]),
          score + pair.strength + partnerBonus
        );
      }
    }
  };
  search(0, [], new Set(), 0);
  return best?.pairs ?? null;
}

function singleGenderRatingPairs(candidates, pairHistory) {
  const remaining = [...candidates.slice(0, 6)];
  if (remaining.length < 6) return null;
  const pairs = [];
  while (remaining.length) {
    const first = remaining.shift();
    const partnerIndex = remaining
      .map((player, index) => ({
        index,
        appearances:
          pairHistory.get(pairKey([first.name, player.name]))?.appearances ?? 0,
        strength: ratingStrength(player, "doubles").score ?? -Infinity
      }))
      .sort((a, b) =>
        b.appearances - a.appearances ||
        b.strength - a.strength
      )[0].index;
    pairs.push(playerPair(
      first,
      remaining.splice(partnerIndex, 1)[0],
      pairHistory
    ));
  }
  return pairs;
}

export function buildRatingCeilingPrediction({
  roster = [],
  eligibilityPlayers = [],
  pairs = [],
  matches = [],
  leagueFormat = "single_gender",
  maxCombinedNtrp = null
}) {
  const eligibilityByName = new Map(
    eligibilityPlayers.map(player => [player.name, player.status])
  );
  const usageByName = new Map(
    summarizeRosterUsage(roster, matches).map(player => [player.name, player])
  );
  const candidates = roster
    .filter(player =>
      !["ineligible", "unavailable"].includes(
        eligibilityByName.get(player.name)
      )
    )
    .map(player => ({
      ...player,
      ceilingStrength: ratingStrength(player, "doubles").score,
      ratingSource: ratingStrength(player, "doubles").source,
      eligibilityStatus: eligibilityByName.get(player.name) ?? "unknown"
    }))
    .filter(player => Number.isFinite(player.ceilingStrength))
    .sort((a, b) =>
      b.ceilingStrength - a.ceilingStrength ||
      a.name.localeCompare(b.name)
    );
  const pairHistory = knownPairMap(pairs);
  let lines;
  let selectedPlayers;
  if (leagueFormat === "mixed") {
    const ratingPairs = mixedRatingPairs(
      candidates,
      pairHistory,
      maxCombinedNtrp
    );
    if (!ratingPairs) return null;
    const orderedPairs = [...ratingPairs].sort((a, b) =>
      b.strength - a.strength
    );
    lines = ["D1", "D2", "D3"].map((court, index) => ({
      court,
      players: orderedPairs[index].players,
      appearances: orderedPairs[index].history?.appearances ?? 0,
      postseasonAppearances: 0,
      record: orderedPairs[index].history?.record ?? null,
      lastUsedDate: null,
      usageShare: 0
    }));
    selectedPlayers = orderedPairs.flatMap(pair => pair.players);
  } else {
    const singlesCandidates = [...candidates].sort((a, b) =>
      (ratingStrength(b, "singles").score ?? -Infinity) -
        (ratingStrength(a, "singles").score ?? -Infinity) ||
      a.name.localeCompare(b.name)
    );
    const singlesPlayers = singlesCandidates.slice(0, 2);
    const singlesNames = new Set(singlesPlayers.map(player => player.name));
    const ratingPairs = singleGenderRatingPairs(
      candidates.filter(player => !singlesNames.has(player.name)),
      pairHistory
    );
    if (singlesPlayers.length < 2 || !ratingPairs) return null;
    const orderedPairs = [...ratingPairs].sort((a, b) =>
      b.strength - a.strength
    );
    lines = [
      ...["S1", "S2"].map((court, index) => ({
        court,
        players: [singlesPlayers[index].name],
        appearances: 0,
        postseasonAppearances: 0,
        record: null,
        lastUsedDate: null,
        usageShare: 0
      })),
      ...["D1", "D2", "D3"].map((court, index) => ({
        court,
        players: orderedPairs[index].players,
        appearances: orderedPairs[index].history?.appearances ?? 0,
        postseasonAppearances: 0,
        record: orderedPairs[index].history?.record ?? null,
        lastUsedDate: null,
        usageShare: 0
      }))
    ];
    selectedPlayers = [
      ...singlesPlayers.map(player => player.name),
      ...orderedPairs.flatMap(pair => pair.players)
    ];
  }
  const selected = selectedPlayers.map(name =>
    candidates.find(player => player.name === name)
  );
  const unplayedPlayers = selected.filter(player =>
    !usageByName.get(player.name)?.playedBefore
  ).map(player => player.name);
  const unresolvedEligibility = selected.filter(player =>
    player.eligibilityStatus === "unknown"
  ).map(player => player.name);
  return {
    source: "rating_ceiling",
    scenarioType: "rating_ceiling",
    confidence: "ratings-based",
    historicalSupport: 0,
    observedTogether: 0,
    onsiteConfirmed: 0,
    onsiteTotal: selectedPlayers.length,
    onsiteCoverage: 0,
    ratingCoverage: {
      ratedPlayers: selected.length,
      totalPlayers: selectedPlayers.length
    },
    unplayedPlayers,
    unresolvedEligibility,
    lines
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
    resolvedPlayers: records.length,
    players: players.map(name => {
      const player = byName.get(name);
      return {
        name,
        gender: normalizePlayerGender(player?.gender),
        dr: Number.isFinite(player?.dr) ? player.dr : null,
        utr: ratingValue(player?.utr?.[discipline]),
        utrDisplay: player?.utr?.[discipline]?.display ?? "NR"
      };
    })
  };
}

export function compareCourtLine({
  court,
  ourPlayers,
  opponentPlayers,
  ourRoster,
  opponentRoster,
  leagueFormat = "single_gender"
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
    leagueFormat,
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

export function challengeLineupAgainstPredictions({
  draft,
  predictions,
  ourRoster,
  opponentRoster,
  leagueFormat = "single_gender"
}) {
  const courts = matchCardCourtDefinitions(leagueFormat);
  const points = {
    favorable: 3,
    swing: 1.5,
    challenging: 0,
    limited: 0.5
  };
  return predictions.slice(0, 3).map((prediction, index) => {
    const comparisons = courts.map(({ court }) => {
      const opponentLine = prediction.lines?.find(line =>
        line.court === court
      );
      return compareCourtLine({
        court,
        ourPlayers: (draft[court] ?? []).filter(Boolean),
        opponentPlayers: opponentLine?.players ?? [],
        ourRoster,
        opponentRoster
      });
    });
    const summary = summarizeMatchup(comparisons);
    const score = comparisons.reduce(
      (total, comparison) => total + points[comparison.edge],
      0
    );
    const pros = comparisons
      .filter(comparison => comparison.edge === "favorable")
      .map(comparison => `${comparison.court} rates as a favorable edge.`);
    const risks = comparisons
      .filter(comparison => comparison.edge === "challenging")
      .map(comparison => `${comparison.court} carries the largest rating risk.`);
    const swingCourts = comparisons
      .filter(comparison => comparison.edge === "swing")
      .map(comparison => comparison.court);
    const limitedCourts = comparisons
      .filter(comparison => comparison.edge === "limited")
      .map(comparison => comparison.court);
    if (swingCourts.length) {
      risks.push(`${swingCourts.join(", ")} ${
        swingCourts.length === 1 ? "is a swing court" : "are swing courts"
      }.`);
    }
    if (limitedCourts.length) {
      risks.push(
        `${limitedCourts.join(", ")} ${
          limitedCourts.length === 1 ? "has" : "have"
        } limited rating evidence.`
      );
    }
    return {
      rank: prediction.rank ?? index + 1,
      source: prediction.source ?? "historical",
      confidence: prediction.confidence ?? "emerging",
      historicalSupport: prediction.historicalSupport ?? 0,
      comparisons,
      summary,
      score: round(score, 1),
      maxScore: courts.length * 3,
      scorePercent: round(score / (courts.length * 3) * 100, 0),
      ratingCoverage: {
        drCourts: comparisons.filter(comparison =>
          Number.isFinite(comparison.ours.dr) &&
          Number.isFinite(comparison.opponent.dr)
        ).length,
        utrCourts: comparisons.filter(comparison =>
          Number.isFinite(comparison.ours.utr) &&
          Number.isFinite(comparison.opponent.utr)
        ).length,
        totalCourts: courts.length
      },
      pros: pros.length ? pros : ["No clear favorable court from available ratings."],
      risks: risks.length ? risks : ["No clear rating disadvantage in this scenario."]
    };
  });
}

export function summarizeStackingStrategy(matchStacking = []) {
  if (!matchStacking.length) return null;
  const orderedMatches = [...matchStacking].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );
  const latest = orderedMatches[0];
  const lines = [...(latest.lines ?? [])]
    .filter(line => line.court?.startsWith("D"))
    .sort((a, b) =>
      a.court.localeCompare(b.court, undefined, { numeric: true })
    );
  if (!lines.length) return null;
  const inversions = [];
  for (let index = 1; index < lines.length; index += 1) {
    const upper = lines[index - 1];
    const lower = lines[index];
    if (
      Number.isFinite(upper.averageDr) &&
      Number.isFinite(lower.averageDr) &&
      lower.averageDr > upper.averageDr + 0.05
    ) {
      inversions.push({
        upperCourt: upper.court,
        upperDr: upper.averageDr,
        lowerCourt: lower.court,
        lowerDr: lower.averageDr
      });
    }
  }
  const matchPatterns = orderedMatches.map(match => {
    const matchLines = [...(match.lines ?? [])]
      .filter(line =>
        line.court?.startsWith("D") && Number.isFinite(line.averageDr)
      )
      .sort((a, b) =>
        Number(a.court.slice(1)) - Number(b.court.slice(1))
      );
    const hasLowerCourtStrength = matchLines.some((upper, upperIndex) =>
      matchLines.slice(upperIndex + 1).some(lower =>
        lower.averageDr > upper.averageDr
      )
    );
    const strongestCourt = [...matchLines]
      .sort((a, b) => b.averageDr - a.averageDr)[0]?.court ?? null;
    return {
      hasRatingEvidence: matchLines.length >= 2,
      hasLowerCourtStrength,
      strongestCourt
    };
  });
  const matchesWithRatingEvidence = matchPatterns.filter(
    match => match.hasRatingEvidence
  );
  const lowerCourtStrengthMatches = matchesWithRatingEvidence.filter(
    match => match.hasLowerCourtStrength
  ).length;
  const traditionalOrderMatches =
    matchesWithRatingEvidence.length - lowerCourtStrengthMatches;
  const strongestCourtCounts = [...matchPatterns.reduce((counts, match) => {
    if (match.strongestCourt) {
      counts.set(
        match.strongestCourt,
        (counts.get(match.strongestCourt) ?? 0) + 1
      );
    }
    return counts;
  }, new Map()).entries()]
    .map(([court, matches]) => ({ court, matches }))
    .sort((a, b) => b.matches - a.matches || a.court.localeCompare(b.court));
  return {
    matchesAnalyzed: matchStacking.length,
    matchesWithRatingEvidence: matchesWithRatingEvidence.length,
    lowerCourtStrengthMatches,
    traditionalOrderMatches,
    lowerCourtStrengthRate: matchesWithRatingEvidence.length
      ? lowerCourtStrengthMatches / matchesWithRatingEvidence.length
      : null,
    strongestCourtCounts,
    latestDate: latest.date ?? null,
    opponentTeam: latest.opponentTeam ?? null,
    lines,
    inversions,
    strongestCourtByDr: latest.strongestCourtByDr ??
      [...lines]
        .filter(line => Number.isFinite(line.averageDr))
        .sort((a, b) => b.averageDr - a.averageDr)[0]?.court ?? null,
    label: lowerCourtStrengthMatches >= 2 &&
      lowerCourtStrengthMatches / matchesWithRatingEvidence.length >= 0.5
      ? "Repeated lower-court strength pattern"
      : lowerCourtStrengthMatches
      ? "Possible lower-court stacking pattern"
      : matchesWithRatingEvidence.length
        ? "Traditional strongest-to-lower ordering"
        : "Limited rating evidence",
    confidence: matchesWithRatingEvidence.length >= 3
      ? "established"
      : matchesWithRatingEvidence.length === 2
      ? "developing"
      : "single-match evidence"
  };
}

export function summarizeRosterUsage(roster = [], matches = []) {
  const usage = new Map(roster.map(player => [
    player.name,
    { matchIds: new Set(), courts: new Set() }
  ]));
  for (const match of matches) {
    for (const [court, line] of Object.entries(match.courts ?? {})) {
      for (const name of line.targetPlayers ?? []) {
        const player = usage.get(name);
        if (!player) continue;
        player.matchIds.add(match.id ?? match.date ?? `${court}:${name}`);
        player.courts.add(court);
      }
    }
  }
  return roster.map(player => {
    const playerUsage = usage.get(player.name);
    return {
      name: player.name,
      appearances: playerUsage?.matchIds.size ?? 0,
      courts: [...(playerUsage?.courts ?? [])].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      ),
      playedBefore: Boolean(playerUsage?.matchIds.size)
    };
  });
}

export function explainLineupPrediction(prediction) {
  if (prediction.source === "rating_ceiling") {
    return {
      summary: "This is the strongest eligible lineup supported by known ratings. It is a ceiling scenario, not a prediction of who will play.",
      reasons: [
        `${prediction.ratingCoverage?.ratedPlayers ?? 0} of ${prediction.ratingCoverage?.totalPlayers ?? 0} selected players have usable DR or discipline ratings.`,
        prediction.unplayedPlayers?.length
          ? `${prediction.unplayedPlayers.length} selected player${prediction.unplayedPlayers.length === 1 ? " has" : "s have"} no gathered match history.`
          : "Every selected player appears in gathered match history.",
        prediction.unresolvedEligibility?.length
          ? `${prediction.unresolvedEligibility.length} selected player${prediction.unresolvedEligibility.length === 1 ? " has" : "s have"} unresolved eligibility.`
          : "No selected player has unresolved eligibility."
      ],
      courts: (prediction.lines ?? []).map(line => ({
        court: line.court,
        reason: line.appearances
          ? `Ratings-based placement; this pair has ${line.appearances} observed appearance${line.appearances === 1 ? "" : "s"}.`
          : "Ratings-based placement with no observed court assignment required."
      }))
    };
  }
  if (prediction.source === "tournament") {
    return {
      summary: "This lineup comes from reviewed tournament evidence and is ranked ahead of historical projections.",
      reasons: [
        prediction.evidenceDate
          ? `Observed in reviewed evidence dated ${prediction.evidenceDate}.`
          : "Observed in reviewed tournament evidence.",
        `${prediction.onsiteConfirmed ?? 0} of ${prediction.onsiteTotal ?? 0} lineup players are confirmed onsite.`
      ],
      courts: (prediction.lines ?? []).map(line => ({
        court: line.court,
        reason: "Players were assigned to this court in the reviewed lineup."
      }))
    };
  }
  const evidence = prediction.evidence ?? {};
  const observedTogether = prediction.observedTogether ?? 0;
  return {
    summary: "This is an evidence-ranked lineup, not a strongest-ratings lineup. Court choices are combined from frequency, recency, postseason use, and full-lineup history.",
    reasons: [
      `${prediction.historicalSupport ?? 0}% average court-usage support across the lineup.`,
      observedTogether
        ? `This full lineup was observed together in ${observedTogether} gathered match${observedTogether === 1 ? "" : "es"}.`
        : "This exact full lineup was not observed together; it combines the strongest supported court patterns.",
      `${evidence.totalCourtAppearances ?? 0} total court appearance${evidence.totalCourtAppearances === 1 ? "" : "s"} support these assignments.`,
      `${evidence.postseasonCourtAppearances ?? 0} supporting postseason court appearance${evidence.postseasonCourtAppearances === 1 ? "" : "s"}.`
    ],
    courts: (prediction.lines ?? []).map(line => ({
      court: line.court,
      reason: [
        `${line.appearances ?? 0} appearance${line.appearances === 1 ? "" : "s"}`,
        `${Math.round((line.usageShare ?? 0) * 100)}% of supported ${line.court} usage`,
        line.lastUsedDate ? `last used ${line.lastUsedDate}` : null
      ].filter(Boolean).join(" · ")
    }))
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
      const leagueFormat = card.leagueFormat === "mixed"
        ? "mixed"
        : "single_gender";
      const normalizedDraft = emptyDraft(leagueFormat);
      for (const { court, players } of matchCardCourtDefinitions(leagueFormat)) {
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
        leagueFormat,
        status: MATCH_CARD_STATUSES.includes(card.status)
          ? card.status
          : "draft",
        notes: typeof card.notes === "string" ? card.notes : "",
        eligibilityScope: MATCH_CARD_ELIGIBILITY_SCOPES.includes(
          card.eligibilityScope
        )
          ? card.eligibilityScope
          : "national",
        draft: normalizedDraft,
        draftInitialized: card.draftInitialized === true ||
          validateDraft(normalizedDraft, null, leagueFormat).selectedPlayers > 0
      };
    });
}
