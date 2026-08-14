import test from "node:test";
import assert from "node:assert/strict";
import { parseMatch, parseTeamProfile } from "../scripts/lib/tennisrecord.mjs";

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
  <tr><th>Local Schedule</th><th>Time</th><th>Opponent</th><th>Match Site</th><th>Result</th></tr>
  <tr><td>04/01/2026</td><td>6 PM</td><td><a href="/adult/teamprofile.aspx?teamname=OPP&year=2026">OPP</a></td><td>TBA</td><td><a href="/adult/matchresults.aspx?year=2026&mid=1">3-2</a></td></tr>
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
  assert.equal(parsed.roster[0].name, "Jane Doe");
  assert.equal(parsed.roster[0].location, "Test City, CA");
  assert.equal(parsed.roster[0].dr, 3.21);
  assert.equal(parsed.roster[0].wtn.lookupStatus, "not_started");
  assert.equal(parsed.matchLinks[0].url, "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=1");
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

test("parses target-oriented court data", () => {
  const match = parseMatch(matchHtml, "TEST TEAM", {
    url: "https://www.tennisrecord.com/adult/matchresults.aspx?year=2026&mid=1"
  });
  assert.equal(match.date, "2026-04-01");
  assert.deepEqual(match.courts.S1.targetPlayers, ["Jane Doe"]);
  assert.deepEqual(match.courts.S1.opponentPlayers, ["Ann Other"]);
  assert.equal(match.courts.S1.result, "W");
  assert.equal(match.courts.S1.score, "6-2 6-0");
  assert.equal(match.courts.S1.opponentRatings[0].historicalDr.value, 2.91);
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
