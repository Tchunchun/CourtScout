import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  scheduleRowsFromCsv,
  suggestScheduleColumns
} from "../web/public/schedule.mjs";

test("CSV parsing supports quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsv(
    'Opponent,Location,Round\n"Team ""A""","Seattle, WA",1\n'
  ), [
    ["Opponent", "Location", "Round"],
    ['Team "A"', "Seattle, WA", "1"]
  ]);
});

test("schedule CSV mapping detects common headers and validates rows", () => {
  const rows = parseCsv(
    "Opponent Team,Match Date,Time,Venue,Home/Away\n" +
    "Opponent A,10/03/2026,9:00 AM,Court 1,neutral\n" +
    ",invalid,,,home\n"
  );
  const mapping = suggestScheduleColumns(rows[0]);
  const matches = scheduleRowsFromCsv(rows, mapping);

  assert.equal(mapping.opponent, 0);
  assert.equal(matches[0].date, "2026-10-03");
  assert.equal(matches[0].sourceMatchId, "csv-row:2");
  assert.equal(matches[0].site, "Court 1");
  assert.equal(matches[0].designation, "neutral");
  assert.deepEqual(matches[0].errors, []);
  assert.equal(matches[1].errors.length, 2);
});
