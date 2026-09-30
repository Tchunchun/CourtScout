import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmEventSchedule,
  defaultEligibilityScope,
  getEventSchedule,
  linkScheduledOpponent,
  normalizeScheduledMatch,
  reconcileEventSchedule
} from "../scripts/lib/event-schedules.mjs";

test("event types provide expected eligibility defaults", () => {
  assert.equal(defaultEligibilityScope("local"), "local");
  assert.equal(defaultEligibilityScope("sectionals"), "sectional");
  assert.equal(defaultEligibilityScope("nationals"), "national");
  assert.equal(defaultEligibilityScope("other"), "local");
});

test("imported matches receive stable IDs and validate required fields", () => {
  const input = {
    opponent: "Opponent A",
    date: "2026-10-10",
    time: "9:00 AM",
    round: "Round 1"
  };
  assert.equal(
    normalizeScheduledMatch(input, "event").id,
    normalizeScheduledMatch(input, "event").id
  );
  assert.throws(
    () => normalizeScheduledMatch({ date: "2026-10-10" }, "event"),
    /requires an opponent/
  );
});

test("source match IDs preserve imported identity when dates change", () => {
  const first = normalizeScheduledMatch({
    opponent: "Opponent A",
    date: "2026-10-10",
    sourceType: "csv",
    sourceMatchId: "row-1"
  }, "event");
  const postponed = normalizeScheduledMatch({
    opponent: "Opponent A",
    date: "2026-10-17",
    sourceType: "csv",
    sourceMatchId: "row-1"
  }, "event");
  assert.equal(first.id, postponed.id);
});

test("schedule reconciliation distinguishes all change types", () => {
  const current = [
    { id: "same", sourceOpponentName: "Same", status: "scheduled" },
    { id: "changed", sourceOpponentName: "Changed", status: "scheduled" },
    { id: "removed", sourceOpponentName: "Removed", status: "scheduled" }
  ];
  const proposed = [
    { id: "same", sourceOpponentName: "Same", status: "scheduled" },
    { id: "changed", sourceOpponentName: "Changed", status: "postponed" },
    { id: "added", sourceOpponentName: "Added", status: "scheduled" }
  ];
  assert.deepEqual(
    reconcileEventSchedule(current, proposed).map(row => row.change),
    ["unchanged", "changed", "added", "removed"]
  );
});

test("confirmed schedules persist, cancel removed rows, and link opponents", async t => {
  const directory = await mkdtemp(join(tmpdir(), "event-schedules-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = {
    collectionId: "event",
    ourTeamId: "ours",
    eventType: "sectionals",
    timezone: "America/Los_Angeles",
    source: { type: "csv", fileName: "sectionals.csv" }
  };
  const first = await confirmEventSchedule(directory, {
    ...base,
    matches: [
      { id: "one", opponent: "Opponent One", date: "2026-10-01" },
      { id: "two", opponent: "Opponent Two", date: "2026-10-02" }
    ]
  });
  assert.equal(first.schedule.eligibilityScope, "sectional");

  const second = await confirmEventSchedule(directory, {
    ...base,
    matches: [
      { id: "one", opponent: "Opponent One", date: "2026-10-03" }
    ]
  });
  assert.deepEqual(
    second.reconciliation.map(row => row.change),
    ["changed", "removed"]
  );
  assert.equal(
    second.schedule.matches.find(match => match.id === "two").status,
    "cancelled"
  );

  await linkScheduledOpponent(
    directory,
    "event",
    "one",
    "gathered-opponent"
  );
  const stored = await getEventSchedule(directory, "event");
  assert.equal(stored.matches[0].linkedOpponentTeamId, "gathered-opponent");
});
