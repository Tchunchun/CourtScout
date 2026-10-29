#!/usr/bin/env node
// Prints the feature board from features/*.md and warns about overlapping work.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const statusOrder = ["in-progress", "review", "ready", "blocked", "idea", "done"];
const activeStatuses = new Set(["in-progress", "review"]);

export function parseFeature(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const feature = {};
  let listKey = null;
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "");
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) {
      feature[listKey].push(item[1].trim());
      continue;
    }
    const pair = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === "") {
      feature[key] = [];
      listKey = key;
    } else if (value.startsWith("[")) {
      feature[key] = value.slice(1, -1).split(",").map(v => v.trim().replace(/^"|"$/g, "")).filter(Boolean);
      listKey = null;
    } else {
      feature[key] = value.replace(/^"|"$/g, "");
      listKey = null;
    }
  }
  return feature;
}

function overlaps(a, b) {
  const trim = path => path.replace(/\/+$/, "");
  return a.map(trim).some(left => b.map(trim).some(right =>
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
  ));
}

const dir = resolve("features");
const files = (await readdir(dir)).filter(name => /^\d{3}-.+\.md$/.test(name)).sort();
const features = [];
for (const name of files) {
  const feature = parseFeature(await readFile(join(dir, name), "utf8"));
  if (feature) features.push({ ...feature, file: name });
}
const byId = new Map(features.map(feature => [feature.id, feature]));

for (const status of statusOrder) {
  const group = features.filter(feature => feature.status === status);
  if (!group.length) continue;
  console.log(`\n## ${status} (${group.length})\n`);
  console.log("| id | pri | area | title | depends on | branch |");
  console.log("|---|---|---|---|---|---|");
  for (const feature of group) {
    const deps = (feature.depends_on || []).map(id => {
      const dep = byId.get(id);
      return dep?.status === "done" ? `~~${id}~~` : id;
    }).join(", ");
    console.log(`| ${feature.id} | ${feature.priority || ""} | ${feature.area || ""} | ${feature.title} | ${deps} | ${Array.isArray(feature.branch) ? "" : feature.branch || ""} |`);
  }
}

const warnings = [];
const active = features.filter(feature => activeStatuses.has(feature.status));
for (const [index, left] of active.entries()) {
  for (const right of active.slice(index + 1)) {
    if (overlaps(left.touches || [], right.touches || [])) {
      warnings.push(`${left.id} and ${right.id} are both active and touch the same files.`);
    }
  }
}
for (const feature of features.filter(f => f.status === "ready")) {
  const pending = (feature.depends_on || []).filter(id => byId.get(id)?.status !== "done");
  if (pending.length) warnings.push(`${feature.id} is ready but depends on unfinished ${pending.join(", ")}.`);
}
if (warnings.length) {
  console.log("\n## Warnings\n");
  for (const warning of warnings) console.log(`- ${warning}`);
}
