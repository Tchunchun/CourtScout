import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  generateSwift,
  SCHEMA_PATH,
  SWIFT_OUTPUT_PATH
} from "../scripts/generate-swift-types.mjs";

const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));

test("checked-in Swift types match the team data schema", async () => {
  assert.equal(
    await readFile(SWIFT_OUTPUT_PATH, "utf8"),
    generateSwift(schema),
    "Run `npm run generate:swift` after changing the schema."
  );
});

test("Swift types keep required nullable keys and open enums", () => {
  const swift = generateSwift(schema);
  assert.match(swift, /public var value: Double\?/);
  assert.match(swift, /try container\.encode\(value, forKey: \.value\)/);
  assert.match(swift, /public var courts: \[String: Court\]/);
  assert.match(swift, /public static let sectionalsFinal = Self\(rawValue: "sectionals_final"\)/);
  assert.match(swift, /public static let contractVersion = "2\.0\.0"/);
});
