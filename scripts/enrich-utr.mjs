#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { browser, browserJson } from "./lib/browser.mjs";
import { readJson, writeJsonAtomic } from "./lib/io.mjs";
import {
  emptyRating,
  exactRating,
  normalizeName,
  ratingPeople,
  ratingScopeIncludes
} from "./lib/ratings.mjs";
import {
  cacheKey,
  candidateFromPublicRating,
  chooseCandidate,
  exactRatingsNotVisibleError,
  hasCompleteExactRatings,
  isExactRatingsNotVisibleError,
  utrSearchExpression,
  updateCourtJoins,
  visibleCurrentUtrRatings
} from "./lib/utr.mjs";
import { RequestPacer } from "./lib/request-pacer.mjs";

const usage = `Usage:
  npm run enrich:utr -- --input <team-data.json> [--session utr-collector]
    [--delay-ms 10000] [--cache data/.cache/utr-profiles.json]
    [--headed] [--accept-ambiguous] [--refresh | --refresh-unresolved]
    [--scope all|team|opponents]`;
const MAX_RATE_LIMIT_RETRIES = 4;

async function searchProfiles(session, name, pacer) {
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    await pacer.wait();
    const result = await browserJson(
      session,
      utrSearchExpression(name)
    );
    if (result.status === 429) {
      const delayMs = pacer.backoff(result.retryAfter);
      if (attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `UTR search remained rate limited while reading ${name}. ` +
          "Progress is saved; wait before resuming the collection."
        );
      }
      console.log(
        `UTR rate limit reached; pausing all requests for ${Math.ceil(delayMs / 1000)}s`
      );
      continue;
    }
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`UTR search failed with HTTP ${result.status}`);
    }
    pacer.succeeded();
    return result.hits.map(hit => ({
      id: hit.source.id,
      name: hit.source.displayName,
      gender: hit.source.gender,
      location: hit.source.location?.display ?? hit.source.descriptionShort ?? null,
      singlesStatus: hit.source.ratingStatusSingles,
      doublesStatus: hit.source.ratingStatusDoubles,
      singlesReliability: hit.source.ratingProgressSingles ?? null,
      doublesReliability: hit.source.ratingProgressDoubles ?? null
    }));
  }
}

async function readExactProfile(session, candidate, delayMs, pacer) {
  let profile;
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    await pacer.wait();
    await browser(session, "open", `https://app.utrsports.net/profiles/${candidate.id}`);
    await browser(session, "wait", String(Math.max(3000, Math.floor(delayMs / 2))));
    profile = await browserJson(
      session,
      `JSON.stringify({title:document.title,heading:document.querySelector('h1')?.textContent?.trim(),` +
      `rateLimited:document.body.innerText.includes('Too many requests'),` +
      `bodyText:document.body.innerText.slice(0,5000)})`
    );
    if (!profile.rateLimited) {
      if (normalizeName(profile.heading ?? "") === normalizeName(candidate.name)) {
        pacer.succeeded();
        break;
      }
      if (attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `UTR profile heading mismatch for ${candidate.name}: ` +
          `received "${profile.heading ?? "no profile heading"}"`
        );
      }
      console.log(
        `UTR profile navigation for ${candidate.name} rendered ` +
        `"${profile.heading ?? "no profile heading"}"; retrying`
      );
      continue;
    }
    const retryDelay = pacer.backoff();
    if (attempt === MAX_RATE_LIMIT_RETRIES) {
      throw new Error(
        `UTR rate limit persisted while reading ${candidate.name}. ` +
        "Progress is saved; wait before resuming the collection."
      );
    }
    console.log(
      `UTR rate limit reached; pausing all requests for ${Math.ceil(retryDelay / 1000)}s`
    );
  }
  const activeTypes = [
    candidate.singlesStatus !== "Unrated" ? "singles" : null,
    candidate.doublesStatus !== "Unrated" ? "doubles" : null
  ].filter(Boolean);
  const currentRatings = visibleCurrentUtrRatings(profile.bodyText);
  const values = Object.fromEntries(
    activeTypes.map((type, index) => [type, currentRatings[index]?.value ?? null])
  );
  const rating = {
    lookupStatus: "authenticated_exact_profile_resolved",
    profileCandidate: {
      playerId: candidate.id,
      location: candidate.location
    },
    singles: exactRating(
      values.singles ?? null,
      candidate.singlesStatus,
      candidate.singlesReliability
    ),
    doubles: exactRating(
      values.doubles ?? null,
      candidate.doublesStatus,
      candidate.doublesReliability
    ),
    exactDecimalsAvailable: true,
    exactDecimalsBlocker: null,
    retrievedAt: new Date().toISOString().slice(0, 10)
  };
  if (!hasCompleteExactRatings(rating)) {
    throw exactRatingsNotVisibleError(candidate.name);
  }

  return rating;
}

