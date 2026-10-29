#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli.mjs";
import { readJson } from "./lib/io.mjs";
import { ratingPeople } from "./lib/ratings.mjs";
import {
  matchEntriesToPeople,
  parseUtrScreenshotText
} from "./lib/utr-screenshot.mjs";

const usage = `Usage:
  node scripts/utr-screenshot-ocr.mjs --dataset <team-data.json>
    (--image <screenshot.png> | --text <ocr-output.txt>)
    [--scope all|team|opponents] [--output proposals.json]
    [--cache-dir data/.ocr-cache]

Reads a UTR profile or roster screenshot and proposes rating matches against
the dataset's players. Proposals are never written into the dataset.`;

async function recognize(imagePath, cachePath) {
  const { default: Tesseract } = await import("tesseract.js");
  await mkdir(cachePath, { recursive: true });
  const result = await Tesseract.recognize(await readFile(imagePath), "eng", { cachePath });
  return {
    text: result.data?.text ?? "",
    confidence: Number.isFinite(result.data?.confidence)
      ? Math.round(result.data.confidence)
      : null
  };
}

export function proposeUtrScreenshotMatches(dataset, ocr, options = {}) {
  const { layout, entries } = parseUtrScreenshotText(ocr.text);
  const people = ratingPeople(dataset, options.scope ?? "all");
  return {
    generatedAt: new Date().toISOString(),
    source: options.source ?? null,
    datasetId: dataset.datasetId ?? null,
    ocrConfidence: ocr.confidence ?? null,
    layout,
    applied: false,
    note:
      "Proposals only. Confirm each match before any rating is written; " +
      "masked displays such as 3.xx stay masked.",
    proposals: matchEntriesToPeople(entries, people, {
      ocrConfidence: ocr.confidence ?? null
    })
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.dataset || (!args.image && !args.text)) {
      throw new Error(usage);
    }
    const dataset = await readJson(resolve(args.dataset));
    const ocr = args.text
      ? { text: await readFile(resolve(args.text), "utf8"), confidence: null }
      : await recognize(resolve(args.image), resolve(args["cache-dir"] ?? "data/.ocr-cache"));
    const report = proposeUtrScreenshotMatches(dataset, ocr, {
      scope: args.scope,
      source: args.image ?? args.text
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) await writeFile(resolve(args.output), output);
    else process.stdout.write(output);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
