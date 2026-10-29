#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { analyzeTeam } from "./lib/analysis.mjs";
import {
  GOLDEN_ROOT, FIXTURE_NAMES, SCOPES, readJson,
  validateInput, validateAnalysis, assertSchema, canonicalAnalysis
} from "../test/support/analysis-golden.mjs";

// Validate every result before overwriting any checked-in expectation.
const outputs = [];
for (const name of FIXTURE_NAMES) {
  const input = await readJson(new URL(`${name}/team-data.json`, GOLDEN_ROOT));
  assertSchema(validateInput, input, `${name} input`);
  for (const scope of SCOPES) {
    const actual = analyzeTeam(input, { eligibilityScope: scope });
    assertSchema(validateAnalysis, actual, `${name}/${scope}`);
    outputs.push({ name, scope, expected: canonicalAnalysis(actual) });
  }
}
for (const { name, scope, expected } of outputs) {
  const directory = new URL(`${name}/analysis/`, GOLDEN_ROOT);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`${scope}.json`, directory), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`Updated ${name}/analysis/${scope}.json`);
}
