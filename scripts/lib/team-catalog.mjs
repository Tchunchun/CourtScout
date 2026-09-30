import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

async function findTeamDataFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTeamDataFiles(path));
    } else if (entry.isFile() && entry.name === "team-data.json") {
      files.push(path);
    }
  }
  return files;
}

function catalogId(dataDirectory, file) {
  return relative(dataDirectory, file)
    .split(sep)
    .slice(0, -1)
    .join("/");
}

export async function listTeamCatalog(dataDirectory) {
  const files = await findTeamDataFiles(dataDirectory);
  const teams = await Promise.all(files.map(async file => {
    const dataset = JSON.parse(await readFile(file, "utf8"));
    const tennisRecordSource = dataset.sources?.find(source =>
      source.type === "tennisrecord" && source.url
    );
    return {
      id: catalogId(dataDirectory, file),
      datasetId: dataset.datasetId,
      team: dataset.team,
      generatedAt: dataset.generatedAt,
      collectionStage: dataset.collectionStage,
      rosterSize: dataset.roster?.length ?? 0,
      matchCount: dataset.matches?.length ?? 0,
      sourceUrl: tennisRecordSource?.url ?? null,
      finalReportReady: dataset.collectionStage === "step_1_complete"
    };
  }));
  return teams.sort((a, b) =>
    (b.team?.season ?? 0) - (a.team?.season ?? 0) ||
    (a.team?.name ?? "").localeCompare(b.team?.name ?? "") ||
    b.generatedAt.localeCompare(a.generatedAt)
  );
}

export async function readCatalogTeam(dataDirectory, id) {
  const teams = await listTeamCatalog(dataDirectory);
  if (!teams.some(team => team.id === id)) {
    const error = new Error("Team dataset not found.");
    error.statusCode = 404;
    throw error;
  }
  return JSON.parse(await readFile(join(dataDirectory, id, "team-data.json"), "utf8"));
}
