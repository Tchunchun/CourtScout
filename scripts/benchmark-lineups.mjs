#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ANALYSIS_VERSION,
  analyzeEligibility,
  analyzeLineupPredictions
} from "./lib/analysis.mjs";

export const BENCHMARK_VERSION = "1.0.0";
export const DEFAULT_KNOWN_MATCH_COUNTS = Object.freeze([0, 1, 3, 5, 8]);
const ELIGIBILITY_SCOPES = new Set(["local", "sectional", "national"]);

function sortMatches(matches) {
  return [...matches].sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? "") ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
}

function appearancesFrom(matches, roster) {
  const byPlayer = new Map(roster.map(player => [player.name, {
    actual: 0,
    defaultsReceived: 0,
    sectionals: 0
  }]));
  for (const match of matches) {
    for (const court of Object.values(match.courts ?? {})) {
      for (const name of court.targetPlayers ?? []) {
        const counts = byPlayer.get(name);
        if (!counts) continue;
        if (court.adjudication === "default_received") {
          counts.defaultsReceived += 1;
        } else {
          counts.actual += 1;
        }
        if (match.phase?.startsWith("sectionals")) counts.sectionals += 1;
      }
    }
  }
  return byPlayer;
}

export function buildAsOfDataset(dataset, targetMatch, candidateEvidence) {
  if (!targetMatch?.date) {
    throw new Error("Benchmark targets require a match date.");
  }
  const matches = sortMatches(candidateEvidence).filter(match =>
    match.date && match.date < targetMatch.date
  );
  const appearances = appearancesFrom(matches, dataset.roster);
  return {
    ...structuredClone(dataset),
    generatedAt: targetMatch.date,
    matches: structuredClone(matches),
    roster: dataset.roster.map(player => {
      const counts = appearances.get(player.name) ?? {
        actual: 0,
        defaultsReceived: 0,
        sectionals: 0
      };
      return {
        ...structuredClone(player),
        qualifyingAppearances: {
          actual: counts.actual,
          defaultsReceived: counts.defaultsReceived
        },
        sectionalsAppearances: counts.sectionals,
        nationalsEligibility: {
          status: "unknown",
          display: `Not evaluated as of ${targetMatch.date}`
        }
      };
    })
  };
}

function normalizedPlayers(players) {
  return [...new Set(players ?? [])].sort((a, b) => a.localeCompare(b));
}

function actualLines(match) {
  return Object.entries(match.courts ?? {})
    .map(([court, value]) => ({
      court,
      players: normalizedPlayers(value.targetPlayers)
    }))
    .filter(line => line.players.length > 0)
    .sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }));
}

function predictionLines(prediction) {
  return (prediction?.lines ?? []).map(line => ({
    court: line.court,
    players: normalizedPlayers(line.players)
  }));
}

