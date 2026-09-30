import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const CATALOG_FILE = "team-catalog.json";
const NATIONAL_ROSTERS_FILE = "2026-national-rosters.json";

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

async function readConfiguredTeams(dataDirectory) {
  try {
    const catalog = JSON.parse(
      await readFile(join(dataDirectory, CATALOG_FILE), "utf8")
    );
    if (catalog?.version !== 1 || !Array.isArray(catalog.teams)) {
      throw new Error("Team catalog file is invalid.");
    }
    return catalog.teams;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readNationalRosters(dataDirectory) {
  try {
    const store = JSON.parse(
      await readFile(join(dataDirectory, NATIONAL_ROSTERS_FILE), "utf8")
    );
    if (
      store?.version !== 1 ||
      typeof store.activeAsOf !== "string" ||
      typeof store.source !== "string" ||
      !Array.isArray(store.teams)
    ) {
      throw new Error("National roster file is invalid.");
    }
    const datasetIds = new Set();
    for (const team of store.teams) {
      if (
        typeof team?.datasetId !== "string" ||
        !team.datasetId ||
        typeof team.name !== "string" ||
        !team.name ||
        typeof team.section !== "string" ||
        !team.section ||
        typeof team.captain !== "string" ||
        !team.captain ||
        !Array.isArray(team.roster) ||
        !team.roster.length
      ) {
        throw new Error("National roster file contains an invalid team.");
      }
      if (datasetIds.has(team.datasetId)) {
        throw new Error(`Duplicate national roster dataset: ${team.datasetId}`);
      }
      datasetIds.add(team.datasetId);
      const playerNames = new Set();
      for (const player of team.roster) {
        if (
          typeof player?.name !== "string" ||
          !player.name ||
          typeof player.ntrp !== "string" ||
          !player.ntrp ||
          !["F", "M"].includes(player.gender)
        ) {
          throw new Error(`Invalid national roster player for ${team.datasetId}.`);
        }
        const normalizedName = player.name.normalize("NFKD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();
        if (playerNames.has(normalizedName)) {
          throw new Error(`Duplicate national roster player for ${team.datasetId}: ${player.name}`);
        }
        playerNames.add(normalizedName);
      }
    }
    return store;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { activeAsOf: null, source: null, teams: [] };
    }
    throw error;
  }
}

export async function listTeamCatalog(dataDirectory) {
  const [files, configuredTeams, nationalRosterStore] = await Promise.all([
    findTeamDataFiles(dataDirectory),
    readConfiguredTeams(dataDirectory),
    readNationalRosters(dataDirectory)
  ]);
  const nationalTeams = new Map(
    nationalRosterStore.teams.map(team => [team.datasetId, team])
  );
  const gatheredTeams = await Promise.all(files.map(async file => {
    const dataset = JSON.parse(await readFile(file, "utf8"));
    const tennisRecordSource = dataset.sources?.find(source =>
      source.type === "tennisrecord" && source.url
    );
    return {
      id: catalogId(dataDirectory, file),
      datasetId: dataset.datasetId,
      team: {
        ...dataset.team,
        ...(configured || nationalTeam
          ? {
              name: nationalTeam?.name ?? configured.name,
              section: nationalTeam?.section ?? configured.section,
              captain: nationalTeam?.captain,
              nationalsRepresentative: Boolean(nationalTeam),
              sourceName: dataset.team?.name
            }
          : {})
      },
      generatedAt: dataset.generatedAt,
      collectionStage: dataset.collectionStage,
      rosterSize: dataset.roster?.length ?? 0,
      activeRosterSize: nationalTeam?.roster.length ?? null,
      nationalRoster: nationalTeam?.roster ?? null,
      nationalRosterAsOf: nationalTeam ? nationalRosterStore.activeAsOf : null,
      nationalRosterSource: nationalTeam ? nationalRosterStore.source : null,
      matchCount: dataset.matches?.length ?? 0,
      sourceUrl: tennisRecordSource?.url ?? null,
      finalReportReady: dataset.collectionStage === "step_1_complete"
    };
  }));
  const gatheredIds = new Set(gatheredTeams.map(team => team.datasetId));
  const pendingTeams = configuredTeams
    .filter(team => !gatheredIds.has(team.datasetId))
    .map(team => {
      const nationalTeam = nationalTeams.get(team.datasetId);
      return {
        id: `pending/${team.datasetId}`,
        datasetId: team.datasetId,
        team: {
          name: nationalTeam?.name ?? team.name,
          section: nationalTeam?.section ?? team.section,
          captain: nationalTeam?.captain,
          level: "3.0",
          gender: "Women",
          season: 2026,
          nationalsRepresentative: Boolean(nationalTeam)
        },
        generatedAt: null,
        collectionStage: "report_pending",
        rosterSize: 0,
        activeRosterSize: nationalTeam?.roster.length ?? null,
        nationalRoster: nationalTeam?.roster ?? null,
        nationalRosterAsOf: nationalTeam ? nationalRosterStore.activeAsOf : null,
        nationalRosterSource: nationalTeam ? nationalRosterStore.source : null,
        matchCount: 0,
        finalReportReady: false,
        reportAvailable: false,
        sourceUrl: team.sourceUrl ?? null
      };
    });
  const teams = [...gatheredTeams, ...pendingTeams];
  return teams.sort((a, b) =>
    (b.team?.season ?? 0) - (a.team?.season ?? 0) ||
    (a.team?.name ?? "").localeCompare(b.team?.name ?? "") ||
    (b.generatedAt ?? "").localeCompare(a.generatedAt ?? "")
  );
}

export async function readCatalogTeam(dataDirectory, id) {
  const teams = await listTeamCatalog(dataDirectory);
  const team = teams.find(item => item.id === id);
  if (!team || !team.reportAvailable) {
    const error = new Error("Team dataset not found.");
    error.statusCode = 404;
    throw error;
  }
  const dataset = JSON.parse(
    await readFile(join(dataDirectory, id, "team-data.json"), "utf8")
  );
  return {
    ...dataset,
    team: {
      ...dataset.team,
      ...team.team
    },
    ...(team.nationalRoster
      ? {
          nationalRoster: team.nationalRoster,
          nationalRosterAsOf: team.nationalRosterAsOf,
          nationalRosterSource: team.nationalRosterSource
        }
      : {})
  };
}
