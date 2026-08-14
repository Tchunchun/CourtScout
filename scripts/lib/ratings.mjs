export function emptyRating(status = "unresolved") {
  return {
    value: null,
    exactValue: null,
    display: "NR",
    status,
    reliability: null
  };
}

export function exactRating(value, status, reliability) {
  return {
    value,
    exactValue: value,
    display: value == null ? "NR" : value.toFixed(2),
    status,
    reliability
  };
}

export function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function locationScore(candidateLocation, expectedLocation) {
  if (!candidateLocation || !expectedLocation) return 0;
  const candidate = candidateLocation.toLowerCase();
  const expected = expectedLocation.toLowerCase();
  if (candidate === expected) return 100;
  const candidateCity = candidate.split(",")[0].trim();
  const expectedCity = expected.split(",")[0].trim();
  if (candidateCity && candidateCity === expectedCity) return 70;
  const candidateState = candidate.match(/,\s*([a-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/)?.[1];
  const expectedState = expected.match(/,\s*([a-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/)?.[1];
  if (candidateState && candidateState === expectedState) return 10;
  return 0;
}
