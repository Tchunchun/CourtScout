import test from "node:test";
import assert from "node:assert/strict";
import {
  matchEntriesToPeople,
  nameSimilarity,
  parseRatingToken,
  parseUtrScreenshotText
} from "../scripts/lib/utr-screenshot.mjs";
import { proposeUtrScreenshotMatches } from "../scripts/utr-screenshot-ocr.mjs";

const dataset = {
  datasetId: "fixture-team",
  roster: [
    { name: "Maureen O'Guin", location: "San Jose, CA" },
    { name: "Jane Smith", location: "Sunnyvale, CA" },
    { name: "Janet Smyth", location: "Fremont, CA" },
    { name: "Priya Raman", location: "Cupertino, CA" }
  ],
  opponents: [
    { name: "Ana Lopez", locations: ["Reno, NV"] }
  ]
};

const rosterScreenshot = `
Team Roster
Players   Singles   Doubles
1 Maureen O'Guin  3.45  3.67
Jane Srnith 2,91 3.02
Priya Raman 3.xx UR
Coach Notes
`;

const profileScreenshot = `
Follow  Message
Priya Raman
Cupertino, CA
Singles
UTR 3.12
82% Reliable
Doubles
UTR 3.40
100% Reliable
`;

test("rating tokens keep exact, masked, and unrated displays distinct", () => {
  assert.deepEqual(parseRatingToken("3,45"), {
    value: 3.45, display: "3.45", status: "ocr_exact", reliability: null
  });
  assert.deepEqual(parseRatingToken("4.xx"), {
    value: null, display: "4.xx", status: "public_masked", reliability: null
  });
  assert.equal(parseRatingToken("UR").status, "Unrated");
  assert.equal(parseRatingToken("42.10"), null);
});

test("roster screenshots yield one singles/doubles pair per player row", () => {
  const { layout, entries } = parseUtrScreenshotText(rosterScreenshot);
  assert.equal(layout, "roster");
  assert.deepEqual(entries.map(entry => [
    entry.name, entry.singles?.display, entry.doubles?.display
  ]), [
    ["Maureen O'Guin", "3.45", "3.67"],
    ["Jane Srnith", "2.91", "3.02"],
    ["Priya Raman", "3.xx", "NR"]
  ]);
});

test("roster rows may put ratings on the line after the name", () => {
  const { entries } = parseUtrScreenshotText("J4NE SM1TH\n2.91 3.02\nAna Lopez\n4.10 4.22");
  assert.deepEqual(entries.map(entry => entry.name), ["J4NE SM1TH", "Ana Lopez"]);
  assert.equal(entries[1].doubles.value, 4.22);
});

test("profile screenshots read labeled singles and doubles with reliability", () => {
  const { layout, entries } = parseUtrScreenshotText(profileScreenshot);
  assert.equal(layout, "profile");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Priya Raman");
  assert.deepEqual(
    [entries[0].singles.value, entries[0].singles.reliability],
    [3.12, 82]
  );
  assert.deepEqual(
    [entries[0].doubles.value, entries[0].doubles.reliability],
    [3.4, 100]
  );
});

test("profile screenshots without labels fall back to current-rating order", () => {
  const { entries } = parseUtrScreenshotText(
    "Jane Smith\nUTR\n1.08\nFrom May 2025\nUTR\n2.45\n100% Reliable\nUTR\n2.69\n90% Reliable"
  );
  assert.deepEqual(
    [entries[0].singles.value, entries[0].doubles.value, entries[0].doubles.reliability],
    [2.45, 2.69, 90]
  );
});

test("name similarity tolerates order, initials, and OCR character errors", () => {
  assert.equal(nameSimilarity("Jane Smith", "Jane Smith"), 1);
  assert.equal(nameSimilarity("Smith, Jane", "Jane Smith"), 0.97);
  assert.equal(nameSimilarity("J. Smith", "Jane Smith"), 0.85);
  assert.ok(nameSimilarity("Jane Srnith", "Jane Smith") >= 0.75);
  assert.equal(nameSimilarity("C4ITLIN LUTSCH", "Caitlin Lutsch"), 1);
  assert.ok(nameSimilarity("Ana Lopez", "Jane Smith") < 0.5);
});

test("matches are proposals with status, confidence, and alternatives", () => {
  const people = dataset.roster.map(player => ({ kind: "roster", name: player.name }));
  const [exact, fuzzy, unknown] = matchEntriesToPeople([
    { name: "Maureen OGuin" },
    { name: "Jane Srnith" },
    { name: "Taylor Nobody" }
  ], people, { ocrConfidence: 90 });
  assert.equal(exact.status, "proposed");
  assert.equal(exact.match.name, "Maureen O'Guin");
  assert.equal(exact.confidence, 0.9);
  assert.equal(fuzzy.status, "needs_review");
  assert.equal(fuzzy.match.name, "Jane Smith");
  assert.equal(unknown.status, "no_match");
  assert.equal(unknown.match, null);
});

test("close competing names are flagged ambiguous", () => {
  const [proposal] = matchEntriesToPeople([{ name: "Jane Smyth" }], [
    { kind: "roster", name: "Jane Smith" },
    { kind: "roster", name: "Janet Smyth" }
  ]);
  assert.equal(proposal.status, "ambiguous");
  assert.equal(proposal.alternatives.length, 1);
});

test("two screenshot rows cannot both claim one player", () => {
  const proposals = matchEntriesToPeople(
    [{ name: "Jane Smith" }, { name: "Jane Smithe" }],
    [{ kind: "roster", name: "Jane Smith" }]
  );
  assert.deepEqual(proposals.map(item => item.status), ["proposed", "duplicate_match"]);
});

test("low OCR confidence demotes otherwise exact matches to review", () => {
  const [proposal] = matchEntriesToPeople(
    [{ name: "Jane Smith" }],
    [{ kind: "roster", name: "Jane Smith" }],
    { ocrConfidence: 40 }
  );
  assert.equal(proposal.status, "needs_review");
});

test("screenshot proposals cover roster and opponents and never mutate the dataset", () => {
  const before = JSON.stringify(dataset);
  const report = proposeUtrScreenshotMatches(
    dataset,
    { text: `${rosterScreenshot}\nAna Lopez 4.10 4.22`, confidence: 88 },
    { scope: "all", source: "fixture" }
  );
  assert.equal(JSON.stringify(dataset), before);
  assert.equal(report.applied, false);
  assert.equal(report.layout, "roster");
  const ana = report.proposals.find(item => item.ocrName === "Ana Lopez");
  assert.deepEqual(ana.match, { name: "Ana Lopez", kind: "opponent", score: 1 });
  const priya = report.proposals.find(item => item.ocrName === "Priya Raman");
  assert.equal(priya.singles.value, null);
  assert.equal(priya.singles.display, "3.xx");
});

test("team scope excludes opponents from matching", () => {
  const report = proposeUtrScreenshotMatches(
    dataset,
    { text: "Ana Lopez 4.10 4.22\nJane Smith 2.91 3.02", confidence: null },
    { scope: "team" }
  );
  assert.equal(report.proposals[0].status, "no_match");
  assert.equal(report.proposals[1].status, "proposed");
});
