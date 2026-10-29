import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  TeamPairsConflictError,
  getTeamPairs,
  saveTeamPairs,
  suggestTeamPairs
} from "../scripts/lib/team-pairs.mjs";

const dataset = {
  team: { gender: "Mixed" },
  roster: [
    { name: "A", gender: "Men" },
    { name: "B", gender: "Women" },
    { name: "C", gender: "Women" }
  ],
  matches: [
    { courts: { D1: { targetPlayers: ["A", "B"], result: "W" }, D2: { targetPlayers: ["A", "C"], result: "L" } } },
    { courts: { D2: { targetPlayers: ["B", "A"], result: "L" }, S1: { targetPlayers: ["A"], result: "W" } } }
  ]
};

test("suggests every historical doubles pair with usage and record", () => {
  assert.deepEqual(suggestTeamPairs(dataset), [
    { players: ["A", "B"], tag: "suggested", preferredCourt: "D1", appearances: 2, wins: 1, losses: 1, suggested: true },
    { players: ["A", "C"], tag: "suggested", preferredCourt: "D2", appearances: 1, wins: 0, losses: 1, suggested: true }
  ]);
});

test("saves pairs with revisions and refuses stale or invalid changes", async t => {
  const directory = await mkdtemp(join(tmpdir(), "court-scout-pairs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const unsaved = await getTeamPairs(directory, "ours", dataset);
  assert.equal(unsaved.saved, false);
  assert.equal(unsaved.suggestions.length, 2);

  const saved = await saveTeamPairs(directory, "ours", dataset, [
    { players: ["B", "A"], tag: "go-to", preferredCourt: "d2" }
  ], { baseRevision: 0 });
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.pairs[0], {
    players: ["A", "B"], tag: "go-to", preferredCourt: "D2",
    appearances: 2, wins: 1, losses: 1, suggested: false
  });
  assert.deepEqual(saved.suggestions.map(pair => pair.players), [["A", "C"]]);

  await assert.rejects(
    saveTeamPairs(directory, "ours", dataset, [], { baseRevision: 0 }),
    error => error instanceof TeamPairsConflictError && error.current.revision === 1
  );
  await assert.rejects(
    saveTeamPairs(directory, "ours", dataset, [{ players: ["B", "C"], tag: "backup" }]),
    /one man and one woman/
  );
  await assert.rejects(
    saveTeamPairs(directory, "ours", dataset, [{ players: ["A", "Outsider"], tag: "backup" }]),
    /active roster/
  );
});

test("requires a base revision and keeps pairs with the dataset across moves", async t => {
  const directory = await mkdtemp(join(tmpdir(), "court-scout-pairs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ours = { ...dataset, datasetId: "2027-ours" };

  await assert.rejects(
    saveTeamPairs(directory, "collections/a/ours", ours, [{ players: ["A", "B"], tag: "go-to" }]),
    /baseRevision/
  );
  await saveTeamPairs(directory, "collections/a/ours", ours, [
    { players: ["A", "B"], tag: "go-to" }
  ], { baseRevision: 0 });
  const moved = await getTeamPairs(directory, "collections/b/ours", ours);
  assert.equal(moved.teamId, "collections/b/ours");
  assert.equal(moved.revision, 1);
});

test("uses the national active roster when the team has one", async () => {
  const national = { ...dataset, nationalRoster: [{ name: "A" }, { name: "B" }] };
  assert.deepEqual(suggestTeamPairs(national).map(pair => pair.players), [["A", "B"]]);
  await assert.rejects(
    saveTeamPairs("/unused", "ours", national, [{ players: ["A", "C"], tag: "go-to" }], { baseRevision: 0 }),
    /active roster/
  );
});
