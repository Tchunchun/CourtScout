import { normalizeName } from "./ratings.mjs";

const RATING_PATTERN = /(?<![\d.])(\d{1,2})[.,](\d{2}|[xX]{2})(?![\d])|\b(UR|NR|Unrated)\b/g;
const LABEL_WORDS = new Set([
  "singles", "doubles", "utr", "reliable", "rating", "ratings", "verified",
  "unrated", "projected", "team", "roster", "players", "player", "name",
  "results", "matches", "profile", "follow", "message", "from", "power",
  "trend", "wtn", "ntrp", "age", "location", "college", "club"
]);
const MIN_UTR = 1;
const MAX_UTR = 16.5;

export const MATCH_THRESHOLDS = Object.freeze({
  proposed: 0.9,
  review: 0.75,
  ambiguousGap: 0.05
});

export function parseRatingToken(token) {
  if (!token) return null;
  const text = String(token).trim();
  if (/^(UR|NR|Unrated)$/i.test(text)) {
    return { value: null, display: "NR", status: "Unrated", reliability: null };
  }
  const match = text.match(/^(\d{1,2})[.,](\d{2}|[xX]{2})$/);
  if (!match) return null;
  if (/x/i.test(match[2])) {
    return {
      value: null,
      display: `${Number(match[1])}.xx`,
      status: "public_masked",
      reliability: null
    };
  }
  const value = Number(`${match[1]}.${match[2]}`);
  if (value < MIN_UTR || value > MAX_UTR) return null;
  return { value, display: value.toFixed(2), status: "ocr_exact", reliability: null };
}

function ratingTokens(line) {
  return [...line.matchAll(RATING_PATTERN)]
    .map(match => ({ index: match.index, rating: parseRatingToken(match[0]) }))
    .filter(item => item.rating);
}

function reliabilityAfter(line, index) {
  const match = line.slice(index).match(/(\d{1,3})\s*%\s*Reliable/i);
  return match ? Number(match[1]) : null;
}

function cleanName(text) {
  return text
    .replace(/[|•·_*#~=<>«»]/g, " ")
    .replace(/^\s*\d+[.)]?\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,;:-]+$/, "");
}

