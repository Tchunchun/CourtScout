import test from "node:test";
import assert from "node:assert/strict";
import { backfillPlayerGenders } from "../scripts/backfill-player-genders.mjs";

const profile = label => `<html><body><span>RECORD</span><span>${label}</span></body></html>`;

test("missing genders are filled from TennisRecord profiles; known ones are kept", async () => {
  const dataset = {
    sources: [{ type: "tennisrecord", fields: ["roster"] }],
    roster: [
      { name: "Known", gender: "Women", profileUrl: "https://example.test/known" },
      { name: "Missing", profileUrl: "https://example.test/missing" },
      { name: "Unlabeled", gender: "Unknown", profileUrl: "https://example.test/unlabeled" },
      { name: "No profile" }
    ]
  };
  const fetched = [];
  const pages = {
    "https://example.test/missing": profile("Male"),
    "https://example.test/unlabeled": profile("----------")
  };
  const result = await backfillPlayerGenders(dataset, {
    delayMs: 0,
    fetchProfile: async url => {
      fetched.push(url);
      return pages[url];
    }
  });
  assert.deepEqual(fetched, ["https://example.test/missing", "https://example.test/unlabeled"]);
  assert.deepEqual(result, { resolved: ["Missing"], unresolved: ["Unlabeled", "No profile"] });
  assert.deepEqual(dataset.roster.map(player => player.gender), ["Women", "Men", "Unknown", undefined]);
  assert.deepEqual(dataset.sources[0].fields, ["roster", "player gender"]);
  assert.ok(dataset.generatedAt);
});
