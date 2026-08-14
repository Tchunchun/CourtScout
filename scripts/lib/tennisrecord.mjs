import * as cheerio from "cheerio";
import { fetchText, sleep } from "./io.mjs";
import { emptyRating } from "./ratings.mjs";
import { emptyWtn } from "./wtn.mjs";

const BASE_URL = "https://www.tennisrecord.com";

const clean = value => value.replace(/\s+/g, " ").trim();
const absoluteUrl = href => new URL(href, BASE_URL).href;

function parseRecord(value) {
  const match = clean(value).match(/^(\d+)-(\d+)$/);
  return match ? { wins: Number(match[1]), losses: Number(match[2]) } : null;
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

  const matchLinks = [];
  $("tr").each((_, row) => {
    const resultLink = $(row).find('a[href*="matchresults.aspx"]').first();
    if (!resultLink.length) return;
    const cells = $(row).find("td");
    const date = clean(cells.eq(0).text());
    const result = clean(resultLink.text());
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date) || result === "0-0") return;
    const opponentLink = $(row).find('a[href*="teamprofile.aspx"]').first();
    matchLinks.push({
      date,
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
      gender: /\bF\b|Women|Female/i.test(`${leagueDescriptor} ${leagueName}`)
        ? "Women"
        : /\bM\b|Men|Male/i.test(`${leagueDescriptor} ${leagueName}`)
          ? "Men"
          : "Unknown",
      season: year,
      nationalsRepresentative: false
    },
    roster,
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
  const phase = /postseason/i.test(matchType) ? "playoff" : "local";
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

async function collectRatingTypes(roster, delayMs) {
  for (const player of roster) {
    const html = await fetchText(player.profileUrl);
    const $ = cheerio.load(html);
    const ratingLabel = $("span")
      .map((_, element) => clean($(element).text()))
      .get()
      .find(value => /^\d\.\d\s+[CSAD]$/.test(value));
    const type = ratingLabel?.match(/\s([CSAD])$/)?.[1];
    player.ntrp.type = type ?? "unknown";
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
