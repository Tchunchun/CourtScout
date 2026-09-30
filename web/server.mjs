#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Tesseract from "tesseract.js";
import {
  ANALYSIS_VERSION,
  analyzeTeam,
  ELIGIBILITY_SCOPES
} from "../scripts/lib/analysis.mjs";
import { readJson, writeJsonAtomic } from "../scripts/lib/io.mjs";
import {
  listTeamCatalog,
  readCatalogTeam
} from "../scripts/lib/team-catalog.mjs";
import {
  assignTeamToCollection,
  createTeamCollection,
  deleteTeamCollection,
  getTeamCollection,
  listTeamCollections,
  renameTeamCollection
} from "../scripts/lib/team-collections.mjs";
import {
  confirmEventSchedule,
  deleteEventSchedule,
  getEventSchedule,
  linkScheduledOpponent,
  normalizeScheduledMatch,
  reconcileEventSchedule
} from "../scripts/lib/event-schedules.mjs";
import {
  readMatchCards,
  writeMatchCards
} from "../scripts/lib/match-cards-store.mjs";
import { emptyRating, normalizeName } from "../scripts/lib/ratings.mjs";
import { previewTennisRecordTeam } from "../scripts/lib/tennisrecord.mjs";
import { updateCourtJoins } from "../scripts/lib/utr.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "web", "public");
const DATA_DIR = resolveDataDirectory(ROOT, process.env.COURT_SCOUT_DATA_DIR);
const PORT = Number(process.env.PORT ?? 4173);
const UTR_SESSION = "tennis-scout-ui";
const jobs = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function resolveDataDirectory(root, configuredDirectory) {
  if (configuredDirectory) return resolve(configuredDirectory);

  const localDataDirectory = join(root, "data");
  const gitPath = join(root, ".git");
  if (!existsSync(gitPath) || statSync(gitPath).isDirectory()) {
    return localDataDirectory;
  }

  const match = readFileSync(gitPath, "utf8").trim().match(/^gitdir:\s*(.+)$/);
  if (!match) return localDataDirectory;
  const worktreeGitDirectory = resolve(root, match[1]);
  const primaryRoot = dirname(resolve(worktreeGitDirectory, "../.."));
  const sharedDataDirectory = join(primaryRoot, "data");
  return existsSync(join(sharedDataDirectory, "team-collections.json"))
    ? sharedDataDirectory
    : localDataDirectory;
}

export function validateTeamUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a complete TennisRecord team URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The TennisRecord URL must use HTTP or HTTPS.");
  }
  if (!["tennisrecord.com", "www.tennisrecord.com"].includes(url.hostname.toLowerCase())) {
    throw new Error("Use a team profile URL from tennisrecord.com.");
  }
  if (!url.pathname.toLowerCase().endsWith("/teamprofile.aspx")) {
    throw new Error("Use the TennisRecord team profile page, not a player or match page.");
  }
  if (!url.searchParams.get("teamname")) {
    throw new Error("The TennisRecord URL is missing its team name.");
  }
  return url.href;
}

export function parseTeamType(value = "opponent") {
  if (!["home", "opponent"].includes(value)) {
    throw new Error("Choose whether the TennisRecord URL is for a home team or an opponent team.");
  }
  return value;
}

export function findActiveScoutingJob(jobList, teamUrl, teamType) {
  return [...jobList].find(job =>
    job.teamUrl === teamUrl &&
    job.teamType === teamType &&
    ["queued", "running"].includes(job.status)
  ) ?? null;
}

export function teamSourceKey(value) {
  const url = new URL(value);
  const parameters = [...url.searchParams.entries()]
    .sort(([nameA, valueA], [nameB, valueB]) =>
      nameA.localeCompare(nameB) || valueA.localeCompare(valueB)
    );
  url.search = "";
  for (const [name, parameterValue] of parameters) {
    url.searchParams.append(name, parameterValue);
  }
  return url.href;
}

export function findExistingHomeCollection(collections, teams, teamUrl) {
  const sourceKey = teamSourceKey(teamUrl);
  const datasetIds = new Set(teams
    .filter(team =>
      team.sourceUrl && teamSourceKey(team.sourceUrl) === sourceKey
    )
    .map(team => team.datasetId));
  if (!datasetIds.size) return null;
  return collections.find(collection =>
    collection.teamDatasetIds.some(datasetId => datasetIds.has(datasetId))
  ) ?? null;
}

