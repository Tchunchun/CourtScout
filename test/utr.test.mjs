import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enrichPublicUtr,
  mapSearchCandidates,
  publicRating
} from "../scripts/enrich-utr-public.mjs";
import {
  candidateFromPublicRating,
  chooseCandidate,
  exactRatingsNotVisibleError,
  hasCompleteExactRatings,
  isExactRatingsNotVisibleError,
  utrSearchExpression,
  visibleCurrentUtrRatings
} from "../scripts/lib/utr.mjs";

test("authenticated UTR parser ignores historical ratings without reliability", () => {
  assert.deepEqual(visibleCurrentUtrRatings(`
    UTR
    1.08
    From May 2025
    UTR
    2.91
    100% Reliable
  `), [{ value: 2.91, reliability: 100 }]);
});

test("authenticated UTR parser returns current singles and doubles ratings", () => {
  assert.deepEqual(visibleCurrentUtrRatings(`
    UTR
    2.45
    100% Reliable
    UTR
    2.69
    100% Reliable
  `), [
    { value: 2.45, reliability: 100 },
    { value: 2.69, reliability: 100 }
  ]);
});

test("authenticated UTR search safely serializes apostrophes in player names", () => {
  const expression = utrSearchExpression("Maureen O'Guin");
  assert.doesNotThrow(() => new Function("fetch", `return ${expression}`));
  assert.match(expression, /Maureen%20O'Guin/);
});

test("missing exact profile ratings use a distinct non-retryable error", () => {
  const error = exactRatingsNotVisibleError("Magan Flynn");
  assert.equal(isExactRatingsNotVisibleError(error), true);
  assert.equal(isExactRatingsNotVisibleError(new Error("network failed")), false);
  assert.match(error.message, /Magan Flynn/);
});
import {
  parseRetryAfter,
  RequestPacer
} from "../scripts/lib/request-pacer.mjs";

test("publicRating preserves a masked rating without inventing a value", () => {
  assert.deepEqual(publicRating("4.xx", "Rated", 100), {
    value: null,
    exactValue: null,
    display: "4.xx",
    status: "Rated",
    reliability: 100
  });
});

test("publicRating presents an unrated profile as NR", () => {
  const rating = publicRating("0.xx", "Unrated", 0);
  assert.equal(rating.display, "NR");
  assert.equal(rating.value, null);
  assert.equal(rating.exactValue, null);
});

test("mapSearchCandidates maps public UTR response fields", () => {
  const candidates = mapSearchCandidates({
    hits: [{
      source: {
        id: 42,
        displayName: "Alex Player",
        gender: "Female",
        location: { display: "San Jose, CA" },
        singlesUtrDisplay: "3.xx",
        doublesUtrDisplay: "4.xx",
        ratingStatusSingles: "Rated",
        ratingStatusDoubles: "Projected",
        ratingProgressSingles: 100,
        ratingProgressDoubles: 76
      }
    }]
  });

  assert.deepEqual(candidates[0], {
    id: 42,
    name: "Alex Player",
    gender: "Female",
    location: "San Jose, CA",
    singlesDisplay: "3.xx",
    doublesDisplay: "4.xx",
    singlesStatus: "Rated",
    doublesStatus: "Projected",
    singlesReliability: 100,
    doublesReliability: 76
  });
});

test("candidateFromPublicRating reuses an already matched player ID", () => {
  assert.deepEqual(candidateFromPublicRating("Alex Player", {
    lookupStatus: "public_profile_resolved",
    profileCandidate: {
      playerId: 42,
      location: "San Jose, CA"
    },
    singles: { status: "Rated", reliability: 100 },
    doubles: { status: "Projected", reliability: 76 }
  }), {
    id: 42,
    name: "Alex Player",
    location: "San Jose, CA",
    singlesStatus: "Rated",
    doublesStatus: "Projected",
    singlesReliability: 100,
    doublesReliability: 76
  });
  assert.equal(candidateFromPublicRating("Alex Player", {
    lookupStatus: "unresolved_ambiguous_profiles"
  }), null);
});

test("chooseCandidate prefers an exact name and location match", () => {
  const result = chooseCandidate("Alex Player", ["San Jose, CA"], [
    {
      id: 1,
      name: "Alex Player",
      gender: "Female",
      location: "Portland, OR",
      singlesStatus: "Rated",
      doublesStatus: "Rated"
    },
    {
      id: 2,
      name: "Alex Player",
      gender: "Female",
      location: "San Jose, CA",
      singlesStatus: "Rated",
      doublesStatus: "Rated"
    }
  ]);

  assert.equal(result.status, "candidate_selected");
  assert.equal(result.candidate.id, 2);
});

test("hasCompleteExactRatings rejects false resolved cache entries", () => {
  assert.equal(hasCompleteExactRatings({
    lookupStatus: "authenticated_exact_profile_resolved",
    singles: { status: "Rated", exactValue: null },
    doubles: { status: "Rated", exactValue: null }
  }), false);

  assert.equal(hasCompleteExactRatings({
    lookupStatus: "authenticated_exact_profile_resolved",
    singles: { status: "Rated", exactValue: 3.89 },
    doubles: { status: "Unrated", exactValue: null }
  }), true);
});

test("parseRetryAfter supports seconds and HTTP dates", () => {
  const now = Date.parse("2026-08-14T20:00:00.000Z");
  assert.equal(parseRetryAfter("45", now), 45_000);
  assert.equal(
    parseRetryAfter("Fri, 14 Aug 2026 20:01:30 GMT", now),
    90_000
  );
  assert.equal(parseRetryAfter("invalid", now), null);
});

test("RequestPacer applies global spacing and exponential rate-limit backoff", async () => {
  let now = 1000;
  const waits = [];
  const pacer = new RequestPacer({
    intervalMs: 3000,
    baseBackoffMs: 60_000,
    now: () => now,
    sleep: async delayMs => {
      waits.push(delayMs);
      now += delayMs;
    }
  });

  await pacer.wait();
  await pacer.wait();
  assert.deepEqual(waits, [3000]);

  assert.equal(pacer.backoff(), 60_000);
  await pacer.wait();
  assert.deepEqual(waits, [3000, 60_000]);

  assert.equal(pacer.backoff(), 120_000);
  pacer.succeeded();
  assert.equal(pacer.backoff(), 60_000);
});

test("public enrichment backs off on 429 and reuses its cross-team cache", async t => {
  const directory = await mkdtemp(join(tmpdir(), "utr-public-cache-"));
  const firstInput = join(directory, "first.json");
  const secondInput = join(directory, "second.json");
  const cachePath = join(directory, "cache.json");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const dataset = {
    collectionStage: "tennisrecord_complete",
    generatedAt: "2026-08-14T00:00:00.000Z",
    team: { gender: "Women" },
    roster: [{
      name: "Alex Player",
      location: "San Jose, CA",
      utr: null
    }],
    opponents: [],
    matches: [],
    sources: [],
    dataQuality: {}
  };
  await writeFile(firstInput, JSON.stringify(dataset));
  await writeFile(secondInput, JSON.stringify(dataset));

  let fetchCount = 0;
  const backoffs = [];
  const pacer = {
    wait: async () => {},
    backoff: retryAfter => {
      backoffs.push(retryAfter);
      return 60_000;
    },
    succeeded: () => {}
  };
  const fetchImpl = async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response("", {
        status: 429,
        headers: { "retry-after": "45" }
      });
    }
    return new Response(JSON.stringify({
      hits: [{
        source: {
          id: 42,
          displayName: "Alex Player",
          gender: "Female",
          location: { display: "San Jose, CA" },
          singlesUtrDisplay: "3.xx",
          doublesUtrDisplay: "4.xx",
          ratingStatusSingles: "Rated",
          ratingStatusDoubles: "Rated"
        }
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await enrichPublicUtr(firstInput, {
    cachePath,
    fetchImpl,
    pacer
  });
  assert.equal(fetchCount, 2);
  assert.deepEqual(backoffs, ["45"]);

  await enrichPublicUtr(secondInput, {
    cachePath,
    fetchImpl: async () => {
      throw new Error("cached enrichment should not issue another UTR request");
    },
    pacer
  });
  assert.equal(fetchCount, 2);

  const enriched = JSON.parse(await readFile(secondInput, "utf8"));
  assert.equal(enriched.roster[0].utr.lookupStatus, "public_profile_resolved");
  assert.equal(enriched.roster[0].utr.profileCandidate.playerId, 42);
});
