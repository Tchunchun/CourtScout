import { locationScore, normalizeName } from "./ratings.mjs";

export function visibleCurrentUtrRatings(text) {
  return [...String(text ?? "").matchAll(
    /\bUTR\s+([0-9]+\.[0-9]+)\s+([0-9]+)%\s+Reliable\b/gi
  )].map(match => ({
    value: Number(match[1]),
    reliability: Number(match[2])
  }));
}

export function exactRatingsNotVisibleError(name) {
  const error = new Error(
    `UTR exact ratings were not visible for ${name}; ` +
    "confirm the signed-in account can view full ratings"
  );
  error.code = "UTR_EXACT_RATINGS_NOT_VISIBLE";
  return error;
}

export function isExactRatingsNotVisibleError(error) {
  return error?.code === "UTR_EXACT_RATINGS_NOT_VISIBLE";
}

export function utrSearchExpression(name) {
  const encodedName = encodeURIComponent(name);
  const searchUrl =
    `https://api.utrsports.net/v2/search/players?top=20&skip=0&query=${encodedName}` +
    "&showTennisContent=true";
  return `fetch(${JSON.stringify(searchUrl)})` +
    `.then(async r=>JSON.stringify({status:r.status,retryAfter:r.headers.get('retry-after'),` +
    `hits:r.ok?(await r.json()).hits||[]:[]}))`;
}

export function cacheKey(name, locations) {
  return `${normalizeName(name)}|${locations.map(value => value.toLowerCase()).sort().join("|")}`;
}

export function candidateFromPublicRating(name, rating) {
  if (
    rating?.lookupStatus !== "public_profile_resolved" ||
    rating.profileCandidate?.playerId == null
  ) {
    return null;
  }
  return {
    id: rating.profileCandidate.playerId,
    name,
    location: rating.profileCandidate.location ?? null,
    singlesStatus: rating.singles?.status ?? null,
    doublesStatus: rating.doubles?.status ?? null,
    singlesReliability: rating.singles?.reliability ?? null,
    doublesReliability: rating.doubles?.reliability ?? null
  };
}

export function chooseCandidate(
  name,
  locations,
  candidates,
  acceptAmbiguous = false,
  gender = "Female"
) {
  const exact = candidates
    .filter(candidate =>
      normalizeName(candidate.name) === normalizeName(name) &&
      (!gender || candidate.gender === gender)
    )
    .map(candidate => ({
      ...candidate,
      identityScore: Math.max(
        0,
        ...locations.map(location => locationScore(candidate.location, location))
      ) + (candidate.singlesStatus !== "Unrated" ? 2 : 0) +
        (candidate.doublesStatus !== "Unrated" ? 2 : 0)
    }))
    .sort((left, right) => right.identityScore - left.identityScore);

  if (!exact.length) {
    return { status: "unresolved_no_exact_profile", candidate: null, candidates: [] };
  }

  const tied = exact.filter(candidate => candidate.identityScore === exact[0].identityScore);
  const locationMatched = exact[0].identityScore >= 10;
  if (!acceptAmbiguous && tied.length > 1 && !locationMatched) {
    return {
      status: "unresolved_ambiguous_profiles",
      candidate: null,
      candidates: exact
    };
  }

  return {
    status: "candidate_selected",
    candidate: exact[0],
    candidates: exact
  };
}

export function updateCourtJoins(dataset) {
  const roster = new Map(dataset.roster.map(player => [player.name, player]));
  const opponents = new Map(dataset.opponents.map(player => [player.name, player]));

  for (const match of dataset.matches) {
    for (const court of Object.values(match.courts)) {
      court.targetRatings = court.targetPlayers.map(name => {
        const existing = court.targetRatings.find(item => item.name === name) ?? { name };
        const player = roster.get(name);
        return {
          ...existing,
          dr: player?.dr ?? null,
          utr: player?.utr ?? null,
          wtn: player?.wtn ?? null
        };
      });
      court.opponentRatings = court.opponentPlayers.map(name => {
        const existing = court.opponentRatings.find(item => item.name === name) ?? { name };
        const player = opponents.get(name);
        const joined = {
          ...existing,
          currentDr: player?.dr ?? null,
          locations: player?.locations ?? [],
          utr: player?.utr ?? null
        };
        if (player?.wtn) joined.wtn = player.wtn;
        else delete joined.wtn;
        return joined;
      });
    }
  }
}

export function hasCompleteExactRatings(rating) {
  if (!rating || rating.lookupStatus !== "authenticated_exact_profile_resolved") {
    return false;
  }
  return ["singles", "doubles"].every(type => {
    const value = rating[type];
    return value?.status === "Unrated" || value?.exactValue != null;
  });
}
