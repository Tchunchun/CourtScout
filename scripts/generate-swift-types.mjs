#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SCHEMA_PATH = resolve(ROOT, "contracts/team-data.schema.json");
export const SWIFT_OUTPUT_PATH = resolve(
  ROOT,
  "ios/CourtScoutModels/Sources/CourtScoutModels/TeamData.generated.swift"
);
const usage = `Usage:
  node scripts/generate-swift-types.mjs [--check]

Writes Swift Codable types for contracts/team-data.schema.json. With --check,
exits non-zero when the checked-in Swift file is out of date.`;

const ACRONYMS = { Ntrp: "NTRP", Utr: "UTR", Wtn: "WTN", Dr: "DR" };
const RESERVED = new Set([
  "as", "case", "class", "default", "enum", "extension", "fileprivate", "func",
  "import", "in", "init", "internal", "is", "let", "operator", "private",
  "protocol", "public", "repeat", "return", "self", "static", "struct", "Type",
  "var", "where"
]);
// `.none` on an optional enum resolves to Optional.none, so rename it.
const CASE_RENAMES = { none: "noneValue" };
const INDENT = "    ";

function typeName(key) {
  const name = key[0].toUpperCase() + key.slice(1);
  return ACRONYMS[name] ?? name;
}

function identifier(name) {
  return RESERVED.has(name) ? `\`${name}\`` : name;
}