function samePlayers(a, b) {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

function playerSet(lines) {
  return new Set(lines.flatMap(line => line.players));
}

function doublesPairKeys(lines) {
  return new Set(lines
    .filter(line => line.court.startsWith("D") && line.players.length === 2)
    .map(line => JSON.stringify(line.players)));
}

export function scoreScenario(prediction, match) {
  const actual = actualLines(match);
  const predicted = predictionLines(prediction);
  const actualPlayers = playerSet(actual);
  const predictedPlayers = playerSet(predicted);
  const correctPlayers = [...predictedPlayers]
    .filter(player => actualPlayers.has(player)).length;
  const actualPairs = doublesPairKeys(actual);
  const predictedPairs = doublesPairKeys(predicted);
  const correctPairs = [...actualPairs].filter(pair => predictedPairs.has(pair)).length;
  const correctCourts = actual.filter(actualLine => {
    const predictedLine = predicted.find(line => line.court === actualLine.court);
    return predictedLine && samePlayers(predictedLine.players, actualLine.players);
  }).length;
  const completeLineup = actual.length > 0 &&
    predicted.length === actual.length &&
    correctCourts === actual.length;
  return {
    players: {
      correct: correctPlayers,
      predicted: predictedPlayers.size,
      actual: actualPlayers.size
    },
    doublesPairs: { correct: correctPairs, actual: actualPairs.size },
    courts: { correct: correctCourts, actual: actual.length },
    completeLineup
  };
}

function closestScenario(scored) {
  return [...scored].sort((a, b) =>
    b.score.courts.correct - a.score.courts.correct ||
    b.score.players.correct - a.score.players.correct ||
    a.rank - b.rank
  )[0] ?? null;
}

export function evaluatePredictions(predictions, match) {
  const scored = (predictions ?? []).slice(0, 3).map((prediction, index) => ({
    rank: prediction.rank ?? index + 1,
    score: scoreScenario(prediction, match)
  }));
  const top = scored[0]?.score ?? scoreScenario(null, match);
  const closest = closestScenario(scored);
  return {
    top,
    topThreeCompleteLineup: scored.some(item => item.score.completeLineup),
    closestScenarioRank: closest?.rank ?? null,
    closestScenario: closest?.score ?? null
  };
}

export function benchmarkDataset(dataset, options = {}) {
  const knownMatchCounts = options.knownMatchCounts ?? DEFAULT_KNOWN_MATCH_COUNTS;
  const eligibilityScope = options.eligibilityScope ?? "local";
  if (!ELIGIBILITY_SCOPES.has(eligibilityScope)) {
    throw new Error(`Unknown eligibility scope: ${eligibilityScope}`);
  }
  const matches = sortMatches(dataset.matches).filter(match => match.date);
  const samples = [];
  const skipped = [];
  for (const requestedKnownMatches of knownMatchCounts) {
    const target = matches[requestedKnownMatches];
    if (!target) {
      skipped.push({ requestedKnownMatches, reason: "no_next_dated_match" });
      continue;
    }
    if (actualLines(target).length === 0) {
      skipped.push({
        requestedKnownMatches,
        targetMatchId: target.id ?? null,
        reason: "no_actual_courts"
      });
      continue;
    }
    const asOf = buildAsOfDataset(
      dataset,
      target,
      matches.slice(0, requestedKnownMatches)
    );
    const eligibility = analyzeEligibility(asOf, eligibilityScope);
    const result = analyzeLineupPredictions(asOf, eligibility);
    const evaluation = evaluatePredictions(result.predictions, target);
    samples.push({
      datasetId: dataset.datasetId ?? null,
      requestedKnownMatches,
      evidenceMatchCount: asOf.matches.length,
      evidenceMatchIds: asOf.matches.map(match => match.id ?? null),
      evidenceCutoff: asOf.matches.at(-1)?.date ?? null,
      targetMatchId: target.id ?? null,
      targetDate: target.date,
      predictionsGenerated: result.predictions.length,
      ...evaluation
    });
  }
  return { datasetId: dataset.datasetId ?? null, samples, skipped };
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

export function aggregateSamples(samples) {
  const totals = samples.reduce((result, sample) => {
    result.matches += 1;
    result.matchesWithPredictions += sample.predictionsGenerated > 0 ? 1 : 0;
    result.playersCorrect += sample.top.players.correct;
    result.playersPredicted += sample.top.players.predicted;
    result.playersActual += sample.top.players.actual;
    result.pairsCorrect += sample.top.doublesPairs.correct;
    result.pairsActual += sample.top.doublesPairs.actual;
    result.courtsCorrect += sample.top.courts.correct;
    result.courtsActual += sample.top.courts.actual;
    result.topThreeComplete += sample.topThreeCompleteLineup ? 1 : 0;
    result.topOneComplete += sample.top.completeLineup ? 1 : 0;
    return result;
  }, {
    matches: 0,
    matchesWithPredictions: 0,
    playersCorrect: 0,
    playersPredicted: 0,
    playersActual: 0,
    pairsCorrect: 0,
    pairsActual: 0,
    courtsCorrect: 0,
    courtsActual: 0,
    topThreeComplete: 0,
    topOneComplete: 0
  });
  return {
    samples: totals.matches,
    matchesWithPredictions: totals.matchesWithPredictions,
    playerInclusionPrecision: ratio(totals.playersCorrect, totals.playersPredicted),
    playerInclusionRecall: ratio(totals.playersCorrect, totals.playersActual),
    doublesPairAccuracy: ratio(totals.pairsCorrect, totals.pairsActual),
    exactCourtAccuracy: ratio(totals.courtsCorrect, totals.courtsActual),
    topThreeCoverage: ratio(totals.topThreeComplete, totals.matches),
    completeLineupAccuracy: ratio(totals.topOneComplete, totals.matches),
    counts: totals
  };
}

export function buildBenchmarkReport(inputs, options = {}) {
  const eligibilityScope = options.eligibilityScope ?? "local";
  const knownMatchCounts = options.knownMatchCounts ?? DEFAULT_KNOWN_MATCH_COUNTS;
  const results = inputs.map(input => ({
    path: input.path ?? null,
    ...benchmarkDataset(input.dataset, { eligibilityScope, knownMatchCounts })
  }));
  const samples = results.flatMap(result => result.samples);
  const byKnownMatches = Object.fromEntries(knownMatchCounts.map(count => [
    String(count),
    aggregateSamples(samples.filter(sample => sample.requestedKnownMatches === count))
  ]));
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    generatedAt: new Date().toISOString(),
    eligibilityScope,
    knownMatchCounts,
    inputs: results.map(result => ({
      path: result.path,
      datasetId: result.datasetId,
      sampleCount: result.samples.length,
      skipped: result.skipped
    })),
    aggregate: aggregateSamples(samples),
    byKnownMatches,
    samples
  };
}

function percent(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatMarkdown(report) {
  const lines = [
    "# Lineup prediction benchmark",
    "",
    `- Benchmark version: ${report.benchmarkVersion}`,
    `- Analysis version: ${report.analysisVersion}`,
    `- Eligibility scope: ${report.eligibilityScope}`,
    `- Datasets: ${report.inputs.length}`,
    `- Evaluated samples: ${report.aggregate.samples}`,
    "",
    "| Known matches | Samples | Prediction rate | Player recall | Pair accuracy | Exact court | Top-three coverage | Top-one complete |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];
  for (const count of report.knownMatchCounts) {
    const value = report.byKnownMatches[String(count)];
    lines.push(`| ${count} | ${value.samples} | ${percent(ratio(value.matchesWithPredictions, value.samples))} | ${percent(value.playerInclusionRecall)} | ${percent(value.doublesPairAccuracy)} | ${percent(value.exactCourtAccuracy)} | ${percent(value.topThreeCoverage)} | ${percent(value.completeLineupAccuracy)} |`);
  }
  lines.push(
    "",
    "## Overall",
    "",
    `- Player inclusion precision: ${percent(report.aggregate.playerInclusionPrecision)}`,
    `- Player inclusion recall: ${percent(report.aggregate.playerInclusionRecall)}`,
    `- Doubles-pair accuracy: ${percent(report.aggregate.doublesPairAccuracy)}`,
    `- Exact-court accuracy: ${percent(report.aggregate.exactCourtAccuracy)}`,
    `- Top-three coverage: ${percent(report.aggregate.topThreeCoverage)}`,
    `- Complete-lineup accuracy: ${percent(report.aggregate.completeLineupAccuracy)}`,
    ""
  );
  return lines.join("\n");
}

async function datasetPaths(inputPath) {
  const absolute = resolve(inputPath);
  const details = await stat(absolute);
  if (details.isFile()) return [absolute];
  const found = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && basename(path) === "team-data.json") found.push(path);
    }
  }
  await visit(absolute);
  return found;
}

