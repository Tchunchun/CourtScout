import * as cheerio from "cheerio";
import { fetchText, sleep } from "./io.mjs";
import { emptyRating } from "./ratings.mjs";
import { emptyWtn } from "./wtn.mjs";

const BASE_URL = "https://www.tennisrecord.com";

const clean = value => value.replace(/\s+/g, " ").trim();
const absoluteUrl = href => new URL(href, BASE_URL).href;

function teamLeagueFormat(leagueDescriptor, leagueName) {
  return /\bmixed\b|\bX\s*\d(?:\.\d)?\b/i.test(
    `${leagueDescriptor} ${leagueName}`
  )
    ? "mixed"
    : "single_gender";
}

function parseRecord(value) {
  const match = clean(value).match(/^(\d+)-(\d+)$/);
  return match ? { wins: Number(match[1]), losses: Number(match[2]) } : null;
}

function scheduleDate(value) {
  const match = value.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function scheduleTime(value) {
  return value.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i)?.[0]
    ?.replace(/\s+/g, " ")
    .toUpperCase() ?? null;
}

function scheduleMatchId({
  sourceMatchId,
  season,
  date,
  time,
  opponentUrl,
  opponentName
}) {
  if (sourceMatchId) return `tennisrecord:${sourceMatchId}`;
  const opponent = opponentUrl
    ? new URL(opponentUrl).searchParams.get("teamname")
    : opponentName;
  return [
    "tennisrecord",
    season ?? "unknown-season",
    date ?? "unknown-date",
    time ?? "unknown-time",
    clean(opponent ?? "unknown-opponent").toLowerCase()
  ].join(":");
}

