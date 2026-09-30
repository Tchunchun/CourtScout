import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMatch,
  parsePlayerProfileMetadata,
  parseTeamProfile
} from "../scripts/lib/tennisrecord.mjs";

const teamHtml = `
<main><div class="wrapper1000"><div>
  <table><tr><td>Team Profile</td></tr></table>
  <table>
    <tr><td>Adult 18+ Test F 3.0</td></tr>
    <tr><td>2026 ADULT 18&Over (Women's 3.0)</td></tr>
    <tr><td>TEST TEAM</td></tr>
  </table>
</div></div>
<table>
  <tr><th>Name</th><th>Location</th><th>NTRP</th><th>2026 Record</th><th>Local Singles</th><th>Local Doubles</th><th>Local Record</th><th>Rating</th><th></th></tr>
  <tr><td><a href="/adult/profile.aspx?playername=Jane Doe">Jane Doe</a></td><td>Test City, CA</td><td>3.0</td><td>4-1</td><td>2-0</td><td>2-1</td><td>4-1</td><td>3.21</td><td></td></tr>
</table>
<table>
  <tr><th>Local Schedule</th><th>Opponent</th></tr>
  <tr>
    <td><span>04/01/2026 6:00 PM</span><br><span>TBA</span></td>
    <td><a href="/adult/teamprofile.aspx?teamname=OPP&year=2026">OPP</a><br><a href="/adult/matchresults.aspx?year=2026&mid=1">3-2</a></td>
  </tr>
  <tr>
    <td><span>04/08/2026 7:00 PM</span><br><span>Test Courts</span></td>
    <td><a href="/adult/teamprofile.aspx?teamname=NEW%20OPP&year=2026">NEW OPP</a><br><a href="/adult/matchresults.aspx?year=2026&mid=2">4-1</a></td>
  </tr>
  <tr>
    <td><span>04/15/2026 7:00 PM</span><br><span>Future Courts</span></td>
    <td><a href="/adult/teamprofile.aspx?teamname=FUTURE%20OPP&year=2026">FUTURE OPP</a><br><a href="/adult/matchresults.aspx?year=2026&mid=3">0-0</a></td>
  </tr>
</table></main>`;

const matchHtml = `
<main>
<table><tr><td>Scheduled Date:</td><td>04/01/2026</td></tr><tr><td>Match Type:</td><td>Local Match</td></tr></table>
<table>
  <tr><th>Team Name</th><th>Courts Won</th><th>Sets Lost</th><th>Games Lost</th></tr>
  <tr><td>TEST TEAM</td><td>1</td><td>0</td><td>2</td></tr>
  <tr><td>OPP</td><td>0</td><td>2</td><td>12</td></tr>
</table>
<div class="wrapper496"><div>Singles #1</div></div>
<div class="container496"><table>
  <tr><td>Home Team</td><td></td><td></td><td>Score</td><td></td><td></td><td>Visiting Team</td></tr>
  <tr>
    <td><a href="/adult/profile.aspx?playername=Jane Doe">Jane Doe</a> (3.21)</td>
    <td></td><td><img alt="Winner"></td><td>6 - 2<br>6 - 0</td><td></td><td></td>
    <td><a href="/adult/profile.aspx?playername=Ann Other">Ann Other</a> (2.91)</td>
  </tr>
</table></div>
</main>`;

