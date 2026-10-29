// The opponent threat board: who is likely to play and how strong they are,
// the pairs they trust, whether they stack their courts, and where the
// predictions rest on thin evidence. Built from a dataset and its saved
// analysis; it reads and never changes either.

const STATUS_ORDER = { eligible: 0, unknown: 1, ineligible: 2, unavailable: 3 };
const STALE_RATING_DAYS = 30;
const TOP_PREDICTIONS = 3;
const TOP_PAIRS = 6;
// Fewer compared matches than this say nothing about stacking.
const STACKING_MIN_MATCHES = 4;

function courtOrder(court) {
  const match = /^([SD])(\d+)$/.exec(court ?? "");
  return match ? (match[1] === "S" ? 0 : 100) + Number(match[2]) : 1000;
}

function daysBetween(date, today) {
  const then = Date.parse(date?.length === 10 ? `${date}T00:00:00Z` : date);
  return Number.isFinite(then)
    ? Math.max(0, Math.floor((today.getTime() - then) / 86_400_000))
    : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function ratingView(rating) {
  return {
    display: rating?.display ?? "NR",
    value: finite(rating?.value),
    exact: Number.isFinite(rating?.exactValue)
  };
}

/** Exact when UTR showed decimals, public when only a masked band. */
function utrView(rosterUtr, today) {
  const singles = ratingView(rosterUtr?.singles);
  const doubles = ratingView(rosterUtr?.doubles);
  const rated = singles.value != null || doubles.value != null;
  return {
    singles,
    doubles,
    source: !rated ? "none" : singles.exact || doubles.exact ? "exact" : "public",
    retrievedAt: rosterUtr?.retrievedAt ?? null,
    ageDays: daysBetween(rosterUtr?.retrievedAt, today)
  };
}

function strength(player) {
  return player.dr ?? player.utr.doubles.value ?? player.utr.singles.value ?? -Infinity;
}

function boardPlayers(dataset, analysis, today) {
  const roster = new Map((dataset.roster ?? []).map(player => [player.name, player]));
  return (analysis.eligibility?.players ?? [])
    .map(player => {
      const usage = player.localCourtUsage?.length
        ? player.localCourtUsage
        : player.courtUsage ?? [];
      return {
        name: player.name,
        gender: roster.get(player.name)?.gender ?? null,
        status: player.status,
        available: player.status === "eligible",
        role: player.role ?? null,
        note: player.standoutNote ?? null,
        usualCourts: usage.slice(0, 2).map(item => item.court),
        appearances: player.actualMatches ?? 0,
        postseasonAppearances: player.postseasonAppearances ?? 0,
        singles: player.local?.singles ?? null,
        doubles: player.local?.doubles ?? null,
        dr: finite(player.dr),
        utr: utrView(roster.get(player.name)?.utr, today),
        partner: player.primaryPartner ?? null
      };
    })
    .sort((a, b) =>
      (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4) ||
      strength(b) - strength(a) ||
      a.name.localeCompare(b.name)
    );
}

function boardPairs(analysis) {
  return (analysis.doubles?.repeatedPairs ?? [])
    .map(pair => ({
      players: pair.players,
      appearances: pair.appearances,
      // Most-used court first.
      courts: (pair.courts ?? []).map(item => item.court),
      record: pair.record,
      drAverage: finite(pair.currentRatings?.drAverage)
    }))
    .sort((a, b) => b.appearances - a.appearances || (b.drAverage ?? 0) - (a.drAverage ?? 0))
    .slice(0, TOP_PAIRS);
}

/**
 * Whether the opponent puts its highest-rated player or pair on the top
 * court, from matches where at least two courts have a known DR.
 */
function stackingRead(matches, discipline) {
  const compared = (matches ?? [])
    .map(match => {
      const rated = match.lines.filter(line => Number.isFinite(line.averageDr));
      if (rated.length < 2) return null;
      const topCourt = [...rated].sort((a, b) => courtOrder(a.court) - courtOrder(b.court))[0].court;
      return { topCourt, strongestCourt: match.strongestCourtByDr };
    })
    .filter(Boolean);
  if (!compared.length) return null;
  const onTop = compared.filter(item => item.strongestCourt === item.topCourt).length;
  const elsewhere = new Map();
  for (const item of compared) {
    if (item.strongestCourt !== item.topCourt) {
      elsewhere.set(item.strongestCourt, (elsewhere.get(item.strongestCourt) ?? 0) + 1);
    }
  }
  const usualElsewhere = [...elsewhere.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topCourt = compared[0].topCourt;
  const unit = discipline === "doubles" ? "pair" : "player";
  if (compared.length < STACKING_MIN_MATCHES) {
    return {
      discipline,
      matchesCompared: compared.length,
      strongestOnTop: onTop,
      stacks: false,
      usualStrongestCourt: null,
      note: `No clear pattern yet: only ${compared.length} ${compared.length === 1 ? "match has" : "matches have"} ${discipline} ratings on two or more courts.`
    };
  }
  const stacks = onTop / compared.length < 0.75;
  return {
    discipline,
    matchesCompared: compared.length,
    strongestOnTop: onTop,
    stacks,
    usualStrongestCourt: stacks ? usualElsewhere : topCourt,
    note: stacks
      ? `Often stacks: their highest-rated ${unit} played below ${topCourt} in ${compared.length - onTop} of ${compared.length} matches${usualElsewhere ? `, most often at ${usualElsewhere}` : ""}.`
      : `Usually in rating order: their highest-rated ${unit} played ${topCourt} in ${onTop} of ${compared.length} matches.`
  };
}

function hasPostseason(analysis) {
  return Object.keys(analysis.summary?.phases ?? {}).some(phase => phase !== "local");
}

function boardPredictions(analysis, playersByName) {
  const postseason = hasPostseason(analysis);
  return (analysis.lineupPredictions?.predictions ?? [])
    .slice(0, TOP_PREDICTIONS)
    .map(prediction => ({
      rank: prediction.rank,
      confidence: prediction.confidence,
      historicalSupport: prediction.historicalSupport,
      lines: [...prediction.lines]
        .sort((a, b) => courtOrder(a.court) - courtOrder(b.court))
        .map(line => {
          const gaps = [];
          if (postseason && !line.postseasonAppearances) {
            gaps.push("No postseason appearances on this court");
          }
          if (line.appearances <= 1) gaps.push("Seen here once");
          for (const name of line.players) {
            const player = playersByName.get(name);
            if (player && player.dr == null && player.utr.source === "none") {
              gaps.push(`No rating for ${name}`);
            }
          }
          return {
            court: line.court,
            players: line.players,
            appearances: line.appearances,
            postseasonAppearances: line.postseasonAppearances ?? 0,
            record: line.record,
            lastUsedDate: line.lastUsedDate ?? null,
            gaps
          };
        })
    }));
}

function coverageWarnings(dataset, analysis, players, today) {
  const warnings = [...(analysis.disclosures?.warnings ?? [])];
  const source = (dataset.sources ?? []).find(item => item.type === "tennisrecord");
  const age = daysBetween(source?.retrievedAt, today);
  if (age != null && age > STALE_RATING_DAYS) {
    warnings.push(`TennisRecord data is ${age} days old; refresh before match day.`);
  }
  const ratedAges = players.map(player => player.utr.ageDays).filter(days => days != null);
  const oldestUtr = ratedAges.length ? Math.max(...ratedAges) : null;
  if (oldestUtr != null && oldestUtr > STALE_RATING_DAYS) {
    warnings.push(`Some UTR ratings are ${oldestUtr} days old.`);
  }
  const publicOnly = players.filter(player => player.utr.source === "public").length;
  if (publicOnly) {
    warnings.push(`${publicOnly} ${publicOnly === 1 ? "player has" : "players have"} only a public UTR band, so close matchups are uncertain.`);
  }
  const unrated = players.filter(player => player.dr == null && player.utr.source === "none").length;
  if (unrated) {
    warnings.push(`${unrated} ${unrated === 1 ? "player has" : "players have"} no DR or UTR.`);
  }
  const unknown = players.filter(player => player.status === "unknown").length;
  if (unknown) {
    warnings.push(`Eligibility could not be confirmed for ${unknown} ${unknown === 1 ? "player" : "players"}.`);
  }
  return warnings;
}

export function buildThreatBoard({ dataset, analysis, today = new Date() }) {
  const players = boardPlayers(dataset, analysis, today);
  const playersByName = new Map(players.map(player => [player.name, player]));
  return {
    team: {
      name: analysis.team?.name ?? dataset.team?.name,
      section: analysis.team?.section ?? null,
      level: analysis.team?.level ?? null,
      leagueFormat: analysis.team?.leagueFormat ?? null
    },
    eligibility: {
      scope: analysis.eligibility?.scope ?? null,
      label: analysis.eligibility?.label ?? null
    },
    retrievedAt: (dataset.sources ?? []).find(item => item.type === "tennisrecord")?.retrievedAt ?? null,
    players,
    pairs: boardPairs(analysis),
    stacking: [
      stackingRead(analysis.doubles?.matchStacking, "doubles"),
      stackingRead(analysis.singles?.matchStacking, "singles")
    ].filter(Boolean),
    predictions: boardPredictions(analysis, playersByName),
    coverage: coverageWarnings(dataset, analysis, players, today)
  };
}
