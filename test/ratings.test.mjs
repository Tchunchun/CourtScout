import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyRating,
  exactRating,
  locationScore,
  normalizeName
} from "../scripts/lib/ratings.mjs";

test("rating helpers preserve missing and exact values", () => {
  assert.deepEqual(emptyRating(), {
    value: null,
    exactValue: null,
    display: "NR",
    status: "unresolved",
    reliability: null
  });
  assert.deepEqual(exactRating(3.2, "Rated", 100), {
    value: 3.2,
    exactValue: 3.2,
    display: "3.20",
    status: "Rated",
    reliability: 100
  });
});

test("identity helpers normalize names and prioritize exact locations", () => {
  assert.equal(normalizeName("Ko-Yun Chen"), "koyunchen");
  assert.equal(locationScore("Sunnyvale, CA", "Sunnyvale, CA"), 100);
  assert.equal(locationScore("Sunnyvale, California", "Sunnyvale, CA"), 70);
  assert.equal(locationScore("San Jose, CA", "Sunnyvale, CA"), 10);
  assert.equal(locationScore("Seattle, WA", "Sunnyvale, CA"), 0);
});

test("location scoring compares state codes instead of arbitrary substrings", () => {
  assert.equal(locationScore("Sacramento, CA", "San Jose, CA"), 10);
  assert.equal(locationScore("Caracas, Venezuela", "San Jose, CA"), 0);
});
