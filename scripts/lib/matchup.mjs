import {
  buildOpponentScenarios,
  challengeLineupAgainstPredictions,
  draftFromPrediction,
  emptyDraft,
  matchCardCourtDefinitions,
  normalizePlayerGender,
  validateDraft
} from "../../web/public/match-card.mjs";
import { activeNationalRoster } from "../../web/public/render.mjs";

function ratingDisplay(rating) {
  return rating?.display ?? "NR";
}

/**
 * Keeps only the format's courts and the right number of player slots, so a
 * client cannot add courts or players the card does not have.
 */
export function normalizeMatchupDraft(draft, leagueFormat) {
  const normalized = emptyDraft(leagueFormat);
  if (draft == null) return normalized;
  if (typeof draft !== "object" || Array.isArray(draft)) {
    throw new Error("Draft must map each court to its players.");
  }
  for (const [court, slots] of Object.entries(normalized)) {
    const players = draft[court] ?? [];
    if (!Array.isArray(players)) {
      throw new Error(`Draft court ${court} must be a list of players.`);
    }
    normalized[court] = slots.map((_, index) =>
      typeof players[index] === "string" ? players[index].trim() : ""
    );
  }
  return normalized;
}

function ourPlayerOptions(ourData, ourAnalysis) {
  const activeByName = new Map(
    activeNationalRoster(ourData).map(player => [player.name, player])
  );
  const statusRank = { eligible: 0, unknown: 1, ineligible: 2, unavailable: 3 };
  return (ourAnalysis.eligibility?.players ?? [])
    .map(player => {
      const active = activeByName.get(player.name);
      return {
        name: player.name,
        status: player.status,
        role: player.role ?? null,
        dr: Number.isFinite(player.dr) ? player.dr : null,
        utrSingles: ratingDisplay(player.utr?.singles),
        utrDoubles: ratingDisplay(player.utr?.doubles),
        gender: normalizePlayerGender(active?.gender) ?? null,
        ntrpLevel: active?.ntrp?.level ?? player.ntrpLevel ?? null
      };
    })
    .sort((a, b) =>
      (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4) ||
      (b.dr ?? -Infinity) - (a.dr ?? -Infinity) ||
      a.name.localeCompare(b.name)
    );
}

/**
 * Our lineup against the opponent's three scenarios, court by court, using
 * the same logic as the web Match Day Card. Without a draft, Our team's own
 * most likely lineup is the starting point.
 */
export function buildMatchup({
  ourData,
  ourAnalysis,
  opponentData,
  opponentAnalysis,
  draft = null,
  evidence = []
}) {
  const leagueFormat = ourData.team?.leagueFormat ?? "single_gender";
  const ourPrediction = ourAnalysis.lineupPredictions?.predictions?.[0] ?? null;
  const suggestedDraft = ourPrediction
    ? draftFromPrediction(ourPrediction, leagueFormat)
    : emptyDraft(leagueFormat);
  const activeDraft = draft == null
    ? suggestedDraft
    : normalizeMatchupDraft(draft, leagueFormat);

  const ourActiveRoster = activeNationalRoster(ourData);
  const maxCombinedNtrp = Number(ourData.team?.level);
  const eligibleNames = new Set(
    (ourAnalysis.eligibility?.players ?? [])
      .filter(player => player.status === "eligible")
      .map(player => player.name)
  );
  const validation = validateDraft(
    activeDraft,
    eligibleNames,
    leagueFormat,
    new Map(ourActiveRoster.map(player => [player.name, player.gender])),
    new Map(ourActiveRoster.map(player => [player.name, player.ntrp?.level])),
    Number.isFinite(maxCombinedNtrp) ? maxCombinedNtrp : null
  );

  const opponentActiveRoster = activeNationalRoster(opponentData);
  const scenarios = buildOpponentScenarios({
    opponentData,
    opponentAnalysis,
    activeRoster: opponentActiveRoster,
    leagueFormat,
    evidence
  });
  const challenges = challengeLineupAgainstPredictions({
    draft: activeDraft,
    predictions: scenarios,
    ourRoster: ourData.roster,
    opponentRoster: opponentData.roster,
    leagueFormat
  }).map((challenge, index) => ({
    ...challenge,
    scenarioType: scenarios[index]?.scenarioType ?? null
  }));
  const percents = challenges.map(challenge => challenge.scorePercent);

  return {
    leagueFormat,
    eligibilityScope: ourAnalysis.eligibility?.scope ?? null,
    ourTeam: { datasetId: ourData.datasetId, name: ourData.team?.name },
    opponentTeam: { datasetId: opponentData.datasetId, name: opponentData.team?.name },
    courts: matchCardCourtDefinitions(leagueFormat),
    maxCombinedNtrp: Number.isFinite(maxCombinedNtrp) ? maxCombinedNtrp : null,
    draft: activeDraft,
    suggestedDraft,
    suggestedDraftSource: ourPrediction ? "our_most_likely" : "none",
    validation,
    ourPlayers: ourPlayerOptions(ourData, ourAnalysis),
    scenarios: scenarios.map(scenario => ({
      rank: scenario.rank,
      scenarioType: scenario.scenarioType ?? null,
      confidence: scenario.confidence ?? null,
      historicalSupport: scenario.historicalSupport ?? 0,
      observedTogether: scenario.observedTogether ?? 0,
      unplayedPlayers: scenario.unplayedPlayers ?? [],
      lines: (scenario.lines ?? []).map(line => ({
        court: line.court,
        players: line.players ?? [],
        appearances: line.appearances ?? 0
      }))
    })),
    challenges,
    // Why scenarios may be missing: mixed pairs are only checked with known
    // genders, so opponents without recorded genders lose history scenarios.
    scenarioCoverage: {
      historicalPredictions: opponentAnalysis.lineupPredictions?.predictions?.length ?? 0,
      historicalScenarios: scenarios.filter(item => item.scenarioType !== "rating_ceiling").length,
      ratingCeiling: scenarios.some(item => item.scenarioType === "rating_ceiling"),
      opponentPlayersWithoutGender: leagueFormat === "mixed"
        ? opponentActiveRoster.filter(player => !normalizePlayerGender(player.gender)).length
        : 0,
      opponentRosterSize: opponentActiveRoster.length
    },
    // How well the lineup holds up when the opponent does something else.
    overall: percents.length
      ? {
          worstScorePercent: Math.min(...percents),
          averageScorePercent: Math.round(
            percents.reduce((sum, value) => sum + value, 0) / percents.length
          )
        }
      : null
  };
}
