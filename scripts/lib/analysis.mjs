export const ANALYSIS_VERSION = "1.2.0";
const POSTSEASON_PHASES = new Set([
  "playoff",
  "district",
  "sectionals",
  "sectionals_semifinal",
  "sectionals_final",
  "nationals"
]);

export const ELIGIBILITY_SCOPES = Object.freeze({
  local: Object.freeze({
    computerRatedMatches: 0,
    selfRatedMatches: 0,
    label: "Local"
  }),
  sectional: Object.freeze({
    computerRatedMatches: 2,
    selfRatedMatches: 3,
    label: "Sectional"
  }),
  national: Object.freeze({
    computerRatedMatches: 3,
    selfRatedMatches: 4,
    label: "National"
  })
});

function requireDataset(dataset) {
  if (!dataset || typeof dataset !== "object") {
    throw new Error("Analysis requires a team dataset.");
  }
  if (!Array.isArray(dataset.roster) || !Array.isArray(dataset.matches)) {
    throw new Error("Analysis requires roster and matches arrays.");
  }
}

function ratingValue(rating) {
  if (!rating || typeof rating !== "object") return null;
  if (Number.isFinite(rating.exactValue)) return rating.exactValue;
  return Number.isFinite(rating.value) ? rating.value : null;
}

function average(values) {
  const available = values.filter(Number.isFinite);
  if (available.length !== values.length || available.length === 0) return null;
  return available.reduce((sum, value) => sum + value, 0) / available.length;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function record() {
  return { wins: 0, losses: 0, ties: 0, unknown: 0 };
}

function addResult(target, result) {
  if (result === "W") target.wins += 1;
  else if (result === "L") target.losses += 1;
  else if (result === "T") target.ties += 1;
  else target.unknown += 1;
}

function withRecordMetrics(value) {
  const decisions = value.wins + value.losses;
  return {
    ...value,
    decisions,
    winRate: decisions ? round(value.wins / decisions) : null
  };
}

function isPostseason(phase) {
  return POSTSEASON_PHASES.has(phase) || phase?.startsWith("sectionals");
}

function sourcePlayer(dataset, name) {
  return dataset.roster.find(player => player.name === name) ?? null;
}

function joinedRating(court, side, name) {
  const joins = side === "target" ? court.targetRatings : court.opponentRatings;
  return joins?.find(item => item.name === name) ?? null;
}

function historicalDr(join) {
  if (Number.isFinite(join?.historicalDr?.value)) return join.historicalDr.value;
  if (Number.isFinite(join?.dr)) return join.dr;
  if (Number.isFinite(join?.currentDr)) return join.currentDr;
  return null;
}

function matchPageDr(join) {
  return Number.isFinite(join?.historicalDr?.value)
    ? join.historicalDr.value
    : null;
}

function ratingTextValue(text, side, ratingType) {
  if (!text) return null;
  const [targetText, opponentText = ""] = String(text).split(/\bOpp\b/i);
  const segment = side === "opponent" ? opponentText : targetText;
  const value = segment.match(new RegExp(`\\b${ratingType}\\s+(\\d+(?:\\.\\d+)?)`, "i"))?.[1];
  return value ? Number(value) : null;
}

function joinedUtr(join, discipline) {
  const rating = join?.utr?.[discipline] ?? join?.utr;
  return ratingValue(rating);
}

function scoreProfile(court) {
  const sets = [...(court.score ?? "").matchAll(/(\d+)\s*-\s*(\d+)/g)]
    .map(match => ({ target: Number(match[1]), opponent: Number(match[2]) }));
  const targetSetWins = sets.filter(set => set.target > set.opponent).length;
  const opponentSetWins = sets.filter(set => set.target < set.opponent).length;
  return {
    sets,
    straightSets: sets.length >= 2 &&
      (targetSetWins === 0 || opponentSetWins === 0),
    matchTiebreak: sets.some((set, index) =>
      index >= 2 && (
        (set.target === 1 && set.opponent === 0) ||
        (set.target === 0 && set.opponent === 1) ||
        Math.max(set.target, set.opponent) >= 10
      )
    ),
    bagelSets: sets.filter(set => set.target === 0 || set.opponent === 0).length,
    defaulted: court.adjudication === "default_received" ||
      court.adjudication === "default_conceded",
    retired: court.adjudication === "retired"
  };
}

function comparison(targetValue, opponentValue) {
  if (!Number.isFinite(targetValue) || !Number.isFinite(opponentValue)) return null;
  return round(targetValue - opponentValue);
}

function comparisonFlags(result, margin) {
  return {
    lowerRatedWin: result === "W" && Number.isFinite(margin) && margin < 0,
    favoriteLoss: result === "L" && Number.isFinite(margin) && margin > 0
  };
}

function ratingCategory(type) {
  if (type === "D") return "disqualified";
  if (type === "S" || type === "A") return "self_rated_or_appealed";
  if (type && type !== "unknown") return "computer_rated";
  return "unknown";
}

function deriveQualifyingAppearances(dataset) {
  const appearances = new Map(dataset.roster.map(player => [player.name, {
    actual: 0,
    defaultsReceived: 0,
    sectionals: 0
  }]));
  for (const match of dataset.matches) {
    for (const court of Object.values(match.courts ?? {})) {
      for (const name of court.targetPlayers ?? []) {
        const player = appearances.get(name);
        if (!player) continue;
        if (court.adjudication === "default_received") {
          player.defaultsReceived += 1;
        } else {
          player.actual += 1;
        }
        if (match.phase?.startsWith("sectionals")) player.sectionals += 1;
      }
    }
  }
  return appearances;
}

function sortedUsage(usage) {
  return [...usage.entries()]
    .map(([court, appearances]) => ({ court, appearances }))
    .sort((a, b) =>
      b.appearances - a.appearances ||
      a.court.localeCompare(b.court, undefined, { numeric: true })
    );
}

function playerEligibilityProfile(dataset, player) {
  const localSingles = record();
  const localDoubles = record();
  const courtUsage = new Map();
  const localCourtUsage = new Map();
  const postseasonCourtUsage = new Map();
  const partners = new Map();
  let lowerDrSinglesWins = 0;
  let lowerUtrSinglesWins = 0;
  let localSinglesAppearances = 0;
  let localDoublesAppearances = 0;
  let postseasonAppearances = 0;

  for (const match of dataset.matches) {
    for (const [courtName, court] of Object.entries(match.courts ?? {})) {
      if (!(court.targetPlayers ?? []).includes(player.name)) continue;
      if (court.adjudication === "default_received") continue;
      courtUsage.set(courtName, (courtUsage.get(courtName) ?? 0) + 1);
      if (match.phase === "local") {
        localCourtUsage.set(courtName, (localCourtUsage.get(courtName) ?? 0) + 1);
        if (courtName.startsWith("S")) {
          localSinglesAppearances += 1;
          addResult(localSingles, court.result);
        } else if (courtName.startsWith("D")) {
          localDoublesAppearances += 1;
          addResult(localDoubles, court.result);
        }
      }
      if (isPostseason(match.phase)) {
        postseasonAppearances += 1;
        postseasonCourtUsage.set(
          courtName,
          (postseasonCourtUsage.get(courtName) ?? 0) + 1
        );
      }
      if (courtName.startsWith("S") && court.result === "W") {
        const opponentName = court.opponentPlayers?.[0];
        const targetJoin = joinedRating(court, "target", player.name);
        const opponentJoin = opponentName
          ? joinedRating(court, "opponent", opponentName)
          : null;
        const targetDr = historicalDr(targetJoin);
        const opponentDr = historicalDr(opponentJoin);
        const targetUtr = joinedUtr(targetJoin, "singles") ??
          ratingValue(player.utr?.singles);
        const opponentUtr = joinedUtr(opponentJoin, "singles");
        if (Number.isFinite(targetDr) && Number.isFinite(opponentDr) &&
          targetDr < opponentDr) {
          lowerDrSinglesWins += 1;
        }
        if (Number.isFinite(targetUtr) && Number.isFinite(opponentUtr) &&
          targetUtr < opponentUtr) {
          lowerUtrSinglesWins += 1;
        }
      }
      if (courtName.startsWith("D")) {
        for (const partnerName of (court.targetPlayers ?? []).filter(name =>
          name !== player.name
        )) {
          const partner = partners.get(partnerName) ?? {
            name: partnerName,
            appearances: 0,
            record: record()
          };
          partner.appearances += 1;
          addResult(partner.record, court.result);
          partners.set(partnerName, partner);
        }
      }
    }
  }

  const localAppearances = localSinglesAppearances + localDoublesAppearances;

  return {
    dr: player.dr ?? null,
    utr: {
      singles: player.utr?.singles ?? null,
      doubles: player.utr?.doubles ?? null
    },
    local: {
      singles: {
        appearances: localSinglesAppearances,
        record: withRecordMetrics(localSingles)
      },
      doubles: {
        appearances: localDoublesAppearances,
        record: withRecordMetrics(localDoubles)
      },
      appearances: localAppearances
    },
    postseasonAppearances,
    courtUsage: sortedUsage(courtUsage),
    localCourtUsage: sortedUsage(localCourtUsage),
    postseasonCourtUsage: sortedUsage(postseasonCourtUsage),
    primaryPartner: [...partners.values()]
      .sort((a, b) =>
        b.appearances - a.appearances ||
        a.name.localeCompare(b.name)
      )
      .map(partner => ({
        ...partner,
        record: withRecordMetrics(partner.record)
      }))[0] ?? null,
    singlesUpsets: {
      higherDrWins: lowerDrSinglesWins,
      higherUtrWins: lowerUtrSinglesWins
    },
    sourceLikelyRole: player.likelyRole ?? null,
    sourceNote: player.note ?? null
  };
}

function primaryCourt(player, prefix, usageKey = "localCourtUsage") {
  return player[usageKey].find(item => item.court.startsWith(prefix))?.court ?? null;
}

function observedEligibilityRole(player) {
  const singles = player.local.singles.appearances;
  const doubles = player.local.doubles.appearances;
  const singlesCourt = primaryCourt(player, "S");
  const doublesCourt = primaryCourt(player, "D");
  if (singles && doubles) {
    if (singles >= Math.max(3, doubles * 2)) {
      return `Singles Anchor (${singlesCourt}) / Doubles Flex`;
    }
    if (doubles >= Math.max(3, singles * 2)) {
      return `Doubles Anchor (${doublesCourt}) / Singles Flex`;
    }
    return `Singles / Doubles Flex (${singlesCourt} / ${doublesCourt})`;
  }
  if (singles) {
    return `${singles >= 3 ? "Singles Anchor" : "Singles Depth"} (${singlesCourt})`;
  }
  if (doubles) {
    return `${doubles >= 3 ? "Doubles Anchor" : "Doubles Depth"} (${doublesCourt})`;
  }
  if (player.postseasonAppearances) {
    const postseasonCourt = player.postseasonCourtUsage[0]?.court ?? "unknown court";
    return `Postseason Option (${postseasonCourt})`;
  }
  return "No observed lineup role";
}

function sameFiniteValue(value, expected) {
  return Number.isFinite(value) && Number.isFinite(expected) && value === expected;
}

function usageNote(player, context) {
  const singles = player.local.singles;
  const doubles = player.local.doubles;
  if (singles.appearances && doubles.appearances) {
    const primary = singles.appearances >= doubles.appearances
      ? { label: "singles", value: singles, court: primaryCourt(player, "S") }
      : { label: "doubles", value: doubles, court: primaryCourt(player, "D") };
    const secondary = primary.label === "singles" ? doubles : singles;
    const secondaryLabel = primary.label === "singles" ? "doubles" : "singles";
    return `${primary.value.appearances} local ${primary.label} appearance${primary.value.appearances === 1 ? "" : "s"} at ${primary.court} ` +
      `(${primary.value.record.wins}–${primary.value.record.losses}), plus ${secondary.appearances} local ${secondaryLabel} appearance${secondary.appearances === 1 ? "" : "s"}`;
  }
  if (singles.appearances) {
    const prefix = singles.appearances === context.maxEligibleSingles
      ? "Roster-high "
      : "";
    return `${prefix}${singles.appearances} local singles appearance${singles.appearances === 1 ? "" : "s"} at ${primaryCourt(player, "S")} ` +
      `(${singles.record.wins}–${singles.record.losses})`;
  }
  if (doubles.appearances) {
    const prefix = doubles.appearances === context.maxEligibleDoubles
      ? "Roster-high "
      : "";
    return `${prefix}${doubles.appearances} local doubles appearance${doubles.appearances === 1 ? "" : "s"}, mainly ${primaryCourt(player, "D")} ` +
      `(${doubles.record.wins}–${doubles.record.losses})`;
  }
  return null;
}

function derivedStandoutNote(player, context, eligibilityLabel) {
  if (player.status === "unavailable") {
    return "Disqualified and unavailable for lineup selection, regardless of match history.";
  }
  if (player.status === "unknown") {
    return "Eligibility cannot be confirmed because the source rating type is unknown.";
  }
  if (player.status === "ineligible") {
    const facts = [
      `${player.matchesNeeded} more qualifying match${player.matchesNeeded === 1 ? "" : "es"} needed`
    ];
    if (sameFiniteValue(player.dr, context.maxRosterDr)) {
      facts.push(`highest roster DR (${player.dr.toFixed(2)}) is only a historical ceiling until eligible`);
    }
    const usage = usageNote(player, context);
    facts.push(usage ?? "no collected local court usage");
    return `${facts.join("; ")}.`;
  }
  if (!player.local.appearances && !player.postseasonAppearances) {
    return `Eligible for the ${eligibilityLabel.toLowerCase()} target, but no collected court usage supports a projected role.`;
  }

  const facts = [];
  if (sameFiniteValue(player.dr, context.maxEligibleDr)) {
    facts.push(`Highest eligible DR (${player.dr.toFixed(2)})`);
  } else if (sameFiniteValue(ratingValue(player.utr.singles), context.maxEligibleSinglesUtr)) {
    facts.push(`Highest eligible singles UTR (${player.utr.singles.display})`);
  } else if (sameFiniteValue(ratingValue(player.utr.doubles), context.maxEligibleDoublesUtr)) {
    facts.push(`Highest eligible doubles UTR (${player.utr.doubles.display})`);
  }
  const usage = usageNote(player, context);
  if (usage) facts.push(usage);
  const upsetSignals = player.singlesUpsets.higherDrWins +
    player.singlesUpsets.higherUtrWins;
  if (upsetSignals) {
    facts.push(
      `${upsetSignals} singles upset signal${upsetSignals === 1 ? "" : "s"} against higher-rated opponents`
    );
  } else if (player.primaryPartner?.appearances >= 2) {
    facts.push(
      `most-used partner ${player.primaryPartner.name} is ` +
      `${player.primaryPartner.record.wins}–${player.primaryPartner.record.losses} in ${player.primaryPartner.appearances} appearances`
    );
  }
  if (player.postseasonAppearances) {
    facts.push(
      `${player.postseasonAppearances} postseason appearance${player.postseasonAppearances === 1 ? "" : "s"}, mainly ${player.postseasonCourtUsage[0]?.court}`
    );
  }
  if (player.matchesRequired > 0 && player.countedMatches === player.matchesRequired) {
    facts.push(`exactly at the ${eligibilityLabel.toLowerCase()} eligibility floor`);
  }
  return `${facts.slice(0, 4).join("; ")}.`;
}

function enrichEligibilityProfiles(players, eligibilityLabel) {
  const eligible = players.filter(player => player.status === "eligible");
  const max = (items, selector) => Math.max(
    ...items.map(selector).filter(Number.isFinite),
    -Infinity
  );
  const context = {
    maxRosterDr: max(players, player => player.dr),
    maxEligibleDr: max(eligible, player => player.dr),
    maxEligibleSinglesUtr: max(eligible, player => ratingValue(player.utr.singles)),
    maxEligibleDoublesUtr: max(eligible, player => ratingValue(player.utr.doubles)),
    maxEligibleSingles: max(eligible, player => player.local.singles.appearances),
    maxEligibleDoubles: max(eligible, player => player.local.doubles.appearances)
  };
  return players.map(player => {
    const observedRole = observedEligibilityRole(player);
    const role = player.sourceLikelyRole ??
      (player.status === "ineligible"
        ? `Ineligible — ${player.matchesNeeded} match${player.matchesNeeded === 1 ? "" : "es"} needed · ${observedRole}`
        : player.status === "unavailable"
          ? "Unavailable — disqualified"
          : player.status === "unknown"
            ? `Eligibility unresolved · ${observedRole}`
            : observedRole);
    return {
      ...player,
      role,
      standoutNote: player.sourceNote ??
        derivedStandoutNote(player, context, eligibilityLabel)
    };
  });
}

export function analyzeEligibility(dataset, scope = "national") {
  requireDataset(dataset);
  const rule = ELIGIBILITY_SCOPES[scope];
  if (!rule) {
    throw new Error(
      `Eligibility must be one of: ${Object.keys(ELIGIBILITY_SCOPES).join(", ")}.`
    );
  }

  const derivedAppearances = deriveQualifyingAppearances(dataset);
  const dataQualityIssues = [];
  const evaluatedPlayers = dataset.roster.map(player => {
    const category = ratingCategory(player.ntrp?.type);
    const sourceActual = player.qualifyingAppearances?.actual ?? 0;
    const sourceDefaults = player.qualifyingAppearances?.defaultsReceived ?? 0;
    const derived = derivedAppearances.get(player.name) ?? {
      actual: 0,
      defaultsReceived: 0,
      sectionals: 0
    };
    const sourcePending = player.nationalsEligibility?.status === "unknown" &&
      sourceActual === 0 &&
      sourceDefaults === 0 &&
      derived.actual + derived.defaultsReceived > 0;
    const sourceMismatch = sourceActual !== derived.actual ||
      sourceDefaults !== derived.defaultsReceived;
    if (sourceMismatch) {
      dataQualityIssues.push({
        player: player.name,
        code: sourcePending
          ? "qualifying_appearances_pending"
          : "qualifying_appearances_mismatch",
        source: {
          actual: sourceActual,
          defaultsReceived: sourceDefaults
        },
        matchLedger: {
          actual: derived.actual,
          defaultsReceived: derived.defaultsReceived
        },
        resolution: sourcePending
          ? "match_ledger_fallback"
          : "roster_source_retained"
      });
    }
    const actual = sourcePending ? derived.actual : sourceActual;
    const defaultsReceived = sourcePending
      ? derived.defaultsReceived
      : sourceDefaults;
    const required = category === "self_rated_or_appealed"
      ? rule.selfRatedMatches
      : rule.computerRatedMatches;
    const countedDefaults = category === "computer_rated"
      ? Math.min(defaultsReceived, 1)
      : 0;
    const countedMatches = actual + countedDefaults;

    let status;
    if (category === "disqualified") status = "unavailable";
    else if (scope !== "local" && category === "unknown") status = "unknown";
    else status = countedMatches >= required ? "eligible" : "ineligible";

    const profile = playerEligibilityProfile(dataset, player);
    return {
      name: player.name,
      ntrpLevel: player.ntrp?.level ?? null,
      ntrpType: player.ntrp?.type ?? null,
      ratingCategory: category,
      appearanceSource: sourcePending ? "match_ledger_fallback" : "roster",
      actualMatches: actual,
      defaultsReceived,
      sourceAppearances: {
        actual: sourceActual,
        defaultsReceived: sourceDefaults
      },
      matchLedgerAppearances: {
        actual: derived.actual,
        defaultsReceived: derived.defaultsReceived
      },
      countedDefaults,
      countedMatches,
      matchesRequired: required,
      matchesNeeded: status === "ineligible"
        ? Math.max(required - countedMatches, 0)
        : 0,
      sectionalsAppearances: player.sectionalsAppearances ?? 0,
      ...profile,
      status
    };
  });
  const players = enrichEligibilityProfiles(evaluatedPlayers, rule.label);

  const statusCounts = players.reduce((counts, player) => {
    counts[player.status] += 1;
    return counts;
  }, { eligible: 0, ineligible: 0, unavailable: 0, unknown: 0 });

  return {
    scope,
    label: rule.label,
    rules: {
      computerRatedMatches: rule.computerRatedMatches,
      selfRatedOrAppealedMatches: rule.selfRatedMatches,
      computerRatedDefaultReceivedMayCount: 1,
      selfRatedOrAppealedDefaultsCount: false,
      disqualifiedPlayersAvailable: false
    },
    summary: {
      rosterSize: players.length,
      ...statusCounts
    },
    dataQualityIssues,
    players
  };
}

function courtEntries(dataset, prefix) {
  return dataset.matches.flatMap(match =>
    Object.entries(match.courts ?? {})
      .filter(([courtName]) => courtName.startsWith(prefix))
      .map(([courtName, court]) => ({ match, courtName, court }))
  );
}

function courtSummaries(entries, personnelKey) {
  const summaries = new Map();
  for (const entry of entries) {
    const summary = summaries.get(entry.courtName) ?? {
      court: entry.courtName,
      record: record(),
      postseasonRecord: record(),
      defaults: 0,
      dqReversals: 0,
      personnel: new Map()
    };
    addResult(summary.record, entry.court.result);
    if (isPostseason(entry.match.phase)) {
      addResult(summary.postseasonRecord, entry.court.result);
    }
    if (entry.court.adjudication?.startsWith("default")) summary.defaults += 1;
    if (entry.court.adjudication === "dq_reversal") summary.dqReversals += 1;
    const personnel = personnelKey(entry.court);
    summary.personnel.set(personnel, (summary.personnel.get(personnel) ?? 0) + 1);
    summaries.set(entry.courtName, summary);
  }
  return [...summaries.values()]
    .map(summary => ({
      court: summary.court,
      record: withRecordMetrics(summary.record),
      postseasonRecord: withRecordMetrics(summary.postseasonRecord),
      defaults: summary.defaults,
      dqReversals: summary.dqReversals,
      primaryPersonnel: [...summary.personnel.entries()]
        .map(([name, appearances]) => ({ name, appearances }))
        .sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }));
}

function singlesAppearance(dataset, entry, playerName) {
  const targetJoin = joinedRating(entry.court, "target", playerName);
  const opponentName = entry.court.opponentPlayers?.[0] ?? null;
  const opponentJoin = opponentName
    ? joinedRating(entry.court, "opponent", opponentName)
    : null;
  const targetDr = historicalDr(targetJoin);
  const opponentDr = historicalDr(opponentJoin);
  const targetUtrRating = targetJoin?.utr?.singles ??
    targetJoin?.utr ??
    sourcePlayer(dataset, playerName)?.utr?.singles ??
    null;
  const opponentUtrRating = opponentJoin?.utr?.singles ??
    opponentJoin?.utr ??
    null;
  const targetUtr = joinedUtr(targetJoin, "singles") ??
    ratingValue(sourcePlayer(dataset, playerName)?.utr?.singles);
  const opponentUtr = joinedUtr(opponentJoin, "singles");
  const drMargin = comparison(targetDr, opponentDr);
  const utrMargin = comparison(targetUtr, opponentUtr);

  return {
    matchId: entry.match.id,
    date: entry.match.date,
    phase: entry.match.phase,
    postseason: isPostseason(entry.match.phase),
    opponentTeam: entry.match.opponent,
    court: entry.courtName,
    player: playerName,
    opponent: opponentName,
    result: entry.court.result,
    onCourtResult: entry.court.onCourtResult ?? entry.court.result,
    status: entry.court.status,
    score: entry.court.score,
    adjudication: entry.court.adjudication,
    scoreProfile: scoreProfile(entry.court),
    ratings: {
      dr: {
        target: targetDr,
        opponent: opponentDr,
        margin: drMargin,
        ...comparisonFlags(entry.court.result, drMargin)
      },
      singlesUtr: {
        target: targetUtr,
        opponent: opponentUtr,
        targetRating: targetUtrRating,
        opponentRating: opponentUtrRating,
        margin: utrMargin,
        ...comparisonFlags(entry.court.result, utrMargin)
      }
    }
  };
}

function playerSinglesSummary(dataset, name, appearances) {
  const player = sourcePlayer(dataset, name);
  const playerRecord = record();
  const postseasonRecord = record();
  const courtUsage = {};
  for (const appearance of appearances) {
    addResult(playerRecord, appearance.result);
    if (appearance.postseason) addResult(postseasonRecord, appearance.result);
    courtUsage[appearance.court] = (courtUsage[appearance.court] ?? 0) + 1;
  }
  const sortedCourtUsage = Object.entries(courtUsage)
    .map(([court, count]) => ({ court, appearances: count }))
    .sort((a, b) => b.appearances - a.appearances || a.court.localeCompare(b.court));
  const primaryUsage = sortedCourtUsage[0] ?? null;
  const secondaryUsage = sortedCourtUsage[1] ?? null;
  const derivedLikelyRole = primaryUsage
    ? secondaryUsage
      ? `${primaryUsage.court} primary / ${secondaryUsage.court} option`
      : `${primaryUsage.court} ${
        primaryUsage.appearances >= 3
          ? "regular"
          : primaryUsage.appearances === 2 ? "rotation" : "option"
      }`
    : "No recorded singles role";
  const lowerDrWins = appearances.filter(item => item.ratings.dr.lowerRatedWin);
  const lowerUtrWins = appearances.filter(item => item.ratings.singlesUtr.lowerRatedWin);
  const favoriteDrLosses = appearances.filter(item => item.ratings.dr.favoriteLoss);
  const favoriteUtrLosses = appearances.filter(item => item.ratings.singlesUtr.favoriteLoss);

  return {
    name,
    dr: player?.dr ?? null,
    singlesUtr: player?.utr?.singles ?? null,
    sourceLikelyRole: player?.likelyRole ?? null,
    likelyRole: player?.likelyRole ?? derivedLikelyRole,
    record: withRecordMetrics(playerRecord),
    postseasonRecord: withRecordMetrics(postseasonRecord),
    courtUsage: sortedCourtUsage,
    primaryCourt: sortedCourtUsage[0]?.court ?? null,
    comparisonMetrics: {
      completeDrComparisons: appearances.filter(item =>
        Number.isFinite(item.ratings.dr.margin)
      ).length,
      lowerDrWins: lowerDrWins.length,
      largestLowerDrWin: lowerDrWins
        .sort((a, b) => a.ratings.dr.margin - b.ratings.dr.margin)[0] ?? null,
      favoriteDrLosses: favoriteDrLosses.length,
      largestFavoriteDrLoss: favoriteDrLosses
        .sort((a, b) => b.ratings.dr.margin - a.ratings.dr.margin)[0] ?? null,
      completeUtrComparisons: appearances.filter(item =>
        Number.isFinite(item.ratings.singlesUtr.margin)
      ).length,
      lowerUtrWins: lowerUtrWins.length,
      largestLowerUtrWin: lowerUtrWins
        .sort((a, b) => a.ratings.singlesUtr.margin - b.ratings.singlesUtr.margin)[0] ?? null,
      favoriteUtrLosses: favoriteUtrLosses.length,
      largestFavoriteUtrLoss: favoriteUtrLosses
        .sort((a, b) => b.ratings.singlesUtr.margin - a.ratings.singlesUtr.margin)[0] ?? null
    },
    appearances
  };
}

function matchStacking(entries, discipline, targetTeamName) {
  const byMatch = new Map();
  for (const entry of entries) {
    const targetJoins = entry.court.targetPlayers.map(name =>
      joinedRating(entry.court, "target", name)
    );
    const opponentJoins = entry.court.opponentPlayers.map(name =>
      joinedRating(entry.court, "opponent", name)
    );
    const targetAverageDr = average(targetJoins.map(matchPageDr)) ??
      ratingTextValue(entry.court.ratingsText, "target", "DR");
    const targetAverageUtr = average(
      targetJoins.map(join => joinedUtr(join, discipline))
    ) ?? ratingTextValue(entry.court.ratingsText, "target", "UTR");
    const opponentAverageDr = average(opponentJoins.map(matchPageDr)) ??
      ratingTextValue(entry.court.ratingsText, "opponent", "DR");
    const opponentAverageUtr = average(
      opponentJoins.map(join => joinedUtr(join, discipline))
    ) ?? ratingTextValue(entry.court.ratingsText, "opponent", "UTR");
    const line = {
      court: entry.courtName,
      result: entry.court.result,
      score: entry.court.score ?? null,
      adjudication: entry.court.adjudication ?? null,
      targetPlayers: entry.court.targetPlayers,
      opponentPlayers: entry.court.opponentPlayers,
      averageDr: round(targetAverageDr),
      averageUtr: round(targetAverageUtr),
      opponentAverageDr: round(opponentAverageDr),
      opponentAverageUtr: round(opponentAverageUtr)
    };
    const item = byMatch.get(entry.match.id) ?? {
      matchId: entry.match.id,
      date: entry.match.date,
      phase: entry.match.phase,
      targetTeamName,
      opponentTeam: entry.match.opponent,
      officialTeamResult: entry.match.officialTeamResult ?? null,
      sourceRead: entry.match.stackingRead?.[discipline] ?? null,
      lines: []
    };
    item.lines.push(line);
    byMatch.set(entry.match.id, item);
  }
  return [...byMatch.values()].map(item => {
    const byDr = item.lines.filter(line => Number.isFinite(line.averageDr))
      .sort((a, b) => b.averageDr - a.averageDr);
    const byUtr = item.lines.filter(line => Number.isFinite(line.averageUtr))
      .sort((a, b) => b.averageUtr - a.averageUtr);
    return {
      ...item,
      strongestCourtByDr: byDr[0]?.court ?? null,
      strongestCourtByUtr: byUtr[0]?.court ?? null
    };
  });
}

export function analyzeSingles(dataset) {
  requireDataset(dataset);
  const entries = courtEntries(dataset, "S");
  const appearances = entries.flatMap(entry =>
    entry.court.targetPlayers.map(name => singlesAppearance(dataset, entry, name))
  );
  const byPlayer = new Map();
  for (const appearance of appearances) {
    const items = byPlayer.get(appearance.player) ?? [];
    items.push(appearance);
    byPlayer.set(appearance.player, items);
  }
  const players = [...byPlayer.entries()]
    .map(([name, items]) => playerSinglesSummary(dataset, name, items))
    .sort((a, b) =>
      b.record.decisions - a.record.decisions ||
      (b.dr ?? -Infinity) - (a.dr ?? -Infinity) ||
      a.name.localeCompare(b.name)
    );
  const overallRecord = record();
  appearances.forEach(item => addResult(overallRecord, item.result));

  return {
    summary: {
      record: withRecordMetrics(overallRecord),
      playersUsed: players.length,
      matchesAnalyzed: new Set(appearances.map(item => item.matchId)).size,
      lowerDrWins: appearances.filter(item => item.ratings.dr.lowerRatedWin).length,
      favoriteDrLosses: appearances.filter(item => item.ratings.dr.favoriteLoss).length,
      lowerUtrWins: appearances.filter(item =>
        item.ratings.singlesUtr.lowerRatedWin
      ).length,
      favoriteUtrLosses: appearances.filter(item =>
        item.ratings.singlesUtr.favoriteLoss
      ).length
    },
    courts: courtSummaries(entries, court => court.targetPlayers.join(" + ")),
    players,
    matchStacking: matchStacking(entries, "singles", dataset.team.name)
  };
}

function pairKey(names) {
  return [...names].sort((a, b) => a.localeCompare(b)).join(" + ");
}

function pairRatings(dataset, court, side, names) {
  const joins = names.map(name => joinedRating(court, side, name));
  const drValues = joins.map(historicalDr);
  const utrValues = joins.map(join => joinedUtr(join, "doubles"));
  return {
    dr: {
      average: round(average(drValues)),
      values: names.map((name, index) => ({
        name,
        value: drValues[index],
        evidenceType: joins[index]?.historicalDr?.evidenceType ?? null
      })),
      complete: drValues.every(Number.isFinite)
    },
    doublesUtr: {
      average: round(average(utrValues)),
      values: names.map((name, index) => ({
        name,
        value: utrValues[index],
        sourceRating: side === "target"
          ? sourcePlayer(dataset, name)?.utr?.doubles ?? null
          : joins[index]?.utr?.doubles ?? joins[index]?.utr ?? null
      })),
      complete: utrValues.every(Number.isFinite)
    }
  };
}

function doublesAppearance(dataset, entry) {
  const targetPlayers = entry.court.targetPlayers ?? [];
  const opponentPlayers = entry.court.opponentPlayers ?? [];
  const targetRatings = pairRatings(dataset, entry.court, "target", targetPlayers);
  const opponentRatings = pairRatings(dataset, entry.court, "opponent", opponentPlayers);
  const drMargin = comparison(targetRatings.dr.average, opponentRatings.dr.average);
  const utrMargin = comparison(
    targetRatings.doublesUtr.average,
    opponentRatings.doublesUtr.average
  );
  return {
    matchId: entry.match.id,
    date: entry.match.date,
    phase: entry.match.phase,
    postseason: isPostseason(entry.match.phase),
    opponentTeam: entry.match.opponent,
    court: entry.courtName,
    pair: pairKey(targetPlayers),
    players: [...targetPlayers].sort((a, b) => a.localeCompare(b)),
    opponentPair: pairKey(opponentPlayers),
    opponentPlayers: [...opponentPlayers].sort((a, b) => a.localeCompare(b)),
    result: entry.court.result,
    onCourtResult: entry.court.onCourtResult ?? entry.court.result,
    status: entry.court.status,
    score: entry.court.score,
    adjudication: entry.court.adjudication,
    scoreProfile: scoreProfile(entry.court),
    ratings: {
      target: targetRatings,
      opponent: opponentRatings,
      drComparison: {
        margin: drMargin,
        ...comparisonFlags(entry.court.result, drMargin)
      },
      doublesUtrComparison: {
        margin: utrMargin,
        ...comparisonFlags(entry.court.result, utrMargin)
      }
    }
  };
}

function doublesPairSummary(dataset, name, appearances) {
  const pairRecord = record();
  const postseasonRecord = record();
  const courts = {};
  for (const appearance of appearances) {
    addResult(pairRecord, appearance.result);
    if (appearance.postseason) addResult(postseasonRecord, appearance.result);
    courts[appearance.court] = (courts[appearance.court] ?? 0) + 1;
  }
  const players = appearances[0]?.players ?? [];
  const currentDrValues = players.map(name => sourcePlayer(dataset, name)?.dr ?? null);
  const currentUtrRatings = players.map(name =>
    sourcePlayer(dataset, name)?.utr?.doubles ?? null
  );
  const currentUtrValues = currentUtrRatings.map(ratingValue);
  const lowerDrWins = appearances.filter(item =>
    item.ratings.drComparison.lowerRatedWin
  );
  const lowerUtrWins = appearances.filter(item =>
    item.ratings.doublesUtrComparison.lowerRatedWin
  );
  const favoriteDrLosses = appearances.filter(item =>
    item.ratings.drComparison.favoriteLoss
  );
  const favoriteUtrLosses = appearances.filter(item =>
    item.ratings.doublesUtrComparison.favoriteLoss
  );

  return {
    pair: name,
    players,
    appearances: appearances.length,
    repeatedPair: appearances.length >= 2,
    courts: Object.entries(courts)
      .map(([court, count]) => ({ court, appearances: count }))
      .sort((a, b) => b.appearances - a.appearances || a.court.localeCompare(b.court)),
    record: withRecordMetrics(pairRecord),
    postseasonRecord: withRecordMetrics(postseasonRecord),
    currentRatings: {
      drAverage: round(average(currentDrValues)),
      doublesUtrAverage: round(average(currentUtrValues)),
      doublesUtrComplete: currentUtrValues.every(Number.isFinite),
      players: players.map((player, index) => ({
        name: player,
        dr: currentDrValues[index],
        doublesUtr: currentUtrRatings[index]
      }))
    },
    comparisonMetrics: {
      completeDrComparisons: appearances.filter(item =>
        Number.isFinite(item.ratings.drComparison.margin)
      ).length,
      lowerDrWins: lowerDrWins.length,
      largestLowerDrWin: lowerDrWins
        .sort((a, b) =>
          a.ratings.drComparison.margin - b.ratings.drComparison.margin
        )[0] ?? null,
      favoriteDrLosses: favoriteDrLosses.length,
      largestFavoriteDrLoss: favoriteDrLosses
        .sort((a, b) =>
          b.ratings.drComparison.margin - a.ratings.drComparison.margin
        )[0] ?? null,
      completeUtrComparisons: appearances.filter(item =>
        Number.isFinite(item.ratings.doublesUtrComparison.margin)
      ).length,
      lowerUtrWins: lowerUtrWins.length,
      largestLowerUtrWin: lowerUtrWins
        .sort((a, b) =>
          a.ratings.doublesUtrComparison.margin -
          b.ratings.doublesUtrComparison.margin
        )[0] ?? null,
      favoriteUtrLosses: favoriteUtrLosses.length,
      largestFavoriteUtrLoss: favoriteUtrLosses
        .sort((a, b) =>
          b.ratings.doublesUtrComparison.margin -
          a.ratings.doublesUtrComparison.margin
        )[0] ?? null
    },
    matchHistory: appearances
  };
}

export function analyzeDoubles(dataset) {
  requireDataset(dataset);
  const entries = courtEntries(dataset, "D");
  const appearances = entries.map(entry => doublesAppearance(dataset, entry));
  const byPair = new Map();
  for (const appearance of appearances) {
    const items = byPair.get(appearance.pair) ?? [];
    items.push(appearance);
    byPair.set(appearance.pair, items);
  }
  const pairs = [...byPair.entries()]
    .map(([name, items]) => doublesPairSummary(dataset, name, items))
    .sort((a, b) =>
      b.appearances - a.appearances ||
      b.record.winRate - a.record.winRate ||
      a.pair.localeCompare(b.pair)
    );
  const overallRecord = record();
  appearances.forEach(item => addResult(overallRecord, item.result));

  return {
    summary: {
      record: withRecordMetrics(overallRecord),
      uniquePairs: pairs.length,
      matchesAnalyzed: new Set(appearances.map(item => item.matchId)).size,
      repeatedPairs: pairs.filter(pair => pair.repeatedPair).length,
      oneOffPairs: pairs.filter(pair => !pair.repeatedPair).length,
      pairsWithIncompleteCurrentUtr: pairs.filter(pair =>
        !pair.currentRatings.doublesUtrComplete
      ).length,
      lowerDrWins: appearances.filter(item =>
        item.ratings.drComparison.lowerRatedWin
      ).length,
      favoriteDrLosses: appearances.filter(item =>
        item.ratings.drComparison.favoriteLoss
      ).length,
      lowerUtrWins: appearances.filter(item =>
        item.ratings.doublesUtrComparison.lowerRatedWin
      ).length,
      favoriteUtrLosses: appearances.filter(item =>
        item.ratings.doublesUtrComparison.favoriteLoss
      ).length
    },
    courts: courtSummaries(entries, court => pairKey(court.targetPlayers)),
    repeatedPairs: pairs.filter(pair => pair.repeatedPair),
    oneOffPairs: pairs.filter(pair => !pair.repeatedPair),
    pairs,
    matchStacking: matchStacking(entries, "doubles", dataset.team.name)
  };
}

function lineupCourtOrder(a, b) {
  const disciplineA = a.startsWith("S") ? 0 : 1;
  const disciplineB = b.startsWith("S") ? 0 : 1;
  return disciplineA - disciplineB ||
    a.localeCompare(b, undefined, { numeric: true });
}

function lineupPlayers(courtName, court) {
  const players = [...(court.targetPlayers ?? [])];
  return courtName.startsWith("D")
    ? players.sort((a, b) => a.localeCompare(b))
    : players;
}

function lineupCandidateKey(players) {
  return JSON.stringify(players);
}

function datasetLeagueFormat(dataset) {
  if (dataset.team?.leagueFormat === "mixed") return "mixed";
  if (dataset.team?.leagueFormat === "single_gender") return "single_gender";
  return /\bmixed\b|\bX\s*\d(?:\.\d)?\b/i.test(
    `${dataset.team?.section ?? ""} ${dataset.team?.league ?? ""}`
  )
    ? "mixed"
    : "single_gender";
}

function mixedPairIsValid(dataset, courtName, players) {
  if (
    datasetLeagueFormat(dataset) !== "mixed" ||
    !courtName.startsWith("D") ||
    players.length !== 2
  ) {
    return true;
  }
  const genders = players.map(name =>
    dataset.roster.find(player => player.name === name)?.gender ?? "Unknown"
  );
  if (genders.includes("Unknown")) return true;
  return new Set(genders).size === 2 &&
    genders.includes("Men") &&
    genders.includes("Women");
}

function lineupCourtCandidates(dataset, eligibleNames) {
  const matches = [...dataset.matches].sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? "") ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
  const lastMatchIndex = Math.max(matches.length - 1, 1);
  const byCourt = new Map();

  matches.forEach((match, index) => {
    const recencyWeight = 1 + (index / lastMatchIndex) * 0.5;
    const phaseWeight = isPostseason(match.phase) ? 1.5 : 1;
    for (const [courtName, court] of Object.entries(match.courts ?? {})) {
      const players = lineupPlayers(courtName, court);
      if (
        !players.length ||
        players.some(name => !eligibleNames.has(name)) ||
        !mixedPairIsValid(dataset, courtName, players)
      ) {
        continue;
      }
      const courtCandidates = byCourt.get(courtName) ?? new Map();
      const key = lineupCandidateKey(players);
      const candidate = courtCandidates.get(key) ?? {
        court: courtName,
        players,
        appearances: 0,
        postseasonAppearances: 0,
        record: record(),
        lastUsedDate: null,
        weightedUsage: 0
      };
      candidate.appearances += 1;
      if (isPostseason(match.phase)) candidate.postseasonAppearances += 1;
      addResult(candidate.record, court.result);
      if (!candidate.lastUsedDate || match.date > candidate.lastUsedDate) {
        candidate.lastUsedDate = match.date;
      }
      candidate.weightedUsage += recencyWeight * phaseWeight;
      courtCandidates.set(key, candidate);
      byCourt.set(courtName, courtCandidates);
    }
  });

  return new Map([...byCourt.entries()].map(([courtName, courtCandidates]) => {
    const candidates = [...courtCandidates.values()]
      .map(candidate => ({
        ...candidate,
        record: withRecordMetrics(candidate.record),
        weightedUsage: round(candidate.weightedUsage)
      }))
      .sort((a, b) =>
        b.weightedUsage - a.weightedUsage ||
        b.appearances - a.appearances ||
        b.record.winRate - a.record.winRate ||
        (b.lastUsedDate ?? "").localeCompare(a.lastUsedDate ?? "") ||
        a.players.join(" + ").localeCompare(b.players.join(" + "))
      )
      .slice(0, 8);
    const totalWeight = candidates.reduce(
      (sum, candidate) => sum + candidate.weightedUsage,
      0
    );
    return [courtName, candidates.map(candidate => ({
      ...candidate,
      usageShare: totalWeight ? candidate.weightedUsage / totalWeight : 0
    }))];
  }));
}

