import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const GOLDEN_ROOT = new URL("../fixtures/golden/", import.meta.url);
export const FIXTURE_NAMES = ["women-sparse", "women-rich", "mixed-sparse", "mixed-rich"];
export const SCOPES = ["local", "sectional", "national"];
export const GENERATED_AT = "2026-01-01T00:00:00.000Z";

export async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const teamSchema = await readJson(new URL("../../contracts/team-data.schema.json", import.meta.url));
ajv.addSchema(teamSchema);
export const validateInput = ajv.getSchema(teamSchema.$id);
export const validateAnalysis = ajv.compile(
  await readJson(new URL("../../contracts/analysis.schema.json", import.meta.url))
);

export function assertSchema(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

// Match the persisted JSON representation; only the runtime timestamp is replaced.
// Array order, all numeric values, and the source dataset timestamp stay intact.
export function canonicalAnalysis(analysis) {
  return JSON.parse(JSON.stringify({ ...analysis, generatedAt: GENERATED_AT }));
}