export function looksLikeName(text) {
  const words = cleanName(text).split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(word =>
    /^[\p{L}][\p{L}\p{N}'’.-]*,?$/u.test(word) &&
    !LABEL_WORDS.has(word.replace(/[,.]/g, "").toLowerCase())
  );
}

function withReliability(rating, line, index) {
  if (!rating || rating.value == null) return rating;
  return { ...rating, reliability: reliabilityAfter(line, index) };
}

function parseRosterRows(lines) {
  const rows = [];
  let pendingName = null;
  for (const line of lines) {
    const tokens = ratingTokens(line);
    if (!tokens.length) {
      pendingName = looksLikeName(line) ? cleanName(line) : null;
      continue;
    }
    const prefix = line.slice(0, tokens[0].index);
    const name = looksLikeName(prefix) ? cleanName(prefix) :
      !prefix.trim() && pendingName ? pendingName : null;
    pendingName = null;
    if (!name) continue;
    rows.push({
      name,
      singles: tokens[0].rating,
      doubles: tokens[1]?.rating ?? null,
      sourceLine: line
    });
  }
  return rows;
}

function labeledRating(lines, label) {
  const pattern = new RegExp(`\\b${label}\\b`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    const window = [
      lines[index].slice(match.index + match[0].length),
      ...lines.slice(index + 1, index + 3)
    ].join(" ");
    const token = ratingTokens(window)[0];
    if (token) return withReliability(token.rating, window, token.index);
  }
  return null;
}

function parseProfile(lines) {
  const name = lines.find(looksLikeName);
  if (!name) return [];
  let singles = labeledRating(lines, "Singles");
  let doubles = labeledRating(lines, "Doubles");
  if (!singles && !doubles) {
    // Mirrors visibleCurrentUtrRatings: current cards list singles, then doubles.
    const text = lines.join(" ");
    const current = [...text.matchAll(
      /\bUTR\s+(\d{1,2}[.,]\d{2})\s+(\d{1,3})\s*%\s*Reliable\b/gi
    )].map(match => ({
      ...parseRatingToken(match[1]),
      reliability: Number(match[2])
    })).filter(rating => rating.value != null);
    [singles = null, doubles = null] = current;
  }
  if (!singles && !doubles) return [];
  return [{ name: cleanName(name), singles, doubles, sourceLine: name }];
}

export function parseUtrScreenshotText(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const rows = parseRosterRows(lines);
  if (rows.length >= 2) return { layout: "roster", entries: rows };
  const profile = parseProfile(lines);
  if (profile.length) return { layout: "profile", entries: profile };
  return { layout: rows.length ? "roster" : "unknown", entries: rows };
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

const OCR_DIGIT_LETTERS = { 0: "o", 1: "l", 4: "a", 5: "s", 8: "b" };

function ocrLetters(name) {
  return String(name ?? "").replace(/[01458]/g, digit => OCR_DIGIT_LETTERS[digit]);
}

function nameTokens(name) {
  const text = String(name ?? "");
  const ordered = text.includes(",")
    ? text.split(",").reverse().join(" ")
    : text;
  return ordered.split(/\s+/).map(normalizeName).filter(Boolean);
}

export function nameSimilarity(rawOcrName, rosterName) {
  const ocrName = ocrLetters(rawOcrName);
  const left = normalizeName(ocrName);
  const right = normalizeName(rosterName);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = nameTokens(ocrName);
  const rightTokens = nameTokens(rosterName);
  if (leftTokens.join("") === rightTokens.join("")) return 0.97;
  if ([...leftTokens].sort().join("|") === [...rightTokens].sort().join("|")) {
    return 0.95;
  }

  let score = 1 - editDistance(left, right) / Math.max(left.length, right.length);
  const leftLast = leftTokens.at(-1);
  const rightLast = rightTokens.at(-1);
  if (
    leftLast && leftLast === rightLast &&
    leftTokens[0]?.[0] === rightTokens[0]?.[0] &&
    (leftTokens[0].length === 1 || rightTokens[0].length === 1)
  ) {
    score = Math.max(score, 0.85);
  }
  return Math.round(score * 100) / 100;
}

export function matchEntriesToPeople(entries, people, options = {}) {
  const ocrConfidence = options.ocrConfidence ?? null;
  const proposals = entries.map(entry => {
    const ranked = people
      .map(person => ({
        name: person.name,
        kind: person.kind,
        score: nameSimilarity(entry.name, person.name)
      }))
      .filter(candidate => candidate.score >= MATCH_THRESHOLDS.review)
      .sort((left, right) => right.score - left.score);
    const [best, second] = ranked;
    let status = !best ? "no_match" :
      best.score >= MATCH_THRESHOLDS.proposed ? "proposed" : "needs_review";
    if (
      best && second &&
      best.score - second.score < MATCH_THRESHOLDS.ambiguousGap
    ) {
      status = "ambiguous";
    }
    if (status === "proposed" && ocrConfidence != null && ocrConfidence < 60) {
      status = "needs_review";
    }
    return {
      ocrName: entry.name,
      singles: entry.singles,
      doubles: entry.doubles,
      sourceLine: entry.sourceLine,
      status,
      match: best ?? null,
      confidence: best
        ? Math.round(best.score * (ocrConfidence == null ? 1 : ocrConfidence / 100) * 100) / 100
        : 0,
      alternatives: ranked.slice(1, 4)
    };
  });

  const claimed = new Map();
  for (const proposal of proposals) {
    if (!proposal.match) continue;
    const key = `${proposal.match.kind}|${proposal.match.name}`;
    const previous = claimed.get(key);
    if (!previous) {
      claimed.set(key, proposal);
      continue;
    }
    const loser = previous.match.score >= proposal.match.score ? proposal : previous;
    loser.status = "duplicate_match";
    if (loser === previous) claimed.set(key, proposal);
  }
  return proposals;
}
