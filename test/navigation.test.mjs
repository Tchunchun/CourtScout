import test from "node:test";
import assert from "node:assert/strict";
import {
  courtScoutRouteHash,
  parseCourtScoutRoute
} from "../web/public/navigation.mjs";

test("Court Scout routes preserve team report tabs", () => {
  const hash = courtScoutRouteHash({
    view: "team",
    teamId: "collections/team one",
    tab: "matches"
  });

  assert.equal(hash, "#/team/collections%2Fteam%20one/matches");
  assert.deepEqual(parseCourtScoutRoute(hash), {
    view: "team",
    teamId: "collections/team one",
    tab: "matches"
  });
});

test("Court Scout routes preserve analysis tabs and saved cards", () => {
  assert.deepEqual(parseCourtScoutRoute("#/analysis/team-a/lineups"), {
    view: "analysis",
    teamId: "team-a",
    tab: "lineups"
  });
  assert.deepEqual(parseCourtScoutRoute("#/card/card-1"), {
    view: "card",
    cardId: "card-1"
  });
});

test("Court Scout routes safely fall back for invalid state", () => {
  assert.deepEqual(parseCourtScoutRoute("#/team/team-a/unknown"), {
    view: "team",
    teamId: "team-a",
    tab: "roster"
  });
  assert.deepEqual(parseCourtScoutRoute("#/%E0%A4%A"), { view: "scout" });
  assert.equal(courtScoutRouteHash({ view: "unknown" }), "#/scout");
});