function observedLineupCount(dataset, lines) {
  return dataset.matches.filter(match =>
    lines.every(line => {
      const court = match.courts?.[line.court];
      return court &&
        lineupCandidateKey(lineupPlayers(line.court, court)) ===
          lineupCandidateKey(line.players);
    })
  ).length;
}

export function analyzeLineupPredictions(dataset, eligibility) {
  requireDataset(dataset);
  const leagueFormat = datasetLeagueFormat(dataset);
  const methodology = leagueFormat === "mixed"
    ? "Court choices are weighted by frequency, recency, and postseason use. Mixed doubles pairs require one men’s and one women’s player when both player genders are known. Predicted lineups cannot assign one player to multiple courts."
    : "Court choices are weighted by frequency, recency, and postseason use. Predicted lineups cannot assign one player to multiple courts.";
  const eligibilityAnalysis = eligibility ?? analyzeEligibility(dataset);
  const eligibleNames = new Set(
    eligibilityAnalysis.players
      .filter(player => player.status === "eligible")
      .map(player => player.name)
  );
  const candidatesByCourt = lineupCourtCandidates(dataset, eligibleNames);
  const courts = [...candidatesByCourt.keys()].sort(lineupCourtOrder);
  if (!courts.length) {
    return {
      summary: {
        predictionsGenerated: 0,
        matchesAnalyzed: dataset.matches.length,
        courts,
        leagueFormat,
        eligiblePlayers: eligibleNames.size,
        excludedPlayers: eligibilityAnalysis.players.length - eligibleNames.size
      },
      methodology,
      predictions: []
    };
  }
  let beam = [{
    lines: [],
    usedPlayers: new Set(),
    logLikelihood: 0
  }];

  for (const court of courts) {
    const candidates = candidatesByCourt.get(court) ?? [];
    const expanded = [];
    for (const partial of beam) {
      for (const candidate of candidates) {
        if (candidate.players.some(player => partial.usedPlayers.has(player))) continue;
        expanded.push({
          lines: [...partial.lines, candidate],
          usedPlayers: new Set([...partial.usedPlayers, ...candidate.players]),
          logLikelihood: partial.logLikelihood +
            Math.log(Math.max(candidate.usageShare, Number.EPSILON))
        });
      }
    }
    beam = expanded
      .sort((a, b) =>
        b.logLikelihood - a.logLikelihood ||
        a.lines.map(line => line.players.join(" + ")).join("|")
          .localeCompare(b.lines.map(line => line.players.join(" + ")).join("|"))
      )
      .slice(0, 250);
    if (!beam.length) break;
  }

  const ranked = beam
    .filter(item => item.lines.length === courts.length)
    .map(item => {
      const observedTogether = observedLineupCount(dataset, item.lines);
      return {
        ...item,
        observedTogether,
        rankingScore: item.logLikelihood + Math.log1p(observedTogether) * 0.5
      };
    })
    .sort((a, b) =>
      b.rankingScore - a.rankingScore ||
      b.observedTogether - a.observedTogether ||
      a.lines.map(line => line.players.join(" + ")).join("|")
        .localeCompare(b.lines.map(line => line.players.join(" + ")).join("|"))
    )
    .slice(0, 3);

  const predictions = ranked.map((item, index) => {
    const historicalSupport = item.lines.length
      ? round(
        item.lines.reduce((sum, line) => sum + line.usageShare, 0) /
          item.lines.length * 100,
        0
      )
      : 0;
    const confidence = historicalSupport >= 35
      ? "high"
      : historicalSupport >= 20 ? "medium" : "emerging";
    return {
      rank: index + 1,
      confidence,
      historicalSupport,
      observedTogether: item.observedTogether,
      evidence: {
        totalCourtAppearances: item.lines.reduce(
          (sum, line) => sum + line.appearances,
          0
        ),
        postseasonCourtAppearances: item.lines.reduce(
          (sum, line) => sum + line.postseasonAppearances,
          0
        )
      },
      lines: item.lines.map(line => ({
        court: line.court,
        players: line.players,
        appearances: line.appearances,
        postseasonAppearances: line.postseasonAppearances,
        record: line.record,
        lastUsedDate: line.lastUsedDate,
        usageShare: round(line.usageShare)
      }))
    };
  });

  return {
    summary: {
      predictionsGenerated: predictions.length,
      matchesAnalyzed: dataset.matches.length,
      courts,
      leagueFormat,
      eligiblePlayers: eligibleNames.size,
      excludedPlayers: eligibilityAnalysis.players.length - eligibleNames.size
    },
    methodology,
    predictions
  };
}