function unresolvedRating(status, candidates) {
  return {
    lookupStatus: status,
    profileCandidate: null,
    candidates,
    singles: emptyRating(),
    doubles: emptyRating(),
    exactDecimalsAvailable: false,
    exactDecimalsBlocker: status,
    retrievedAt: new Date().toISOString().slice(0, 10)
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(requireArg(args, "input", usage));
  const cachePath = resolve(args.cache ?? "data/.cache/utr-profiles.json");
  const session = args.session ?? "utr-collector";
  const delayMs = Number(args["delay-ms"] ?? 10000);
  const pacer = new RequestPacer({ intervalMs: delayMs });
  const dataset = await readJson(inputPath);
  let cache = {};
  try {
    cache = await readJson(cachePath);
  } catch {
    cache = {};
  }

  dataset.collectionStage = "utr_partial";
  updateCourtJoins(dataset);
  await writeJsonAtomic(inputPath, dataset);
  const scope = args.scope ?? "all";
  const people = ratingPeople(dataset, scope);
  const needsBrowser = people.some(person => {
    const cached = cache[cacheKey(person.name, person.locations)];
    return args.refresh || !cached || (
      args["refresh-unresolved"] &&
      !cached.exactDecimalsAvailable
    );
  });
  if (needsBrowser) {
    const openArgs = [];
    if (args.headed) openArgs.push("--headed");
    await browser(session, ...openArgs, "open", "https://app.utrsports.net/search");
    const signedIn = await browserJson(
      session,
      `JSON.stringify({signedIn:document.body.innerText.includes('Sign Out')})`
    );
    if (!signedIn.signedIn) {
      throw new Error(
        `UTR session "${session}" is not signed in. Re-run with --headed, sign in, then resume.`
      );
    }
  }

  for (const person of people) {
    const key = cacheKey(person.name, person.locations);
    let rating = args.refresh ? null : cache[key];
    if (rating?.lookupStatus === "authenticated_exact_profile_resolved" &&
        !hasCompleteExactRatings(rating)) {
      delete cache[key];
      rating = null;
    }
    if (args["refresh-unresolved"] && rating && !rating.exactDecimalsAvailable) {
      rating = null;
    }
    if (!rating) {
      const knownCandidate = candidateFromPublicRating(
        person.name,
        person.player.utr
      );
      const selection = knownCandidate
        ? { candidate: knownCandidate, candidates: [knownCandidate] }
        : chooseCandidate(
          person.name,
          person.locations,
          await searchProfiles(session, person.name, pacer),
          Boolean(args["accept-ambiguous"]),
          dataset.team.gender === "Men" ? "Male" :
            dataset.team.gender === "Women" ? "Female" : null
        );
      if (selection.candidate) {
        try {
          rating = await readExactProfile(
            session,
            selection.candidate,
            delayMs,
            pacer
          );
        } catch (error) {
          if (!isExactRatingsNotVisibleError(error)) throw error;
          rating = unresolvedRating(
            "unresolved_exact_ratings_not_visible",
            selection.candidates
          );
        }
      } else {
        rating = unresolvedRating(selection.status, selection.candidates);
      }
      cache[key] = rating;
      await writeJsonAtomic(cachePath, cache);
    }
    person.player.utr = {
      ...rating,
      singles: rating.singles,
      doubles: rating.doubles
    };
    updateCourtJoins(dataset);
    await writeJsonAtomic(inputPath, dataset);
    console.log(`${person.kind}: ${person.name} -> ${rating.lookupStatus}`);
  }

  updateCourtJoins(dataset);
  dataset.collectionStage = "step_1_complete";
  dataset.generatedAt = new Date().toISOString();
  dataset.sources = dataset.sources.filter(source =>
    source.type !== "utr_sports_authenticated_profiles"
  );
  dataset.sources.push({
    type: "utr_sports_authenticated_profiles",
    url: "https://app.utrsports.net/profiles",
    retrievedAt: new Date().toISOString().slice(0, 10),
    authentication: "user-authenticated",
    requestPolicy: `sequential; ${delayMs}ms delay; persistent cross-team cache`,
    fields: [
      "profile identity",
      "location",
      "exact singles UTR",
      "exact doubles UTR",
      "rating status",
      "reliability"
    ]
  });
  dataset.dataQuality.unresolvedIdentities = [
    ...(dataset.dataQuality.unresolvedIdentities ?? []).filter(item =>
      !ratingScopeIncludes(scope, item.kind ?? "roster")
    ),
    ...people
      .filter(person => !person.player.utr.exactDecimalsAvailable)
      .map(person => ({
        name: person.name,
        kind: person.kind,
        status: person.player.utr.lookupStatus
      }))
  ];
  await writeJsonAtomic(inputPath, dataset);
  console.log(`Enriched ${people.length} unique target/opponent records`);
  console.log(`Cache: ${cachePath}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