function slugFolderSegment(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function collectionFolderName(teamUrl, mode, createdAt = new Date()) {
  const url = new URL(teamUrl);
  const season = slugFolderSegment(url.searchParams.get("year") ?? "unknown-season");
  const teamName = slugFolderSegment(url.searchParams.get("teamname") ?? "unknown-team");
  const timestamp = createdAt.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${season}-${teamName}-${mode}-${timestamp}`;
}

export function temporaryCollectionName(teamUrl, id) {
  const url = new URL(teamUrl);
  const season = url.searchParams.get("year");
  const teamName = url.searchParams.get("teamname") ?? "Tennis team";
  return `Temporary — ${[season, teamName].filter(Boolean).join(" ")} — ${id}`
    .slice(0, 80);
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readBody(request, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function publicJob(job) {
  return {
    id: job.id,
    kind: job.kind ?? "collection",
    teamId: job.teamId ?? null,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    detail: job.detail,
    mode: job.ratingSelections.utr,
    ratingSelections: job.ratingSelections,
    refreshSelections: job.refreshSelections ?? null,
    createdAt: job.createdAt,
    completedAt: job.completedAt ?? null,
    error: job.error ?? null,
    warning: job.warning ?? null,
    collectionName: job.collectionName,
    eventCollectionId: job.eventCollectionId ?? null,
    teamType: job.teamType ?? null,
    discoveredOpponentCount: job.discoveredOpponentCount ?? 0,
    collectedTeamCount: job.collectedTeamCount ?? 0,
    log: job.log.slice(-10)
  };
}

function blankUtrProfile() {
  return {
    lookupStatus: "not_started",
    profileCandidate: null,
    singles: emptyRating(),
    doubles: emptyRating(),
    exactDecimalsAvailable: false,
    exactDecimalsBlocker: "not_started",
    retrievedAt: null
  };
}

function playersByName(players) {
  return new Map((players ?? []).map(player => [normalizeName(player.name), player]));
}

export function mergePreservedRefreshData(fresh, current, refreshSelections) {
  const refreshUtr = refreshSelections.utr !== "none";
  const scope = refreshSelections.scope ?? "all";
  const currentRoster = playersByName(current.roster);
  const currentOpponents = playersByName(current.opponents);
  for (const player of fresh.roster ?? []) {
    const previous = currentRoster.get(normalizeName(player.name));
    if (!previous) continue;
    if (!refreshUtr && previous.utr) player.utr = previous.utr;
    if (previous.likelyRole != null) player.likelyRole = previous.likelyRole;
    if (previous.note != null) player.note = previous.note;
  }
  for (const player of fresh.opponents ?? []) {
    const previous = currentOpponents.get(normalizeName(player.name));
    if (!previous) continue;
    if (!ratingScopeIncludes(scope, "opponent") &&
        Object.hasOwn(previous, "dr")) {
      player.dr = previous.dr;
    }
    if ((!refreshUtr || !ratingScopeIncludes(scope, "opponent")) &&
        Object.hasOwn(previous, "utr")) {
      player.utr = previous.utr;
    }
    if ((!refreshSelections.wtn || !ratingScopeIncludes(scope, "opponent")) &&
        Object.hasOwn(previous, "wtn")) {
      player.wtn = previous.wtn;
    }
  }

  const selectedSource = source => {
    if (source.type === "tennisrecord") return false;
    if (source.type?.includes("utr_")) return !refreshUtr;
    if (source.type === "world_tennis_number_public_profiles") return false;
    return true;
  };
  fresh.sources = [
    ...(fresh.sources ?? []),
    ...(current.sources ?? []).filter(selectedSource)
  ];
  fresh.ratingSelections = {
    utr: refreshUtr
      ? refreshSelections.utr
      : current.ratingSelections?.utr || "none",
    wtn: false
  };
  const preserveUnselectedIssues = (items, selected) => {
    if (!items || (!selected && scope === "all")) return items;
    if (!selected) return items;
    return items.filter(item =>
      !ratingScopeIncludes(scope, item.kind ?? "roster")
    );
  };
  fresh.dataQuality = {
    ...(fresh.dataQuality ?? {}),
    ...(current.dataQuality?.unresolvedIdentities && (
      !refreshUtr || scope !== "all"
    )
      ? {
          unresolvedIdentities: preserveUnselectedIssues(
            current.dataQuality.unresolvedIdentities,
            refreshUtr
          )
        }
      : {}),
  };
  updateCourtJoins(fresh);
  return fresh;
}

function resetUtrData(dataset, scope) {
  const players = [
    ...(ratingScopeIncludes(scope, "roster") ? dataset.roster ?? [] : []),
    ...(ratingScopeIncludes(scope, "opponent") ? dataset.opponents ?? [] : [])
  ];
  for (const player of players) {
    player.utr = blankUtrProfile();
  }
  if (scope === "all") {
    dataset.sources = (dataset.sources ?? []).filter(source =>
      !source.type?.includes("utr_")
    );
  }
  if (dataset.dataQuality?.unresolvedIdentities) {
    dataset.dataQuality.unresolvedIdentities =
      dataset.dataQuality.unresolvedIdentities.filter(item =>
        !ratingScopeIncludes(scope, item.kind ?? "roster")
      );
  }
}

function runCommand(job, script, args, onLine) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(process.execPath, [join(ROOT, script), ...args], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let stdoutBuffer = "";

    const consume = chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        job.log.push(line);
        onLine?.(line);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      if (stdoutBuffer.trim()) {
        job.log.push(stdoutBuffer.trim());
        onLine?.(stdoutBuffer.trim());
      }
      if (code === 0) {
        resolveCommand();
      } else {
        reject(new Error(stderr.trim() || `${script} exited with code ${code}`));
      }
    });
  });
}

async function runJob(job, runUtrCommand) {
  try {
    job.status = "running";
    job.phase = "tennisrecord";
    job.progress = 8;
    job.detail = "Reading the team profile and completed scorecards";
    await mkdir(dirname(job.outputPath), { recursive: true });
    await runCommand(
      job,
      "scripts/collect-team.mjs",
      ["--team-url", job.teamUrl, "--output", job.outputPath],
      line => {
        if (line.startsWith("Collected")) job.progress = Math.min(46, job.progress + 11);
        job.detail = line;
      }
    );

    const dataset = await readJson(job.outputPath);
    dataset.ratingSelections = job.ratingSelections;
    await writeJsonAtomic(job.outputPath, dataset);

    if (job.ratingSelections.utr !== "none") {
      job.phase = "utr";
      job.progress = 52;
      job.detail = job.ratingSelections.utr === "authenticated"
        ? "Matching players to signed-in UTR profiles"
        : "Matching players to public UTR profiles";
      const utrScript = job.ratingSelections.utr === "authenticated"
        ? "scripts/enrich-utr.mjs"
        : "scripts/enrich-utr-public.mjs";
      const utrArgs = ["--input", job.outputPath];
      if (job.ratingSelections.utr === "authenticated") {
        utrArgs.push("--session", UTR_SESSION);
      }
      await runUtrCommand(job, () =>
        runCommand(job, utrScript, utrArgs, line => {
          job.progress = Math.min(92, job.progress + 1);
          job.detail = line;
        })
      );
    }

    const completedDataset = await readJson(job.outputPath);
    completedDataset.collectionStage = "step_1_complete";
    completedDataset.generatedAt = new Date().toISOString();
    await writeJsonAtomic(job.outputPath, completedDataset);

    job.phase = "validation";
    job.progress = 94;
    job.detail = "Checking identities, ratings, matches, and source provenance";
    const validationArgs = ["--input", job.outputPath];
    await runCommand(
      job,
      "scripts/validate-team-data.mjs",
      validationArgs,
      line => {
        job.detail = line;
      }
    );
    if (job.eventCollectionId) {
      try {
        await assignTeamToCollection(
          job.dataDirectory,
          job.eventCollectionId,
          completedDataset.datasetId
        );
      } catch (error) {
        job.warning =
          `Team data was gathered, but it could not be added to the event collection: ${error.message}`;
      }
    }

    job.status = "complete";
    job.phase = "complete";
    job.progress = 100;
    job.detail = "Collection complete — your data is ready to review";
    job.completedAt = new Date().toISOString();
  } catch (error) {
    job.status = "failed";
    job.phase = "failed";
    job.detail = "Collection stopped";
    job.error = error.message;
  }
}

export async function runScoutingJob(
  job,
  runUtrCommand,
  runSingleJob = runJob
) {
  await runSingleJob(job, runUtrCommand);
  if (job.status !== "complete") return;

  job.collectedTeamCount = 1;
  if (job.teamType !== "home") return;

  try {
    job.status = "running";
    job.phase = "tennisrecord";
    job.progress = 95;
    job.detail = "Discovering league opponents from the confirmed home team";
    const dataset = await readJson(job.outputPath);
    if (job.eventCollectionId && Array.isArray(dataset.leagueSchedule)) {
      try {
        await confirmEventSchedule(job.dataDirectory, {
          collectionId: job.eventCollectionId,
          ourTeamId: job.catalogTeamId,
          eventType: "local",
          eligibilityScope: "local",
          timezone: null,
          source: {
            type: "tennisrecord",
            reference: job.teamUrl,
            importedAt: new Date().toISOString()
          },
          matches: dataset.leagueSchedule
        });
      } catch (error) {
        job.warning = [
          job.warning,
          `The teams were gathered, but the local schedule could not be confirmed: ${error.message}`
        ].filter(Boolean).join(" ");
      }
    }
    const homeUrl = new URL(job.teamUrl).href;
    const leagueTeams = [...new Map(
      (dataset.leagueTeams ?? [])
        .filter(team => team?.url && new URL(team.url).href !== homeUrl)
        .map(team => [new URL(team.url).href, {
          name: team.name,
          url: new URL(team.url).href
        }])
    ).values()];
    job.discoveredOpponentCount = leagueTeams.length;

    const issues = job.warning ? [job.warning] : [];
    for (const [index, team] of leagueTeams.entries()) {
      job.status = "running";
      job.phase = "tennisrecord";
      job.progress = 95 + Math.floor((index / Math.max(leagueTeams.length, 1)) * 4);
      job.detail =
        `Gathering league opponent ${index + 1} of ${leagueTeams.length}: ${team.name}`;
      const createdAt = new Date();
      const collectionName = collectionFolderName(
        team.url,
        ratingSelectionSlug(job.ratingSelections),
        createdAt
      );
      const opponentJob = {
        id: `${job.id}-${index + 1}`,
        collectionName,
        eventCollectionId: job.eventCollectionId,
        dataDirectory: job.dataDirectory,
        teamUrl: team.url,
        teamType: "opponent",
        ratingSelections: job.ratingSelections,
        status: "queued",
        phase: "queued",
        progress: 2,
        detail: "Preparing opponent collection",
        createdAt: createdAt.toISOString(),
        outputPath: join(
          job.dataDirectory,
          "collections",
          collectionName,
          "team-data.json"
        ),
        log: []
      };
      await runSingleJob(opponentJob, runUtrCommand);
      if (opponentJob.status === "complete") {
        job.collectedTeamCount += 1;
        if (opponentJob.warning) {
          issues.push(`${team.name}: ${opponentJob.warning}`);
        }
      } else {
        issues.push(`${team.name}: ${opponentJob.error ?? "collection failed"}`);
      }
    }

    job.status = "complete";
    job.phase = "complete";
    job.progress = 100;
    job.detail = issues.length
      ? `Gathered ${job.collectedTeamCount} of ${leagueTeams.length + 1} league teams`
      : `Gathered the home team and ${leagueTeams.length} league opponents`;
    job.completedAt = new Date().toISOString();
    job.warning = issues.length
      ? `Some teams need attention: ${issues.join("; ")}`
      : null;
  } catch (error) {
    job.status = "failed";
    job.phase = "failed";
    job.detail = "League opponent collection stopped";
    job.error = error.message;
  }
}

async function runRefreshJob(job, runUtrCommand) {
  try {
    job.status = "running";
    const current = await readJson(job.outputPath);
    await writeJsonAtomic(job.workingPath, current);

    if (job.refreshSelections.tennisrecord) {
      job.phase = "tennisrecord";
      job.progress = 8;
      job.detail = "Refreshing the team profile, roster, ratings, and scorecards";
      await runCommand(
        job,
        "scripts/collect-team.mjs",
        [
          "--team-url",
          job.teamUrl,
          "--dataset-id",
          current.datasetId,
          "--output",
          job.workingPath
        ],
        line => {
          if (line.startsWith("Collected")) {
            job.progress = Math.min(45, job.progress + 10);
          }
          job.detail = line;
        }
      );
      const fresh = await readJson(job.workingPath);
      mergePreservedRefreshData(fresh, current, job.refreshSelections);
      await writeJsonAtomic(job.workingPath, fresh);
    }

    if (job.refreshSelections.utr !== "none") {
      const dataset = await readJson(job.workingPath);
      resetUtrData(dataset, job.refreshSelections.scope);
      dataset.ratingSelections = job.ratingSelections;
      await writeJsonAtomic(job.workingPath, dataset);
      job.phase = "utr";
      job.progress = job.refreshSelections.tennisrecord ? 50 : 15;
      job.detail = job.refreshSelections.utr === "authenticated"
        ? "Refreshing signed-in UTR profiles and exact ratings"
        : "Refreshing public UTR profiles and rating bands";
      const script = job.refreshSelections.utr === "authenticated"
        ? "scripts/enrich-utr.mjs"
        : "scripts/enrich-utr-public.mjs";
      const args = [
        "--input",
        job.workingPath,
        "--refresh",
        "--scope",
        job.refreshSelections.scope
      ];
      if (job.refreshSelections.utr === "authenticated") {
        args.push("--session", UTR_SESSION);
      }
      await runUtrCommand(job, () =>
        runCommand(job, script, args, line => {
          job.progress = Math.min(92, job.progress + 1);
          job.detail = line;
        })
      );
    }

    const completed = await readJson(job.workingPath);
    completed.ratingSelections = job.ratingSelections;
    completed.collectionStage = "step_1_complete";
    completed.generatedAt = new Date().toISOString();
    await writeJsonAtomic(job.workingPath, completed);

    job.phase = "validation";
    job.progress = 94;
    job.detail = "Validating the refreshed dataset before replacing current data";
    await runCommand(
      job,
      "scripts/validate-team-data.mjs",
      ["--input", job.workingPath],
      line => { job.detail = line; }
    );
    await writeJsonAtomic(job.outputPath, await readJson(job.workingPath));

    job.status = "complete";
    job.phase = "complete";
    job.progress = 100;
    job.detail = "Refresh complete — the selected sources are up to date";
    job.completedAt = new Date().toISOString();
  } catch (error) {
    job.status = "failed";
    job.phase = "failed";
    job.detail = "Refresh stopped; the previous dataset was kept";
    job.error = error.message;
  } finally {
    await rm(job.workingPath, { force: true });
  }
}

async function browserCommand(...args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn("agent-browser", ["--session", UTR_SESSION, ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolveCommand(stdout.trim());
      else reject(new Error(stderr.trim() || "Could not open UTR."));
    });
  });
}

async function getUtrStatus() {
  try {
    await browserCommand("open", "https://app.utrsports.net/");
    const output = await browserCommand(
      "eval",
      `JSON.stringify({signedIn:document.body.innerText.includes('Sign Out'),` +
      `rateLimited:document.body.innerText.includes('Too many requests')})`
    );
    const outer = JSON.parse(output);
    const status = typeof outer === "string" ? JSON.parse(outer) : outer;
    if (status.rateLimited) {
      return {
        signedIn: false,
        rateLimited: true,
        error: "UTR is temporarily rate limiting this session. Wait before checking again."
      };
    }
    return { signedIn: Boolean(status.signedIn), rateLimited: false };
  } catch (error) {
    return { signedIn: false, error: error.message };
  }
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (![
    "branding-color-proposals.html",
    "index.html",
    "app.js",
    "match-card.mjs",
    "navigation.mjs",
    "render.mjs",
    "schedule.mjs",
    "styles.css",
    "team-workspace.mjs"
  ].includes(relativePath)) {
    json(response, 404, { error: "Not found" });
    return;
  }
  const path = join(PUBLIC_DIR, relativePath);
  const content = await readFile(path);
  response.writeHead(200, {
    "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    "cache-control": "no-cache"
  });
  response.end(content);
}

export function createUtrCommandQueue() {
  let queueTail = Promise.resolve();
  let queuedJobs = 0;
  return async (job, command) => {
    const previous = queueTail;
    let release;
    queueTail = new Promise(resolveQueue => {
      release = resolveQueue;
    });
    queuedJobs += 1;
    if (queuedJobs > 1) {
      job.detail = "Waiting for the earlier UTR collection to finish";
    }
    await previous;
    try {
      job.detail = job.ratingSelections.utr === "authenticated"
        ? "Matching players to signed-in UTR profiles"
        : "Matching players to public UTR profiles";
      await command();
    } finally {
      queuedJobs -= 1;
      release();
    }
  };
}

export function parseRatingSelections(body) {
  const utr = body.utrMode ?? body.mode ?? "none";
  if (!["none", "public", "authenticated"].includes(utr)) {
    throw new Error("Choose no UTR, public UTR, or signed-in UTR.");
  }
  return { utr, wtn: false };
}

export function ratingSelectionSlug(ratingSelections) {
  const selected = [];
  if (ratingSelections.utr !== "none") selected.push(`${ratingSelections.utr}-utr`);
  return selected.length ? selected.join("-") : "no-ratings";
}

export function parseRefreshSelections(body) {
  if (typeof body.refreshTennisRecord !== "boolean") {
    throw new Error("TennisRecord refresh selection must be true or false.");
  }
  const utr = body.refreshUtr ? body.utrMode : "none";
  if (typeof body.refreshUtr !== "boolean" ||
      !["none", "public", "authenticated"].includes(utr)) {
    throw new Error("Choose whether to refresh public or signed-in UTR.");
  }
  if (!body.refreshTennisRecord && utr === "none") {
    throw new Error("Choose at least one source to refresh.");
  }
  const scope = normalizeRatingScope(body.ratingScope ?? "all");
  return {
    tennisrecord: body.refreshTennisRecord,
    utr
  };
}

function datasetRatingSelections(dataset) {
  if (dataset.ratingSelections?.utr) {
    return { utr: dataset.ratingSelections.utr, wtn: false };
  }
  const exact = dataset.sources?.some(source =>
    source.type?.includes("utr") && source.authentication === "user-authenticated"
  );
  const publicUtr = dataset.sources?.some(source =>
    source.type?.includes("utr") && source.authentication === "not_authenticated"
  );
  return {
    utr: exact ? "authenticated" : publicUtr ? "public" : "none",
    wtn: false
  };
}

async function getTeamAnalysis(
  dataDirectory,
  teamId,
  eligibilityScope,
  refresh = false
) {
  if (!Object.hasOwn(ELIGIBILITY_SCOPES, eligibilityScope)) {
    throw new Error(
      `Eligibility must be one of: ${Object.keys(ELIGIBILITY_SCOPES).join(", ")}.`
    );
  }
  const dataset = await readCatalogTeam(dataDirectory, teamId);
  const outputPath = join(
    dataDirectory,
    teamId,
    "analysis",
    `${eligibilityScope}.json`
  );
  if (!refresh) {
    try {
      const saved = await readJson(outputPath);
      if (
        saved.analysisVersion === ANALYSIS_VERSION &&
        saved.dataset?.datasetId === dataset.datasetId &&
        saved.dataset?.generatedAt === dataset.generatedAt &&
        saved.eligibility?.scope === eligibilityScope
      ) {
        return saved;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const analysis = analyzeTeam(dataset, { eligibilityScope });
  await writeJsonAtomic(outputPath, analysis);
  return analysis;
}

export function createAppServer(options = {}) {
  const dataDirectory = options.dataDirectory ?? DATA_DIR;
  const previewTeam = options.previewTeam ?? previewTennisRecordTeam;
  const recognizeImage = options.recognizeImage ?? (async image => {
    const cachePath = join(dataDirectory, ".ocr-cache");
    await mkdir(cachePath, { recursive: true });
    return Tesseract.recognize(image, "eng", { cachePath });
  });
  const runUtrCommand = createUtrCommandQueue();
  const runCollectionJob = options.runCollectionJob ?? runJob;
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const pathname = requestUrl.pathname;

    try {
      if (request.method === "POST" && pathname === "/api/result-ocr") {
        const body = await readBody(request, 8 * 1024 * 1024);
        const match = typeof body.imageDataUrl === "string"
          ? body.imageDataUrl.match(
            /^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/
          )
          : null;
        if (!match) {
          throw new Error("Upload a PNG, JPEG, or WebP result screenshot.");
        }
        const result = await recognizeImage(Buffer.from(match[1], "base64"));
        json(response, 200, {
          text: result.data?.text ?? "",
          confidence: Number.isFinite(result.data?.confidence)
            ? Math.round(result.data.confidence)
            : null
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/team-preview") {
        const body = await readBody(request);
        const teamUrl = validateTeamUrl(body.teamUrl);
        const teamType = parseTeamType(body.teamType);
        const preview = await previewTeam(teamUrl);
        json(response, 200, {
          teamUrl,
          teamType,
          team: preview.team,
          rosterSize: preview.rosterSize,
          leagueTeams: teamType === "home" ? preview.leagueTeams ?? [] : [],
          leagueSchedule: teamType === "home"
            ? preview.leagueSchedule ?? []
            : []
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/jobs") {
        const body = await readBody(request);
        const teamUrl = validateTeamUrl(body.teamUrl);
        const teamType = parseTeamType(body.teamType);
        const ratingSelections = parseRatingSelections(body);
        const activeJob = findActiveScoutingJob(
          jobs.values(),
          teamUrl,
          teamType
        );
        if (activeJob) {
          json(response, 202, publicJob(activeJob));
          return;
        }
        const id = randomUUID().slice(0, 8);
        let eventCollectionId = body.eventCollectionId ?? null;
        if (eventCollectionId != null) {
          await getTeamCollection(dataDirectory, eventCollectionId);
        }
        if (ratingSelections.utr === "authenticated") {
          const status = await getUtrStatus();
          if (!status.signedIn) {
            json(response, 409, {
              error: status.rateLimited
                ? status.error
                : "Sign in to UTR before starting exact-rating collection."
            });
            return;
          }
        }
        if (eventCollectionId == null && teamType === "home") {
          const existingCollection = findExistingHomeCollection(
            await listTeamCollections(dataDirectory),
            await listTeamCatalog(dataDirectory),
            teamUrl
          );
          eventCollectionId = existingCollection?.id ?? null;
        }
        if (eventCollectionId == null) {
          const collection = await createTeamCollection(
            dataDirectory,
            temporaryCollectionName(teamUrl, id)
          );
          eventCollectionId = collection.id;
        }
        const createdAt = new Date();
        const collectionName = collectionFolderName(
          teamUrl,
          ratingSelectionSlug(ratingSelections),
          createdAt
        );
        const job = {
          id,
          kind: teamType === "home" ? "league-collection" : "collection",
          collectionName,
          catalogTeamId: `collections/${collectionName}`,
          eventCollectionId,
          dataDirectory,
          teamUrl,
          teamType,
          ratingSelections,
          status: "queued",
          phase: "queued",
          progress: 2,
          detail: "Preparing collection",
          createdAt: createdAt.toISOString(),
          outputPath: join(
            dataDirectory,
            "collections",
            collectionName,
            "team-data.json"
          ),
          log: []
        };
        jobs.set(id, job);
        void runScoutingJob(job, runUtrCommand, runCollectionJob);
        json(response, 202, publicJob(job));
        return;
      }

      if (request.method === "POST" && pathname === "/api/refresh-jobs") {
        const body = await readBody(request);
        if (typeof body.teamId !== "string" || !body.teamId) {
          throw new Error("Choose a gathered team to refresh.");
        }
        const current = await readCatalogTeam(dataDirectory, body.teamId);
        const refreshSelections = parseRefreshSelections(body);
        if (refreshSelections.utr === "authenticated") {
          const status = await getUtrStatus();
          if (!status.signedIn) {
            json(response, 409, {
              error: "Sign in to UTR before refreshing exact ratings."
            });
            return;
          }
        }
        const activeRefresh = [...jobs.values()].find(job =>
          job.teamId === body.teamId &&
          ["queued", "running"].includes(job.status)
        );
        if (activeRefresh) {
          json(response, 409, {
            error: "This team already has a refresh in progress."
          });
          return;
        }
        const tennisRecordSource = current.sources?.find(source =>
          source.type === "tennisrecord" && source.url
        );
        if (refreshSelections.tennisrecord && !tennisRecordSource) {
          throw new Error(
            "This dataset does not include its TennisRecord team URL, so TennisRecord cannot be refreshed."
          );
        }
        const currentSelections = datasetRatingSelections(current);
        const ratingSelections = {
          utr: refreshSelections.utr !== "none"
            ? refreshSelections.utr
            : currentSelections.utr,
          wtn: false
        };
        const id = randomUUID().slice(0, 8);
        const outputPath = join(dataDirectory, body.teamId, "team-data.json");
        const job = {
          id,
          kind: "refresh",
          teamId: body.teamId,
          teamUrl: tennisRecordSource?.url ?? null,
          ratingSelections,
          refreshSelections,
          status: "queued",
          phase: "queued",
          progress: 2,
          detail: "Preparing selective refresh",
          createdAt: new Date().toISOString(),
          outputPath,
          workingPath: join(
            dirname(outputPath),
            `.team-data.refresh-${id}.json`
          ),
          log: []
        };
        jobs.set(id, job);
        void runRefreshJob(job, runUtrCommand);
        json(response, 202, publicJob(job));
        return;
      }

      if (request.method === "GET" && pathname === "/api/utr/status") {
        json(response, 200, await getUtrStatus());
        return;
      }

      if (request.method === "GET" && pathname === "/api/teams") {
        json(response, 200, {
          teams: await listTeamCatalog(dataDirectory),
          defaultEligibilityScope: "national",
          eligibilityScopes: ELIGIBILITY_SCOPES
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/team-collections") {
        json(response, 200, {
          collections: await listTeamCollections(dataDirectory)
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/match-cards") {
        json(response, 200, {
          cards: await readMatchCards(dataDirectory)
        });
        return;
      }
      if (request.method === "PUT" && pathname === "/api/match-cards") {
        const body = await readBody(request, 1024 * 1024);
        json(response, 200, {
          cards: await writeMatchCards(dataDirectory, body.cards)
        });
        return;
      }

      const eventScheduleMatch = pathname.match(
        /^\/api\/event-schedules\/([a-zA-Z0-9-]+)$/
      );
      if (request.method === "GET" && eventScheduleMatch) {
        const schedule = await getEventSchedule(
          dataDirectory,
          eventScheduleMatch[1]
        );
        json(response, 200, { schedule });
        return;
      }
      if (request.method === "PUT" && eventScheduleMatch) {
        await getTeamCollection(dataDirectory, eventScheduleMatch[1]);
        const body = await readBody(request, 256 * 1024);
        const teams = await listTeamCatalog(dataDirectory);
        if (!teams.some(team => team.id === body.ourTeamId)) {
          const error = new Error("Assigned Our team dataset not found.");
          error.statusCode = 404;
          throw error;
        }
        json(response, 200, await confirmEventSchedule(dataDirectory, {
          ...body,
          collectionId: eventScheduleMatch[1]
        }));
        return;
      }

      const eventSchedulePreviewMatch = pathname.match(
        /^\/api\/event-schedules\/([a-zA-Z0-9-]+)\/preview$/
      );
      if (request.method === "POST" && eventSchedulePreviewMatch) {
        const collectionId = eventSchedulePreviewMatch[1];
        await getTeamCollection(dataDirectory, collectionId);
        const body = await readBody(request, 256 * 1024);
        const current = await getEventSchedule(dataDirectory, collectionId);
        const matches = (body.matches ?? []).map(match =>
          normalizeScheduledMatch(match, collectionId)
        );
        json(response, 200, {
          matches,
          reconciliation: reconcileEventSchedule(
            current?.matches ?? [],
            matches
          )
        });
        return;
      }

      const localSchedulePreviewMatch = pathname.match(
        /^\/api\/event-schedules\/([a-zA-Z0-9-]+)\/local-preview$/
      );
      if (request.method === "POST" && localSchedulePreviewMatch) {
        const collectionId = localSchedulePreviewMatch[1];
        const body = await readBody(request);
        const dataset = await readCatalogTeam(dataDirectory, body.ourTeamId);
        const source = dataset.sources?.find(item =>
          item.type === "tennisrecord" && item.url
        );
        if (!source) {
          throw new Error(
            "Our team dataset does not include a TennisRecord source URL."
          );
        }
        const preview = await previewTeam(source.url);
        const current = await getEventSchedule(dataDirectory, collectionId);
        const matches = preview.leagueSchedule.map(match =>
          normalizeScheduledMatch(match, collectionId)
        );
        json(response, 200, {
          eventType: current?.eventType ?? "local",
          eligibilityScope: current?.eligibilityScope ?? "local",
          timezone: current?.timezone ?? null,
          source: {
            type: "tennisrecord",
            reference: source.url,
            importedAt: new Date().toISOString()
          },
          matches,
          reconciliation: reconcileEventSchedule(
            current?.matches ?? dataset.leagueSchedule ?? [],
            matches
          )
        });
        return;
      }

      const eventScheduleLinkMatch = pathname.match(
        /^\/api\/event-schedules\/([a-zA-Z0-9-]+)\/link$/
      );
      if (request.method === "PUT" && eventScheduleLinkMatch) {
        const body = await readBody(request);
        if (
          body.teamId != null &&
          !(await listTeamCatalog(dataDirectory)).some(
            team => team.id === body.teamId
          )
        ) {
          const error = new Error("Gathered opponent team not found.");
          error.statusCode = 404;
          throw error;
        }
        json(response, 200, {
          schedule: await linkScheduledOpponent(
            dataDirectory,
            eventScheduleLinkMatch[1],
            body.matchId,
            body.teamId ?? null
          )
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/team-collections") {
        const body = await readBody(request);
        if (body.datasetId != null) {
          const teams = await listTeamCatalog(dataDirectory);
          if (!teams.some(team => team.datasetId === body.datasetId)) {
            const error = new Error("Gathered team not found.");
            error.statusCode = 404;
            throw error;
          }
        }
        const collection = await createTeamCollection(
          dataDirectory,
          body.name,
          new Date(),
          body.datasetId ?? null,
          body.competitionLevel
        );
        json(response, 201, {
          collection,
          collections: await listTeamCollections(dataDirectory)
        });
        return;
      }

      const collectionMatch = pathname.match(
        /^\/api\/team-collections\/([a-zA-Z0-9-]+)$/
      );
      if (request.method === "DELETE" && collectionMatch) {
        const result = await deleteTeamCollection(
          dataDirectory,
          collectionMatch[1]
        );
        await deleteEventSchedule(dataDirectory, collectionMatch[1]);
        json(response, 200, result);
        return;
      }
      if (request.method === "PATCH" && collectionMatch) {
        const body = await readBody(request);
        json(
          response,
          200,
          await renameTeamCollection(
            dataDirectory,
            collectionMatch[1],
            body.name
          )
        );
        return;
      }

      const collectionTeamMatch = pathname.match(
        /^\/api\/team-collections\/([a-zA-Z0-9-]+)\/team$/
      );
      if (request.method === "PUT" && collectionTeamMatch) {
        const body = await readBody(request);
        const teams = await listTeamCatalog(dataDirectory);
        if (!teams.some(team => team.datasetId === body.datasetId)) {
          const error = new Error("Gathered team not found.");
          error.statusCode = 404;
          throw error;
        }
        json(response, 200, {
          collections: await assignTeamToCollection(
            dataDirectory,
            body.collectionId === null ? null : collectionTeamMatch[1],
            body.datasetId
          )
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/analysis") {
        const teamId = requestUrl.searchParams.get("team");
        if (!teamId) throw new Error("Choose a team dataset.");
        const eligibilityScope =
          requestUrl.searchParams.get("eligibility") ?? "national";
        json(
          response,
          200,
          await getTeamAnalysis(
            dataDirectory,
            teamId,
            eligibilityScope,
            requestUrl.searchParams.get("refresh") === "true"
          )
        );
        return;
      }

      if (request.method === "GET" && pathname === "/api/team-data") {
        const teamId = requestUrl.searchParams.get("team");
        if (!teamId) throw new Error("Choose a team dataset.");
        json(response, 200, await readCatalogTeam(dataDirectory, teamId));
        return;
      }

      if (request.method === "POST" && pathname === "/api/utr/connect") {
        await browserCommand("--headed", "open", "https://app.utrsports.net/login");
        json(response, 200, {
          opened: true,
          message: "UTR opened in a separate browser window."
        });
        return;
      }

      const jobMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
      if (request.method === "GET" && jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) return json(response, 404, { error: "Collection job not found." });
        json(response, 200, publicJob(job));
        return;
      }

      const dataMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/data$/);
      if (request.method === "GET" && dataMatch) {
        const job = jobs.get(dataMatch[1]);
        if (!job) return json(response, 404, { error: "Collection job not found." });
        if (job.status !== "complete") {
          return json(response, 409, { error: "Collection is not complete yet." });
        }
        json(response, 200, JSON.parse(await readFile(job.outputPath, "utf8")));
        return;
      }

      if (request.method === "GET") {
        await serveStatic(request, response, pathname);
        return;
      }
      json(response, 405, { error: "Method not allowed" });
    } catch (error) {
      json(response, error.statusCode ?? 400, { error: error.message });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createAppServer().listen(PORT, () => {
    console.log(`Tennis Court Scout is running at http://localhost:${PORT}`);
  });
}