function parseCli(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) args[token.slice(2)] = true;
    else {
      args[token.slice(2)] = value;
      index += 1;
    }
  }
  if (!args.input || args.input === true) {
    throw new Error("Usage: node scripts/benchmark-lineups.mjs --input <file-or-directory> [--known 0,1,3,5,8] [--scope local|sectional|national] [--format markdown|json]");
  }
  const knownMatchCounts = String(args.known ?? DEFAULT_KNOWN_MATCH_COUNTS.join(","))
    .split(",")
    .map(value => Number(value.trim()));
  if (knownMatchCounts.some(value => !Number.isInteger(value) || value < 0)) {
    throw new Error("--known must contain comma-separated non-negative integers.");
  }
  const eligibilityScope = String(args.scope ?? "local");
  if (!ELIGIBILITY_SCOPES.has(eligibilityScope)) {
    throw new Error("--scope must be local, sectional, or national.");
  }
  const format = String(args.format ?? "markdown");
  if (!["markdown", "json"].includes(format)) {
    throw new Error("--format must be markdown or json.");
  }
  return { input: args.input, knownMatchCounts, eligibilityScope, format };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const paths = await datasetPaths(options.input);
  if (!paths.length) throw new Error("No team-data.json files found.");
  const inputs = await Promise.all(paths.map(async path => ({
    path,
    dataset: JSON.parse(await readFile(path, "utf8"))
  })));
  const report = buildBenchmarkReport(inputs, options);
  process.stdout.write(options.format === "json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${formatMarkdown(report)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