function teamSummary(dataset) {
  const teamRecord = record();
  const courtRecord = record();
  const phases = {};
  for (const match of dataset.matches) {
    const result = match.officialTeamResult?.result ?? match.teamResult?.result ?? "U";
    addResult(teamRecord, result);
    const phase = phases[match.phase] ?? {
      matches: 0,
      teamRecord: record(),
      courtRecord: record()
    };
    phase.matches += 1;
    addResult(phase.teamRecord, result);
    for (const court of Object.values(match.courts ?? {})) {
      addResult(courtRecord, court.result);
      addResult(phase.courtRecord, court.result);
    }
    phases[match.phase] = phase;
  }
  return {
    rosterSize: dataset.roster.length,
    matches: dataset.matches.length,
    teamRecord: withRecordMetrics(teamRecord),
    courtRecord: withRecordMetrics(courtRecord),
    phases: Object.fromEntries(Object.entries(phases).map(([phase, value]) => [
      phase,
      {
        matches: value.matches,
        teamRecord: withRecordMetrics(value.teamRecord),
        courtRecord: withRecordMetrics(value.courtRecord)
      }
    ]))
  };
}

export function analyzeTeam(dataset, options = {}) {
  requireDataset(dataset);
  const eligibilityScope = options.eligibilityScope ?? "national";
  const finalReportReady = dataset.collectionStage === "step_1_complete";
  const warnings = [];
  if (!finalReportReady) {
    warnings.push(
      `Dataset stage ${dataset.collectionStage ?? "unknown"} supports preliminary analysis only.`
    );
  }
  if (dataset.dataQuality?.coverage?.warning) {
    warnings.push(dataset.dataQuality.coverage.warning);
  }
  const leagueFormat = datasetLeagueFormat(dataset);
  if (leagueFormat === "mixed") {
    const unknownGenderCount = dataset.roster.filter(
      player => !["Men", "Women"].includes(player.gender)
    ).length;
    if (unknownGenderCount) {
      warnings.push(
        `${unknownGenderCount} mixed-league player gender${unknownGenderCount === 1 ? " is" : "s are"} unresolved; observed pairs remain available, but gender validation is limited.`
      );
    }
  }
  for (const limitation of dataset.dataQuality?.limitations ?? []) {
    warnings.push(limitation);
  }
  const eligibility = analyzeEligibility(dataset, eligibilityScope);
  if (eligibility.dataQualityIssues.length) {
    warnings.push(
      `${eligibility.dataQualityIssues.length} player appearance count(s) differ from the match ledger; see eligibility.dataQualityIssues.`
    );
  }

  return {
    analysisVersion: ANALYSIS_VERSION,
    generatedAt: new Date().toISOString(),
    dataset: {
      datasetId: dataset.datasetId,
      schemaVersion: dataset.schemaVersion,
      generatedAt: dataset.generatedAt,
      collectionStage: dataset.collectionStage,
      finalReportReady
    },
    team: {
      ...dataset.team,
      leagueFormat,
      gender: leagueFormat === "mixed" ? "Mixed" : dataset.team.gender
    },
    summary: teamSummary(dataset),
    eligibility,
    singles: analyzeSingles(dataset),
    doubles: analyzeDoubles(dataset),
    lineupPredictions: analyzeLineupPredictions(dataset, eligibility),
    disclosures: {
      warnings: [...new Set(warnings)],
      sources: dataset.sources ?? [],
      dataQuality: dataset.dataQuality ?? {}
    }
  };
}
