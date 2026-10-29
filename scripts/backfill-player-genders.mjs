#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { fetchText, readJson, sleep, writeJsonAtomic } from "./lib/io.mjs";
import { parsePlayerProfileMetadata } from "./lib/tennisrecord.mjs";

const usage = `Usage:
  node scripts/backfill-player-genders.mjs --input <team-data.json> [--delay-ms 250]

Reads each roster player's TennisRecord profile when their gender is missing
and records Men or Women. Known genders and every other field are left alone.`;

const KNOWN = new Set(["Men", "Women"]);

/**
 * Fills missing roster genders from TennisRecord player profiles.
 * Returns the names that were resolved and the ones that are still unknown.
 */
export async function backfillPlayerGenders(dataset, options = {}) {
  const fetchProfile = options.fetchProfile ?? fetchText;
  const delayMs = options.delayMs ?? 250;
  const resolved = [];
  const unresolved = [];
  for (const player of dataset.roster) {
    if (KNOWN.has(player.gender)) continue;
    if (!player.profileUrl) {
      unresolved.push(player.name);
      continue;
    }
    const { gender } = parsePlayerProfileMetadata(await fetchProfile(player.profileUrl));
    player.gender = gender;
    (KNOWN.has(gender) ? resolved : unresolved).push(player.name);
    if (delayMs) await sleep(delayMs);
  }
  if (resolved.length) {
    // Saved analyses are keyed on generatedAt, so this also invalidates them.
    dataset.generatedAt = new Date().toISOString();
    const source = dataset.sources.find(item => item.type === "tennisrecord");
    if (source && !source.fields.includes("player gender")) {
      source.fields.push("player gender");
    }
  }
  return { resolved, unresolved };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = resolve(requireArg(args, "input", usage));
    const dataset = await readJson(inputPath);
    const { resolved, unresolved } = await backfillPlayerGenders(dataset, {
      delayMs: Number(args["delay-ms"] ?? 250)
    });
    if (resolved.length) await writeJsonAtomic(inputPath, dataset);
    console.log(JSON.stringify({
      datasetId: dataset.datasetId,
      resolved: resolved.length,
      unresolved
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