export function parseTeamProfile(html, sourceUrl) {
  const $ = cheerio.load(html);
  const profileTables = $("table");
  const teamHeading = profileTables
    .filter((_, table) => clean($(table).text()).startsWith("Team Profile"))
    .first();
  const detailsTable = teamHeading.parent().find("table").eq(1);
  const details = detailsTable
    .find("tr")
    .map((_, row) => clean($(row).text()))
    .get();
  const teamName = details.at(-1);
  const leagueDescriptor = details[0] ?? "";
  const leagueName = details[1] ?? "";
  const leagueFormat = teamLeagueFormat(leagueDescriptor, leagueName);
  const year = Number(new URL(sourceUrl).searchParams.get("year")) ||
    Number(leagueName.match(/\b20\d{2}\b/)?.[0]);

  const rosterHeader = $("tr")
    .filter((_, row) => {
      const text = clean($(row).text());
      return text.includes("Name") && text.includes("NTRP") && text.includes("Rating");
    })
    .first();
  const roster = [];
  rosterHeader.nextAll("tr").each((_, row) => {
    const cells = $(row).find("td");
    const profileLink = cells.eq(0).find('a[href*="profile.aspx"]').first();
    if (!profileLink.length) return;
    const ratingText = clean(cells.eq(cells.length - 2).text());
    roster.push({
      name: clean(profileLink.text()),
      location: clean(cells.eq(1).text()) || null,
      profileUrl: absoluteUrl(profileLink.attr("href")),
      ntrp: {
        level: clean(cells.eq(2).text()),
        type: "unknown"
      },
      dr: /^\d+(\.\d+)?$/.test(ratingText) ? Number(ratingText) : null,
      utr: {
        singles: emptyRating(),
        doubles: emptyRating()
      },
      wtn: emptyWtn(),
      records: {
        singles: parseRecord(cells.eq(4).text()),
        doubles: parseRecord(cells.eq(5).text())
      },
      qualifyingAppearances: {
        actual: 0,
        defaultsReceived: 0
      },
      sectionalsAppearances: 0,
      nationalsEligibility: {
        status: "unknown",
        display: "Pending collection"
      }
    });
  });

  const leagueSchedule = [];
  const matchLinks = [];
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    const scheduleCellText = clean(cells.eq(0).text());
    const sourceDate = scheduleCellText.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0];
    const opponentLink = $(row).find('a[href*="teamprofile.aspx"]').first();
    const resultLink = $(row).find('a[href*="matchresults.aspx"]').first();
    const result = clean(resultLink.text());
    if (sourceDate && opponentLink.length) {
      const opponentUrl = absoluteUrl(opponentLink.attr("href"));
      const sourceMatchId = resultLink.length
        ? new URL(absoluteUrl(resultLink.attr("href"))).searchParams.get("mid")
        : null;
      const cellParts = cells.eq(0).find("span")
        .map((__, element) => clean($(element).text()))
        .get()
        .filter(Boolean);
      const date = scheduleDate(sourceDate);
      const time = scheduleTime(cellParts[0] ?? scheduleCellText);
      const opponentName = clean(opponentLink.text());
      leagueSchedule.push({
        id: scheduleMatchId({
          sourceMatchId,
          season: year,
          date,
          time,
          opponentUrl,
          opponentName
        }),
        sourceOpponentName: opponentName,
        sourceOpponentUrl: opponentUrl,
        linkedOpponentTeamId: null,
        date,
        time,
        timezone: null,
        round: null,
        site: cellParts[1] && !/^TBA$/i.test(cellParts[1])
          ? cellParts[1]
          : null,
        designation: "unknown",
        status: result && result !== "0-0" ? "completed" : "scheduled",
        sourceType: "tennisrecord",
        sourceReference: resultLink.length
          ? absoluteUrl(resultLink.attr("href"))
          : sourceUrl,
        sourceMatchId,
        sourceResult: result || null
      });
    }
    if (!resultLink.length) return;
    if (!sourceDate || result === "0-0") return;
    matchLinks.push({
      date: sourceDate,
      opponent: clean(opponentLink.text()),
      opponentTeamUrl: opponentLink.length
        ? absoluteUrl(opponentLink.attr("href"))
        : null,
      result,
      url: absoluteUrl(resultLink.attr("href"))
    });
  });

  return {
    team: {
      name: teamName,
      section: leagueDescriptor,
      district: null,
      league: leagueName,
      level: leagueDescriptor.match(/\b\d\.\d\b/)?.[0] ?? "unknown",
      leagueFormat,
      gender: leagueFormat === "mixed"
        ? "Mixed"
        : /\bF\b|Women|Female/i.test(`${leagueDescriptor} ${leagueName}`)
        ? "Women"
        : /\bM\b|Men|Male/i.test(`${leagueDescriptor} ${leagueName}`)
          ? "Men"
          : "Unknown",
      season: year,
      nationalsRepresentative: false
    },
    roster,
    leagueSchedule: [...new Map(
      leagueSchedule.map(match => [match.id, match])
    ).values()],
    leagueTeams: [...new Map(
      leagueSchedule.map(match => [match.sourceOpponentUrl, {
        name: match.sourceOpponentName,
        url: match.sourceOpponentUrl
      }])
    ).values()],
    matchLinks: [...new Map(matchLinks.map(match => [match.url, match])).values()]
  };
}