function caseName(value) {
  const words = String(value).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words
    .map((word, index) => index === 0
      ? word.toLowerCase()
      : word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  return identifier(CASE_RENAMES[name] ?? (/^\d/.test(name) ? `_${name}` : name));
}

function typesOf(schema) {
  if (Array.isArray(schema.type)) return schema.type;
  if (schema.type) return [schema.type];
  if ("const" in schema) {
    return [typeof schema.const === "number" ? "number" : typeof schema.const];
  }
  return [];
}

function isStruct(schema) {
  return typesOf(schema).includes("object") && Boolean(schema.properties);
}

function createGenerator(root) {
  function describe(schema, propName, nested) {
    if (schema.$ref) {
      const defName = schema.$ref.split("/").at(-1);
      const def = root.$defs[defName];
      if (isStruct(def)) {
        return { type: typeName(defName), nullable: typesOf(def).includes("null") };
      }
      return describe(def, propName, nested);
    }

    const types = typesOf(schema);
    let nullable = types.includes("null");
    const base = types.find(type => type !== "null");

    if (schema.enum) {
      nullable ||= schema.enum.includes(null);
      const name = typeName(propName);
      nested.push(enumDecl(name, schema.enum.filter(value => value !== null)));
      return { type: name, nullable };
    }
    if (base === "string") return { type: "String", nullable };
    if (base === "integer") return { type: "Int", nullable };
    if (base === "number") return { type: "Double", nullable };
    if (base === "boolean") return { type: "Bool", nullable };
    if (base === "array") {
      const item = describe(schema.items ?? {}, propName, nested);
      return { type: `[${item.type}${item.nullable ? "?" : ""}]`, nullable };
    }
    if (base === "object" && schema.properties) {
      const name = typeName(propName);
      nested.push(structDecl(name, schema));
      return { type: name, nullable };
    }
    if (base === "object" && typeof schema.additionalProperties === "object") {
      const value = describe(schema.additionalProperties, propName, nested);
      return { type: `[String: ${value.type}]`, nullable };
    }
    return { type: "JSONValue", nullable };
  }

  function enumDecl(name, values) {
    return [
      `public struct ${name}: RawRepresentable, Codable, Hashable, Sendable {`,
      `${INDENT}public var rawValue: String`,
      "",
      `${INDENT}public init(rawValue: String) {`,
      `${INDENT}${INDENT}self.rawValue = rawValue`,
      `${INDENT}}`,
      "",
      ...values.map(value =>
        `${INDENT}public static let ${caseName(value)} = Self(rawValue: ${JSON.stringify(value)})`
      ),
      "",
      `${INDENT}public static let knownValues: [Self] = [${values.map(value => `.${caseName(value)}`).join(", ")}]`,
      "}"
    ];
  }

  function structDecl(name, schema) {
    const required = new Set(schema.required ?? []);
    const keepsExtras = schema.additionalProperties !== false;
    const nested = [];
    const fields = Object.entries(schema.properties).map(([key, propSchema]) => {
      const description = describe(propSchema, key, nested);
      const isRequired = required.has(key);
      return {
        key,
        name: identifier(key),
        type: description.type,
        optional: description.nullable || !isRequired,
        // "null" encodes null when nil; "tracked" does so only if the key was null on decode.
        nullEncoding: !description.nullable ? null : isRequired ? "null" : "tracked"
      };
    });
    const tracksNulls = fields.some(field => field.nullEncoding === "tracked");
    const fieldType = field => `${field.type}${field.optional ? "?" : ""}`;
    const initParams = [
      ...fields.map(field =>
        `${field.name}: ${fieldType(field)}${field.optional ? " = nil" : ""}`
      ),
      ...(keepsExtras ? ["additionalProperties: [String: JSONValue] = [:]"] : [])
    ];

    const lines = [
      `public struct ${name}: Codable, Hashable, Sendable {`,
      ...fields.map(field => `${INDENT}public var ${field.name}: ${fieldType(field)}`),
      ...(keepsExtras ? [
        `${INDENT}/// Keys the schema does not declare, kept so encoding round-trips.`,
        `${INDENT}public var additionalProperties: [String: JSONValue]`
      ] : []),
      ...(tracksNulls ? [
        `${INDENT}/// Optional keys decoded as an explicit null, so encoding keeps null versus absent.`,
        `${INDENT}var explicitNullKeys: Set<String> = []`
      ] : []),
      "",
      `${INDENT}public init(`,
      ...initParams.map((param, index) =>
        `${INDENT}${INDENT}${param}${index < initParams.length - 1 ? "," : ""}`
      ),
      `${INDENT}) {`,
      ...fields.map(field => `${INDENT}${INDENT}self.${field.name} = ${field.name}`),
      ...(keepsExtras ? [`${INDENT}${INDENT}self.additionalProperties = additionalProperties`] : []),
      `${INDENT}}`,
      "",
      `${INDENT}enum CodingKeys: String, CodingKey, CaseIterable {`,
      ...fields.map(field => `${INDENT}${INDENT}case ${field.name}`),
      `${INDENT}}`,
      "",
      `${INDENT}public init(from decoder: any Decoder) throws {`,
      `${INDENT}${INDENT}let container = try decoder.container(keyedBy: CodingKeys.self)`,
      ...fields.map(field =>
        `${INDENT}${INDENT}${field.name} = try container.${field.optional ? "decodeIfPresent" : "decode"}` +
        `(${field.type}.self, forKey: .${field.key})`
      ),
      ...fields.filter(field => field.nullEncoding === "tracked").map(field =>
        `${INDENT}${INDENT}if ${field.name} == nil && container.contains(.${field.key}) { explicitNullKeys.insert("${field.key}") }`
      ),
      ...(keepsExtras ? [
        `${INDENT}${INDENT}additionalProperties = try decoder.additionalProperties(excluding: CodingKeys.self)`
      ] : []),
      `${INDENT}}`,
      "",
      `${INDENT}public func encode(to encoder: any Encoder) throws {`,
      `${INDENT}${INDENT}var container = encoder.container(keyedBy: CodingKeys.self)`,
      ...fields.map(field => field.nullEncoding === "tracked"
        ? `${INDENT}${INDENT}if let ${field.name} { try container.encode(${field.name}, forKey: .${field.key}) } ` +
          `else if explicitNullKeys.contains("${field.key}") { try container.encodeNil(forKey: .${field.key}) }`
        : `${INDENT}${INDENT}try container.${field.optional && !field.nullEncoding ? "encodeIfPresent" : "encode"}` +
          `(${field.name}, forKey: .${field.key})`
      ),
      ...(keepsExtras ? [`${INDENT}${INDENT}try encoder.encodeAdditionalProperties(additionalProperties)`] : []),
      `${INDENT}}`
    ];
    for (const declaration of nested) {
      lines.push("", ...declaration.map(line => line ? `${INDENT}${line}` : line));
    }
    lines.push("}");
    return lines;
  }

  return { structDecl };
}

export function generateSwift(schema) {
  const { structDecl } = createGenerator(schema);
  const declarations = [
    structDecl("TeamData", schema),
    [
      "extension TeamData {",
      `${INDENT}/// \`schemaVersion\` this file was generated from.`,
      `${INDENT}public static let contractVersion = ${JSON.stringify(schema.properties.schemaVersion.const)}`,
      "}"
    ],
    ...Object.entries(schema.$defs)
      .filter(([, def]) => isStruct(def))
      .map(([name, def]) => structDecl(typeName(name), def))
  ];
  return [
    "// Generated by scripts/generate-swift-types.mjs from contracts/team-data.schema.json.",
    "// Do not edit by hand; run `npm run generate:swift` after changing the schema.",
    "",
    "import Foundation",
    "",
    declarations.map(lines => lines.join("\n")).join("\n\n"),
    ""
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) throw new Error(usage);
    const swift = generateSwift(JSON.parse(await readFile(SCHEMA_PATH, "utf8")));
    if (args.check) {
      const current = await readFile(SWIFT_OUTPUT_PATH, "utf8").catch(() => "");
      if (current !== swift) {
        throw new Error("Swift types are out of date; run `npm run generate:swift`.");
      }
    } else {
      await writeFile(SWIFT_OUTPUT_PATH, swift);
      console.log(`Wrote ${SWIFT_OUTPUT_PATH}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
