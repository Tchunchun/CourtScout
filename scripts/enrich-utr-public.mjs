#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { readJson, writeJsonAtomic } from "./lib/io.mjs";
import { emptyRating } from "./lib/ratings.mjs";
import {
  cacheKey,
  chooseCandidate,
  hasCompleteExactRatings,
  updateCourtJoins
} from "./lib/utr.mjs";
import { RequestPacer } from "./lib/request-pacer.mjs";

const usage = `Usage:
  node scripts/enrich-utr-public.mjs --input <team-data.json> [--delay-ms 3000]
    [--cache data/.cache/utr-public-profiles.json] [--refresh]`;
const MAX_RATE_LIMIT_RETRIES = 4;

export function publicRating(display, status, reliability) {
  if (!display || status === "Unrated") {
    return {
      ...emptyRating(),
      display: status === "Unrated" ? "NR" : display ?? "NR",
      status: status ?? "unresolved",
      reliability: reliability ?? null
    };
  }

  return {
    value: null,
    exactValue: null,
    display,
    status: status ?? "public_masked",
    reliability: reliability ?? null
  };
}

export function mapSearchCandidates(payload) {
  return (payload.hits ?? []).map(hit => {
    const source = hit.source ?? {};
    return {
      id: source.id,
      name: source.displayName,
      gender: source.gender,
      location: source.location?.display ?? source.descriptionShort ?? null,
      singlesDisplay: source.singlesUtrDisplay ?? null,
      doublesDisplay: source.doublesUtrDisplay ?? null,
      singlesStatus: source.ratingStatusSingles ?? null,
      doublesStatus: source.ratingStatusDoubles ?? null,
      singlesReliability: source.ratingProgressSingles ?? null,
      doublesReliability: source.ratingProgressDoubles ?? null
    };
  });
}

async function searchProfiles(name, options) {
  const { fetchImpl, pacer } = options;
  const url = new URL("https://api.utrsports.net/v2/search/players");
  url.search = new URLSearchParams({
    top: "20",
    skip: "0",
    query: name,
    showTennisContent: "true"
  });

  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    await pacer.wait();
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000)
    });
    if (response.status === 429) {
      const delayMs = pacer.backoff(response.headers.get("retry-after"));
      if (attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `UTR public search remained rate limited while reading ${name}. ` +
          "Progress is saved; wait before resuming the collection."
        );
      }
      console.log(
        `UTR rate limit reached; pausing all searches for ${Math.ceil(delayMs / 1000)}s`
      );
      continue;
    }
    if (!response.ok) {
      throw new Error(`UTR public search failed with HTTP ${response.status}`);
    }
    pacer.succeeded();
    return mapSearchCandidates(await response.json());
  }
}

function publicProfile(candidate) {
  return {
    lookupStatus: "public_profile_resolved",
    profileCandidate: {
      playerId: candidate.id,
      location: candidate.location
    },
    singles: publicRating(
      candidate.singlesDisplay,
      candidate.singlesStatus,
      candidate.singlesReliability
    ),
    doubles: publicRating(
      candidate.doublesDisplay,
      candidate.doublesStatus,
      candidate.doublesReliability
    ),
    exactDecimalsAvailable: false,
    exactDecimalsBlocker: "Public UTR data masks exact decimal ratings",
    retrievedAt: new Date().toISOString().slice(0, 10)
  };
}

function unresolvedProfile(selection) {
  return {
    lookupStatus: selection.status,
    profileCandidate: null,
    candidates: selection.candidates,
    singles: emptyRating(),
    doubles: emptyRating(),
    exactDecimalsAvailable: false,
    exactDecimalsBlocker: selection.status,
    retrievedAt: new Date().toISOString().slice(0, 10)
  };
}

export async function enrichPublicUtr(inputPath, options = {}) {
  const delayMs = options.delayMs ?? 3000;
  const cachePath = resolve(
    options.cachePath ?? "data/.cache/utr-public-profiles.json"
  );
  const pacer = options.pacer ?? new RequestPacer({ intervalMs: delayMs });
  const fetchImpl = options.fetchImpl ?? fetch;
  const dataset = await readJson(inputPath);
  let cache = {};
  try {
    cache = await readJson(cachePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const gender = dataset.team.gender === "Men" ? "Male" :
    dataset.team.gender === "Women" ? "Female" : null;
  const people = [
    ...dataset.roster.map(player => ({
      kind: "roster",
      name: player.name,
      locations: [player.location].filter(Boolean),
      player
    })),
    ...dataset.opponents.map(player => ({
      kind: "opponent",
      name: player.name,
      locations: player.locations ?? [],
      player
    }))
  ];

  dataset.collectionStage = "utr_partial";
  await writeJsonAtomic(inputPath, dataset);

  for (const person of people) {
    if (hasCompleteExactRatings(person.player.utr)) {
      console.log(`${person.kind}: ${person.name} -> preserved authenticated exact ratings`);
      continue;
    }
    const key = cacheKey(person.name, person.locations);
    let profile = options.refresh ? null : cache[key];
    if (!profile) {
      const candidates = await searchProfiles(person.name, { fetchImpl, pacer });
      const selection = chooseCandidate(
        person.name,
        person.locations,
        candidates,
        false,
        gender
      );
      profile = selection.candidate
        ? publicProfile(selection.candidate)
        : unresolvedProfile(selection);
      cache[key] = profile;
      await writeJsonAtomic(cachePath, cache);
    }
    person.player.utr = profile;
    await writeJsonAtomic(inputPath, dataset);
    console.log(`${person.kind}: ${person.name} -> ${person.player.utr.lookupStatus}`);
  }

  updateCourtJoins(dataset);
  dataset.collectionStage = "utr_partial";
  dataset.generatedAt = new Date().toISOString();
  dataset.sources = dataset.sources.filter(source =>
    source.type !== "utr_sports_public_profiles"
  );
  dataset.sources.push({
    type: "utr_sports_public_profiles",
    url: "https://api.utrsports.net/v2/search/players",
    retrievedAt: new Date().toISOString().slice(0, 10),
    authentication: "not_authenticated",
    requestPolicy:
      `sequential; ${delayMs}ms minimum interval; exponential 429 backoff; ` +
      "persistent cross-team cache",
    fields: [
      "profile identity and location",
      "masked singles UTR band",
      "masked doubles UTR band",
      "rating status",
      "rating reliability"
    ],
    limitation: "Exact decimal UTR values require user authentication."
  });
  await writeJsonAtomic(inputPath, dataset);
  console.log(`Enriched ${people.length} records with public UTR data`);
  return dataset;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = resolve(requireArg(args, "input", usage));
    const delayMs = Number(args["delay-ms"] ?? 3000);
    await enrichPublicUtr(inputPath, {
      delayMs,
      cachePath: args.cache,
      refresh: Boolean(args.refresh)
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