function parseCourtLabel(value) {
  const text = clean(value);
  const singles = text.match(/Singles\s*#(\d+)/i);
  if (singles) return `S${singles[1]}`;
  const doubles = text.match(/Doubles\s*#(\d+)/i);
  if (doubles) return `D${doubles[1]}`;
  return text.replace(/\s+/g, "_");
}

function parsePlayerCell($, cell) {
  return $(cell)
    .find('a[href*="profile.aspx"]')
    .map((_, link) => ({
      name: clean($(link).text()),
      profileUrl: absoluteUrl($(link).attr("href")),
      historicalDr: (() => {
        const trailingText = clean($(link).parent().text());
        const value = trailingText.match(/\((\d+\.\d+)\)/)?.[1];
        return value ? Number(value) : null;
      })()
    }))
    .get();
}

function matchPhase(matchType) {
  if (/national/i.test(matchType)) return "nationals";
  if (/sectional/i.test(matchType)) return "sectionals";
  if (/district/i.test(matchType)) return "district";
  if (/(postseason|playoff|championship)/i.test(matchType)) return "playoff";
  return "local";
}

export function parseMatch(html, targetTeamName, source) {
  const $ = cheerio.load(html);
  const summaryTable = $("table")
    .filter((_, table) => {
      const text = clean($(table).text());
      return text.includes("Team Name") &&
        (text.includes("Courts Won") || text.includes("Points Won"));
    })
    .first();
  const summaryMetric = clean(summaryTable.find("tr").first().find("th").eq(1).text());
  const teamRows = summaryTable.find("tr").slice(1);
  const teams = teamRows
    .map((_, row) => {
      const cells = $(row).find("td");
      return {
        name: clean(cells.eq(0).text()),
        summaryValue: Number(clean(cells.eq(1).text()))
      };
    })
    .get();
  const targetIndex = teams.findIndex(team => clean(team.name) === clean(targetTeamName));
  if (targetIndex < 0) {
    throw new Error(`Target team "${targetTeamName}" not found in ${source.url}`);
  }
  const targetIsHome = targetIndex === 0;
  const opponent = teams[targetIsHome ? 1 : 0];
  const dateText = $("td")
    .filter((_, cell) => clean($(cell).text()) === "Scheduled Date:")
    .first()
    .next()
    .text();
  const dateParts = clean(dateText).split("/");
  const date = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`;
  const matchType = clean(
    $("td")
      .filter((_, cell) => clean($(cell).text()) === "Match Type:")
      .first()
      .next()
      .text()
  );
  const phase = matchPhase(matchType);
  const courts = {};

  $(".wrapper496").each((_, wrapper) => {
    const labelText = clean($(wrapper).text());
    if (!/(Singles|Doubles)\s*#\d+/i.test(labelText)) return;
    const table = $(wrapper).nextAll(".container496").first().find("table").first();
    const resultRow = table.find("tr").eq(1);
    if (!resultRow.length) return;
    const cells = resultRow.find("td");
    const homePlayers = parsePlayerCell($, cells.eq(0));
    const visitorPlayers = parsePlayerCell($, cells.eq(cells.length - 1));
    const winnerImage = resultRow.find('img[alt="Winner"]');
    const winnerCellIndex = winnerImage.closest("td").index();
    const homeWon = winnerCellIndex >= 0 && winnerCellIndex < Math.floor(cells.length / 2);
    const targetWon = targetIsHome ? homeWon : !homeWon;
    const targetPlayers = targetIsHome ? homePlayers : visitorPlayers;
    const opponentPlayers = targetIsHome ? visitorPlayers : homePlayers;
    const scoreCell = cells
      .filter((_, cell) => /(\d+\s*-\s*\d+|Default|Retired|Walkover)/i.test(clean($(cell).text())))
      .first();
    const scoreClone = scoreCell.clone();
    scoreClone.find("br").replaceWith(" ");
    const score = clean(scoreClone.text()).replace(/\s*-\s*/g, "-") || null;
    const adjudication = !opponentPlayers.length && targetWon
      ? "default_received"
      : !targetPlayers.length && !targetWon
      ? "default_conceded"
      : /default/i.test(score ?? "")
      ? targetWon ? "default_received" : "default_conceded"
      : /retired/i.test(score ?? "") ? "retired"
      : /walkover/i.test(score ?? "") ? "walkover"
      : null;
    courts[parseCourtLabel(labelText)] = {
      targetPlayers: targetPlayers.map(player => player.name),
      opponentPlayers: opponentPlayers.map(player => player.name),
      result: targetWon ? "W" : "L",
      status: `${targetWon ? "W" : "L"}${score ? ` · ${score}` : ""}`,
      score,
      adjudication,
      targetRatings: targetPlayers.map(player => ({
        name: player.name,
        historicalDr: {
          value: player.historicalDr,
          evidenceType: "individual_match_page_dr"
        }
      })),
      opponentRatings: opponentPlayers.map(player => ({
        name: player.name,
        historicalDr: {
          value: player.historicalDr,
          evidenceType: "individual_match_page_dr"
        },
        utr: {
          lookupStatus: "not_started",
          singles: emptyRating(),
          doubles: emptyRating(),
          exactDecimalsAvailable: false,
          exactDecimalsBlocker: "UTR enrichment not run",
          retrievedAt: null
        }
      }))
    };
  });
  const targetCourtWins = Object.values(courts)
    .filter(court => court.result === "W").length;
  const targetCourtLosses = Object.values(courts)
    .filter(court => court.result === "L").length;

  return {
    id: new URL(source.url).searchParams.get("mid") ?? `${date}-${opponent.name}`,
    sourceUrl: source.url,
    date,
    phase,
    opponent: opponent.name,
    sourceSummary: {
      metric: summaryMetric,
      targetValue: teams[targetIndex].summaryValue,
      opponentValue: opponent.summaryValue
    },
    teamResult: {
      wins: targetCourtWins,
      losses: targetCourtLosses,
      result: targetCourtWins > targetCourtLosses ? "W" : "L",
      source: "tennisrecord",
      authoritative: false
    },
    officialTeamResult: null,
    courts
  };
}

export function parsePlayerProfileMetadata(html) {
  const $ = cheerio.load(html);
  const spans = $("span")
    .map((_, element) => clean($(element).text()))
    .get();
  const ratingLabel = spans.find(value => /^\d\.\d\s+[CSAD]$/.test(value));
  const genderLabel = spans.find(value => /^(Male|Female)$/i.test(value));
  return {
    ntrpType: ratingLabel?.match(/\s([CSAD])$/)?.[1] ?? "unknown",
    gender: /^male$/i.test(genderLabel ?? "")
      ? "Men"
      : /^female$/i.test(genderLabel ?? "")
        ? "Women"
        : "Unknown"
  };
}

async function collectRatingTypes(roster, delayMs) {
  for (const player of roster) {
    const html = await fetchText(player.profileUrl);
    const metadata = parsePlayerProfileMetadata(html);
    player.ntrp.type = metadata.ntrpType;
    player.gender = metadata.gender;
    if (delayMs) await sleep(delayMs);
  }
}

export async function collectTennisRecordTeam(teamUrl, options = {}) {
  const html = await fetchText(teamUrl);
  const parsed = parseTeamProfile(html, teamUrl);
  if (!parsed.team.name || !parsed.roster.length) {
    throw new Error("Unable to parse team identity or roster from TennisRecord");
  }
  if (options.collectRatingTypes !== false) {
    await collectRatingTypes(parsed.roster, options.delayMs ?? 200);
  }
  const opponentDirectory = new Map();
  const opponentTeamUrls = [
    ...new Set(parsed.matchLinks.map(link => link.opponentTeamUrl).filter(Boolean))
  ];
  for (const opponentTeamUrl of opponentTeamUrls) {
    const opponentHtml = await fetchText(opponentTeamUrl);
    const opponentTeam = parseTeamProfile(opponentHtml, opponentTeamUrl);
    for (const player of opponentTeam.roster) {
      const existing = opponentDirectory.get(player.name) ?? {
        name: player.name,
        locations: [],
        teams: [],
        dr: null,
        ntrp: player.ntrp
      };
      if (player.location && !existing.locations.includes(player.location)) {
        existing.locations.push(player.location);
      }
      if (!existing.teams.includes(opponentTeam.team.name)) {
        existing.teams.push(opponentTeam.team.name);
      }
      if (player.dr != null) existing.dr = player.dr;
      opponentDirectory.set(player.name, existing);
    }
    if (options.delayMs) await sleep(options.delayMs);
  }
  const matches = [];
  for (const link of parsed.matchLinks) {
    const matchHtml = await fetchText(link.url);
    matches.push(parseMatch(matchHtml, parsed.team.name, link));
    if (options.delayMs) await sleep(options.delayMs);
  }
  return {
    ...parsed,
    matches,
    opponentDirectory: [...opponentDirectory.values()]
  };
}

export async function previewTennisRecordTeam(teamUrl) {
  const parsed = parseTeamProfile(await fetchText(teamUrl), teamUrl);
  if (!parsed.team.name || !parsed.roster.length) {
    throw new Error("Unable to parse team identity or roster from TennisRecord");
  }
  return {
    team: parsed.team,
    rosterSize: parsed.roster.length,
    leagueTeams: parsed.leagueTeams,
    leagueSchedule: parsed.leagueSchedule
  };
}
