import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enrichPublicWtn,
  searchWtnProfiles
} from "../scripts/enrich-wtn-public.mjs";
import {
  chooseWtnCandidate,
  mapWtnCandidates,
  resolvedWtn,
  wtnRating
} from "../scripts/lib/wtn.mjs";

const xiayiPayload = {
  data: {
    publicPersons: {
      items: [{
        id: "678ab2edd7843bec1f60fc98",
        tennisID: "LIX3974189",
        nativeGivenName: "Xiayi",
        nativeFamilyName: "Li",
        nationalityCode: "CHN",
        sex: "F",
        age: 31,
        birthYear: 1995,
        worldTennisNumbers: [
          { type: "DOUBLE", tennisNumber: 28, confidence: 80 },
          { type: "SINGLE", tennisNumber: 27.14, confidence: 90 }
        ],
        addresses: []
      }],
      totalItems: 1
    }
  }
};

test("mapWtnCandidates maps public WTN values and confidence", () => {
  assert.deepEqual(mapWtnCandidates(xiayiPayload)[0], {
    id: "678ab2edd7843bec1f60fc98",
    tennisId: "LIX3974189",
    name: "Xiayi Li",
    gender: "Female",
    nationalityCode: "CHN",
    age: 31,
    birthYear: 1995,
    locations: [],
    singles: { value: 27.14, confidence: 90 },
    doubles: { value: 28, confidence: 80 }
  });
});

test("WTN ratings preserve source precision and use the public display precision", () => {
  assert.deepEqual(wtnRating(27.14, 90), {
    value: 27.14,
    exactValue: 27.14,
    display: "27.1",
    status: "rated",
    reliability: 90
  });
  assert.equal(resolvedWtn(
    mapWtnCandidates(xiayiPayload)[0],
    new Date("2026-08-14T00:00:00.000Z")
  ).doubles.display, "28.0");
});

test("chooseWtnCandidate rejects ambiguous exact names without a location match", () => {
  const base = {
    name: "Alex Player",
    gender: "Female",
    locations: [],
    singles: { value: 25, confidence: 80 },
    doubles: { value: 24, confidence: 80 }
  };
  const selection = chooseWtnCandidate("Alex Player", [], [
    { ...base, id: "one" },
    { ...base, id: "two" }
  ]);
  assert.equal(selection.status, "unresolved_ambiguous_profiles");
  assert.equal(selection.candidate, null);
});

test("chooseWtnCandidate does not use rating availability to resolve an identity", () => {
  const selection = chooseWtnCandidate("Alex Player", [], [
    {
      id: "rated",
      name: "Alex Player",
      gender: "Female",
      locations: [],
      singles: { value: 25, confidence: 80 },
      doubles: { value: 24, confidence: 80 }
    },
    {
      id: "unrated",
      name: "Alex Player",
      gender: "Female",
      locations: [],
      singles: { value: null, confidence: null },
      doubles: { value: null, confidence: null }
    }
  ]);
  assert.equal(selection.status, "unresolved_ambiguous_profiles");
  assert.equal(selection.candidate, null);
});

test("public WTN enrichment updates players, court joins, and provenance", async t => {
  const directory = await mkdtemp(join(tmpdir(), "wtn-public-"));
  const inputPath = join(directory, "team-data.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(inputPath, JSON.stringify({
    collectionStage: "utr_partial",
    generatedAt: "2026-08-14T00:00:00.000Z",
    team: { gender: "Women" },
    roster: [{
      name: "Xiayi Li",
      location: null,
      utr: null,
      wtn: null
    }],
    opponents: [{
      name: "Opponent Player",
      locations: ["Atlanta, GA"],
      utr: null,
      wtn: { lookupStatus: "not_started" }
    }],
    matches: [{
      courts: {
        S1: {
          targetPlayers: ["Xiayi Li"],
          opponentPlayers: [],
          targetRatings: [{ name: "Xiayi Li" }],
          opponentRatings: []
        }
      }
    }],
    sources: [],
    dataQuality: {}
  }));

  let fetchCount = 0;
  const result = await enrichPublicWtn(inputPath, {
    delayMs: 0,
    fetchImpl: async () => {
      fetchCount += 1;
      return Response.json(xiayiPayload);
    }
  });

  assert.equal(fetchCount, 1);
  assert.equal(result.roster[0].wtn.singles.value, 27.14);
  assert.equal(result.roster[0].wtn.doubles.reliability, 80);
  assert.equal(result.opponents[0].wtn.lookupStatus, "not_started");
  assert.equal(result.matches[0].courts.S1.targetRatings[0].wtn.singles.display, "27.1");
  assert.equal(result.sources[0].type, "world_tennis_number_public_profiles");
  assert.deepEqual(result.dataQuality.unresolvedWtnIdentities, []);
});

test("searchWtnProfiles surfaces GraphQL errors", async () => {
  await assert.rejects(
    searchWtnProfiles("Xiayi Li", async () =>
      Response.json({ errors: [{ message: "service unavailable" }] })
    ),
    /service unavailable/
  );
});
