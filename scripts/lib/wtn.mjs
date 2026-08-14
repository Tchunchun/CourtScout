import { emptyRating, locationScore, normalizeName } from "./ratings.mjs";

export function wtnRating(value, confidence) {
  if (!Number.isFinite(value)) {
    return {
      ...emptyRating("unrated"),
      reliability: confidence ?? null
    };
  }

  return {
    value,
    exactValue: value,
    display: value.toFixed(1),
    status: "rated",
    reliability: confidence ?? null
  };
}

export function emptyWtn(status = "not_started") {
  return {
    lookupStatus: status,
    profileCandidate: null,
    singles: emptyRating(status),
    doubles: emptyRating(status),
    retrievedAt: null
  };
}

function ratingByType(numbers, type) {
  const rating = numbers?.find(item => item.type === type);
  return {
    value: Number.isFinite(rating?.tennisNumber) ? rating.tennisNumber : null,
    confidence: rating?.confidence ?? null
  };
}

export function mapWtnCandidates(payload) {
  return (payload.data?.publicPersons?.items ?? []).map(person => {
    const locations = (person.addresses ?? [])
      .map(address => [address.city, address.state].filter(Boolean).join(", "))
      .filter(Boolean);
    return {
      id: person.id,
      tennisId: person.tennisID,
      name: [person.nativeGivenName, person.nativeFamilyName].filter(Boolean).join(" "),
      gender: person.sex === "F" ? "Female" : person.sex === "M" ? "Male" : null,
      nationalityCode: person.nationalityCode ?? null,
      age: person.age ?? null,
      birthYear: person.birthYear ?? null,
      locations,
      singles: ratingByType(person.worldTennisNumbers, "SINGLE"),
      doubles: ratingByType(person.worldTennisNumbers, "DOUBLE")
    };
  });
}

export function chooseWtnCandidate(
  name,
  locations,
  candidates,
  gender = "Female"
) {
  const exact = candidates
    .filter(candidate =>
      normalizeName(candidate.name) === normalizeName(name) &&
      (!gender || candidate.gender === gender)
    )
    .map(candidate => {
      const identityLocationScore = Math.max(
        0,
        ...candidate.locations.flatMap(candidateLocation =>
          locations.map(location => locationScore(candidateLocation, location))
        )
      );
      return {
        ...candidate,
        identityLocationScore,
        ratingCoverageScore:
          (candidate.singles.value != null ? 2 : 0) +
          (candidate.doubles.value != null ? 2 : 0)
      };
    })
    .sort((left, right) =>
      right.identityLocationScore - left.identityLocationScore ||
      right.ratingCoverageScore - left.ratingCoverageScore
    );

  if (!exact.length) {
    return {
      status: "unresolved_no_exact_profile",
      candidate: null,
      candidates: []
    };
  }

  const locationTied = exact.filter(candidate =>
    candidate.identityLocationScore === exact[0].identityLocationScore
  );
  if (exact.length > 1 && (
    exact[0].identityLocationScore === 0 ||
    locationTied.length > 1
  )) {
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

export function resolvedWtn(candidate, retrievedAt = new Date()) {
  return {
    lookupStatus: "public_profile_resolved",
    profileCandidate: {
      playerId: candidate.id,
      tennisId: candidate.tennisId,
      locations: candidate.locations,
      nationalityCode: candidate.nationalityCode,
      age: candidate.age,
      birthYear: candidate.birthYear
    },
    singles: wtnRating(candidate.singles.value, candidate.singles.confidence),
    doubles: wtnRating(candidate.doubles.value, candidate.doubles.confidence),
    retrievedAt: retrievedAt.toISOString().slice(0, 10)
  };
}

export function unresolvedWtn(selection, retrievedAt = new Date()) {
  return {
    ...emptyWtn(selection.status),
    candidates: selection.candidates,
    retrievedAt: retrievedAt.toISOString().slice(0, 10)
  };
}
