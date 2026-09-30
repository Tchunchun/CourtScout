#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs, requireArg, slugify } from "./lib/cli.mjs";
import { writeJsonAtomic } from "./lib/io.mjs";
import { collectTennisRecordTeam } from "./lib/tennisrecord.mjs";
import { emptyWtn } from "./lib/wtn.mjs";

const usage = `Usage:
  npm run collect -- --team-url <tennisrecord-url> [--dataset-id <id>] [--output <path>] [--delay-ms 250]`;

try {
  const args = parseArgs(process.argv.slice(2));
  const teamUrl = requireArg(args, "team-url", usage);
  const collected = await collectTennisRecordTeam(teamUrl, {
    delayMs: Number(args["delay-ms"] ?? 250)
  });
  const datasetId = args["dataset-id"] ??
    `${collected.team.season}-${slugify(collected.team.name)}`;
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(datasetId)) {
    throw new Error("Dataset ID must contain only lowercase letters, numbers, dots, and hyphens.");
  }
  const outputPath = resolve(
    args.output ?? `data/${datasetId}/team-data.json`
  );
  const opponentNames = [
    ...new Set(collected.matches.flatMap(match =>
      Object.values(match.courts).flatMap(court => court.opponentPlayers)
    ))
  ].sort();
  const opponentDirectory = new Map(
    collected.opponentDirectory.map(player => [player.name, player])
  );
  const rosterByName = new Map(collected.roster.map(player => [player.name, player]));
  const opponentsByName = new Map();
  const playerStats = new Map(collected.roster.map(player => [player.name, {
    singles: { wins: 0, losses: 0 },
    doubles: { wins: 0, losses: 0 },
    actual: 0,
    defaultsReceived: 0,
    sectionalsAppearances: 0
  }]));
  for (const match of collected.matches) {
    for (const [courtName, court] of Object.entries(match.courts)) {
      court.targetRatings = court.targetPlayers.map(name => {
        const player = rosterByName.get(name);
        return {
          name,
          dr: player?.dr ?? null,
          utr: player?.utr ?? null,
          wtn: player?.wtn ?? null,
          historicalDr: court.targetRatings.find(item => item.name === name)?.historicalDr
        };
      });
      court.opponentRatings = court.opponentPlayers.map(name => {
        const existing = court.opponentRatings.find(item => item.name === name);
        const directoryPlayer = opponentDirectory.get(name);
        return {
          ...existing,
          currentDr: directoryPlayer?.dr ?? null,
          locations: directoryPlayer?.locations ?? [],
          teams: directoryPlayer?.teams ?? []
        };
      });
      for (const name of court.targetPlayers) {
        const stats = playerStats.get(name);
        if (!stats) continue;
        const record = courtName.startsWith("D") ? stats.doubles : stats.singles;
        record[court.result === "W" ? "wins" : "losses"] += 1;
        if (court.adjudication === "default_received") {
          stats.defaultsReceived += 1;
        } else {
          stats.actual += 1;
        }
        if (match.phase.startsWith("sectionals")) stats.sectionalsAppearances += 1;
      }
      for (const name of court.opponentPlayers) {
        const directoryPlayer = opponentDirectory.get(name);
        const opponent = opponentsByName.get(name) ?? {
          name,
          locations: directoryPlayer?.locations ?? [],
          teams: directoryPlayer?.teams ?? [],
          dr: directoryPlayer?.dr ?? null,
          ntrp: directoryPlayer?.ntrp ?? null,
          utr: {
            lookupStatus: "not_started",
            profileCandidate: null,
            singles: {
              value: null, exactValue: null, display: "NR",
              status: "unresolved", reliability: null
            },
            doubles: {
              value: null, exactValue: null, display: "NR",
              status: "unresolved", reliability: null
            },
            exactDecimalsAvailable: false,
            exactDecimalsBlocker: "UTR enrichment not run",
            retrievedAt: null
          },
          wtn: emptyWtn(),
          appearances: []
        };
        opponent.appearances.push({
          matchId: match.id,
          date: match.date,
          phase: match.phase,
          court: courtName,
          resultAgainstTarget: court.result === "W" ? "L" : "W",
          historicalDr: court.opponentRatings.find(item => item.name === name)
            ?.historicalDr ?? null
        });
        opponentsByName.set(name, opponent);
      }
    }
  }
  for (const player of collected.roster) {
    const stats = playerStats.get(player.name);
    player.records = {
      singles: stats.singles,
      doubles: stats.doubles
    };
    player.qualifyingAppearances = {
      actual: stats.actual,
      defaultsReceived: stats.defaultsReceived
    };
    player.sectionalsAppearances = stats.sectionalsAppearances;
    const type = player.ntrp.type;
    const eligible = type === "S" || type === "A"
      ? stats.actual >= 4
      : stats.actual + Math.min(stats.defaultsReceived, 1) >= 3;
    player.nationalsEligibility = type === "D"
      ? { status: "unavailable_dq", display: "DQ" }
      : eligible
      ? { status: "confirmed_eligible", display: "Eligible" }
      : { status: "not_confirmed", display: "Not confirmed" };
  }
  const reportedTotals = collected.matches.reduce((totals, match) => {
    totals.teamWins += match.teamResult.result === "W" ? 1 : 0;
    totals.teamLosses += match.teamResult.result === "L" ? 1 : 0;
    totals.courtWins += match.teamResult.wins;
    totals.courtLosses += match.teamResult.losses;
    return totals;
  }, { teamWins: 0, teamLosses: 0, courtWins: 0, courtLosses: 0 });
  collected.team.reportedTotals = reportedTotals;
  const dataset = {
    schemaVersion: "2.0.0",
    datasetId,
    generatedAt: new Date().toISOString(),
    collectionStage: "tennisrecord_complete",
    team: collected.team,
    eligibilityRule: {
      regulation: "USTA League Regulation 2.03A(4)",
      nonSelfRated: { matchesRequired: 3, defaultReceivedMayCount: 1 },
      selfRatedOrAppealed: { actualMatchesRequired: 4, defaultsCount: false },
      evaluatedThrough: "Sectional Championships"
    },
    sources: [{
      type: "tennisrecord",
      url: teamUrl,
      retrievedAt: new Date().toISOString().slice(0, 10),
      authentication: "none",
      fields: [
        "team identity",
        "roster",
        "player location",
        "NTRP",
        "DR",
        "match schedule",
        "lineups",
        "scores",
        "historical match DR"
      ]
    }],
    roster: collected.roster,
    opponents: opponentNames.map(name => opponentsByName.get(name)),
    matches: collected.matches,
    dataQuality: {
      sourcePrecedence: [
        "USTA TennisLink official result",
        "TennisRecord match detail",
        "TennisRecord team aggregate",
        "derived totals"
      ],
      issues: [],
      unresolvedIdentities: [],
      coverage: {
        tennisRecordMatchesCollected: collected.matches.length,
        officialUstaReconciled: false,
        warning: "TennisRecord may omit Sectionals or later adjudications. Final reports must disclose unreconciled official coverage."
      }
    },
    downstreamContract: {
      authoritativeInput: true,
      analysisMayDerive: [
        "eligibility summary",
        "singles analysis",
        "doubles pair analysis",
        "court stacking",
        "postseason-weighted lineup projection",
        "strategy",
        "HTML report"
      ],
      analysisMustNotOverride: [
        "source identity matches",
        "exact ratings",
        "official match results",
        "adjudications",
        "source precedence",
        "unresolved-profile status"
      ],
      opponentRatingPolicy: [
        "Use authenticated exact UTR values when available.",
        "Treat NR/unresolved values as missing.",
        "Never infer a decimal from a public rating band."
      ]
    }
  };
  await writeJsonAtomic(outputPath, dataset);
  console.log(`Collected ${dataset.roster.length} roster players`);
  console.log(`Collected ${dataset.matches.length} completed matches`);
  console.log(`Discovered ${dataset.opponents.length} unique opponents`);
  console.log(`Saved ${outputPath}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
