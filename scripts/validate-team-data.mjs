#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { readJson } from "./lib/io.mjs";
import { normalizeName } from "./lib/ratings.mjs";

const usage = `Usage:
  npm run validate:data -- --input <team-data.json> [--allow-partial]`;

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter(value => seen.has(value) || !seen.add(value)))];
}

try {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(requireArg(args, "input", usage));
  const dataset = await readJson(inputPath);
  const schema = JSON.parse(
    await readFile(resolve("contracts/team-data.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const errors = [];
  if (!validate(dataset)) {
    errors.push(...validate.errors.map(error =>
      `${error.instancePath || "/"} ${error.message}`
    ));
  }
  if (!args["allow-partial"] && dataset.collectionStage !== "step_1_complete") {
    errors.push(`collectionStage is ${dataset.collectionStage}; expected step_1_complete`);
  }
  const rosterNames = dataset.roster.map(player => player.name);
  const opponentNames = dataset.opponents.map(player => player.name);
  const rosterSet = new Set(rosterNames);
  const opponentSet = new Set(opponentNames);
  const duplicateRoster = duplicates(rosterNames);
  const duplicateOpponents = duplicates(opponentNames);
  const duplicateMatches = duplicates(dataset.matches.map(match => match.id));
  const normalizedRosterDuplicates = duplicates(rosterNames.map(normalizeName));
  const normalizedOpponentDuplicates = duplicates(opponentNames.map(normalizeName));
  if (duplicateRoster.length) errors.push(`duplicate roster names: ${duplicateRoster.join(", ")}`);
  if (duplicateOpponents.length) errors.push(`duplicate opponents: ${duplicateOpponents.join(", ")}`);
  if (duplicateMatches.length) errors.push(`duplicate match IDs: ${duplicateMatches.join(", ")}`);
  if (normalizedRosterDuplicates.length) {
    errors.push(`duplicate normalized roster identities: ${normalizedRosterDuplicates.join(", ")}`);
  }
  if (normalizedOpponentDuplicates.length) {
    errors.push(`duplicate normalized opponent identities: ${normalizedOpponentDuplicates.join(", ")}`);
  }

  for (const match of dataset.matches) {
    let courtWins = 0;
    let courtLosses = 0;
    for (const [courtName, court] of Object.entries(match.courts)) {
      const path = `${match.id}/${courtName}`;
      if (court.targetPlayers.length !== court.targetRatings.length) {
        errors.push(`${path}: target player/rating join count mismatch`);
      }
      if (court.opponentPlayers.length !== court.opponentRatings.length) {
        errors.push(`${path}: opponent player/rating join count mismatch`);
      }
      for (const name of court.targetPlayers) {
        if (!rosterSet.has(name)) errors.push(`${path}: target player not in roster: ${name}`);
      }
      for (const name of court.opponentPlayers) {
        if (!opponentSet.has(name)) errors.push(`${path}: opponent not normalized: ${name}`);
      }
      const expectedPlayers = courtName.startsWith("D") ? 2 : 1;
      if (!court.adjudication && court.targetPlayers.length !== expectedPlayers) {
        errors.push(`${path}: expected ${expectedPlayers} target players`);
      }
      if (!court.adjudication && court.opponentPlayers.length !== expectedPlayers) {
        errors.push(`${path}: expected ${expectedPlayers} opponent players`);
      }
      courtWins += court.result === "W" ? 1 : 0;
      courtLosses += court.result === "L" ? 1 : 0;
    }
    if (match.teamResult.wins !== courtWins || match.teamResult.losses !== courtLosses) {
      errors.push(
        `${match.id}: team result ${match.teamResult.wins}-${match.teamResult.losses} ` +
        `does not match courts ${courtWins}-${courtLosses}`
      );
    }
  }
  if (dataset.team.reportedTotals) {
    const totals = dataset.matches.reduce((result, match) => {
      result.teamWins += match.teamResult.result === "W" ? 1 : 0;
      result.teamLosses += match.teamResult.result === "L" ? 1 : 0;
      result.courtWins += match.teamResult.wins;
      result.courtLosses += match.teamResult.losses;
      return result;
    }, { teamWins: 0, teamLosses: 0, courtWins: 0, courtLosses: 0 });
    for (const key of Object.keys(totals)) {
      if (dataset.team.reportedTotals[key] !== totals[key]) {
        errors.push(
          `team.reportedTotals.${key}=${dataset.team.reportedTotals[key]} ` +
          `does not match derived ${totals[key]}`
        );
      }
    }
  }
  if (dataset.collectionStage === "step_1_complete") {
    const selections = dataset.ratingSelections;
    if (selections) {
      const hasSource = type => dataset.sources.some(source => source.type === type);
      if (
        selections.utr === "authenticated" &&
        !hasSource("utr_sports_authenticated_profiles") &&
        !hasSource("utr_sports_authenticated_opponent_profiles")
      ) {
        errors.push("complete dataset requested authenticated UTR but has no authenticated UTR source");
      }
      if (
        selections.utr === "public" &&
        !hasSource("utr_sports_public_profiles")
      ) {
        errors.push("complete dataset requested public UTR but has no public UTR source");
      }
      if (
        selections.wtn &&
        !hasSource("world_tennis_number_public_profiles")
      ) {
        errors.push("complete dataset requested WTN but has no WTN source");
      }
    } else {
      const hasUtrSource = dataset.sources.some(source =>
        source.type === "utr_sports_authenticated_profiles" ||
        source.type === "utr_sports_authenticated_opponent_profiles"
      );
      if (!hasUtrSource) errors.push("complete dataset has no authenticated UTR source");
    }
    for (const player of [...dataset.roster, ...dataset.opponents]) {
      if (player.utr.exactDecimalsAvailable === false) {
        if (
          player.utr.singles.exactValue != null ||
          player.utr.doubles.exactValue != null
        ) {
          errors.push(`${player.name}: unresolved UTR identity contains exact values`);
        }
      }
    }
  }

  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    const courtCount = dataset.matches.reduce(
      (total, match) => total + Object.keys(match.courts).length,
      0
    );
    console.log(`Valid ${dataset.schemaVersion} dataset`);
    console.log(`${dataset.roster.length} roster players`);
    console.log(`${dataset.opponents.length} opponents`);
    console.log(`${dataset.matches.length} matches / ${courtCount} courts`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