test("parses TennisRecord team roster and match links", () => {
  const parsed = parseTeamProfile(
    teamHtml,
    "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=TEST"
  );
  assert.equal(parsed.team.name, "TEST TEAM");
  assert.equal(parsed.team.leagueFormat, "single_gender");
  assert.equal(parsed.team.gender, "Women");
  assert.equal(parsed.roster[0].name, "Jane Doe");
  assert.equal(parsed.roster[0].location, "Test City, CA");
  assert.equal(parsed.roster[0].dr, 3.21);
  assert.equal(parsed.roster[0].wtn.lookupStatus, "not_started");
  assert.deepEqual(parsed.leagueSchedule, [
    {
      id: "tennisrecord:1",
      sourceOpponentName: "OPP",
      sourceOpponentUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=OPP&year=2026",
      linkedOpponentTeamId: null,
      date: "2026-04-01",
      time: "6:00 PM",
      timezone: null,
      round: null,
      site: null,
      designation: "unknown",
      status: "completed",
      sourceType: "tennisrecord",
      sourceReference: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=1",
      sourceMatchId: "1",
      sourceResult: "3-2"
    },
    {
      id: "tennisrecord:2",
      sourceOpponentName: "NEW OPP",
      sourceOpponentUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=NEW%20OPP&year=2026",
      linkedOpponentTeamId: null,
      date: "2026-04-08",
      time: "7:00 PM",
      timezone: null,
      round: null,
      site: "Test Courts",
      designation: "unknown",
      status: "completed",
      sourceType: "tennisrecord",
      sourceReference: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=2",
      sourceMatchId: "2",
      sourceResult: "4-1"
    },
    {
      id: "tennisrecord:3",
      sourceOpponentName: "FUTURE OPP",
      sourceOpponentUrl: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=FUTURE%20OPP&year=2026",
      linkedOpponentTeamId: null,
      date: "2026-04-15",
      time: "7:00 PM",
      timezone: null,
      round: null,
      site: "Future Courts",
      designation: "unknown",
      status: "scheduled",
      sourceType: "tennisrecord",
      sourceReference: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=3",
      sourceMatchId: "3",
      sourceResult: "0-0"
    }
  ]);
  assert.deepEqual(parsed.leagueTeams, [
    {
      name: "OPP",
      url: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=OPP&year=2026"
    },
    {
      name: "NEW OPP",
      url: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=NEW%20OPP&year=2026"
    },
    {
      name: "FUTURE OPP",
      url: "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=FUTURE%20OPP&year=2026"
    }
  ]);
  assert.deepEqual(
    parsed.matchLinks.map(match => ({ date: match.date, url: match.url })),
    [
      {
        date: "04/01/2026",
        url: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=1"
      },
      {
        date: "04/08/2026",
        url: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=2"
      }
    ]
  );
});

test("parses men's team gender for rating identity matching", () => {
  const parsed = parseTeamProfile(
    teamHtml
      .replace("Test F 3.0", "Test M 3.0")
      .replace("Women's 3.0", "Men's 3.0"),
    "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=TEST"
  );
  assert.equal(parsed.team.gender, "Men");
});

test("identifies mixed leagues independently from team gender", () => {
  const parsed = parseTeamProfile(
    teamHtml
      .replace("Adult 18+ Test F 3.0", "Mixed 18+ Pacific NW X 7.0")
      .replace("2026 ADULT 18&Over (Women's 3.0)", "2026 Mixed 18 & Over (A)"),
    "https://www.tennisrecord.com/adult/teamprofile.aspx?year=2026&teamname=TEST"
  );

  assert.equal(parsed.team.leagueFormat, "mixed");
  assert.equal(parsed.team.gender, "Mixed");
});

test("parses player gender and NTRP type from a TennisRecord profile", () => {
  assert.deepEqual(parsePlayerProfileMetadata(`
    <span class="responsive12">Male</span>
    <span>3.5 C</span>
  `), {
    ntrpType: "C",
    gender: "Men"
  });
  assert.deepEqual(parsePlayerProfileMetadata(`
    <span class="responsive12">Female</span>
    <span>4.0 S</span>
  `), {
    ntrpType: "S",
    gender: "Women"
  });
});

test("parses target-oriented court data", () => {
  const match = parseMatch(matchHtml, "TEST TEAM", {
    url: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=1"
  });
  assert.equal(match.date, "2026-04-01");
  assert.equal(match.phase, "local");
  assert.deepEqual(match.courts.S1.targetPlayers, ["Jane Doe"]);
  assert.deepEqual(match.courts.S1.opponentPlayers, ["Ann Other"]);
  assert.equal(match.courts.S1.result, "W");
  assert.equal(match.courts.S1.score, "6-2 6-0");
  assert.equal(match.courts.S1.opponentRatings[0].historicalDr.value, 2.91);
});

test("classifies championship match phases", () => {
  const source = {
    url: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=3"
  };
  for (const [matchType, expectedPhase] of [
    ["District Championship Match", "district"],
    ["Sectional Championship Match", "sectionals"],
    ["National Championship Match", "nationals"],
    ["Postseason Match", "playoff"]
  ]) {
    const match = parseMatch(
      matchHtml.replace("Local Match", matchType),
      "TEST TEAM",
      source
    );
    assert.equal(match.phase, expectedPhase);
  }
});

test("supports points-based match summaries and derives court results", () => {
  const pointsHtml = matchHtml
    .replace("Courts Won", "Points Won")
    .replace("<td>1</td><td>0</td>", "<td>21.0</td><td>0</td>")
    .replace("<td>0</td><td>2</td>", "<td>0.0</td><td>2</td>");
  const match = parseMatch(pointsHtml, "TEST TEAM", {
    url: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=2"
  });

  assert.equal(match.sourceSummary.metric, "Points Won");
  assert.equal(match.sourceSummary.targetValue, 21);
  assert.equal(match.teamResult.wins, 1);
  assert.equal(match.teamResult.losses, 0);
  assert.equal(match.teamResult.result, "W");
});
