import test from "node:test";
import assert from "node:assert/strict";
import {
  matchCourtRows,
  matchStackingDetails,
  rankIneligiblePlayers,
  singlesPlayersTable,
  topDoublesPairsTable
} from "../web/public/render.mjs";

test("matchCourtRows renders one flat row per court with players, scores, ratings, and source", () => {
  const rows = matchCourtRows({
    date: "2026-08-01",
    phase: "sectionals_final",
    opponent: "AYTC-Serve Us A Double-Hofler",
    sourceUrl: "https://www.tennisrecord.com/adult/matchresults.aspx?mid=155018",
    courts: {
      S1: {
        targetPlayers: ["Chiqu Li"],
        opponentPlayers: ["Erin Kirkpatrick"],
        targetRatings: [{
          dr: 3.29,
          utr: { singles: { display: "3.89" } }
        }],
        opponentRatings: [{
          currentDr: 2.93,
          utr: { singles: { display: "3.18" } }
        }],
        result: "W",
        score: "6-2 6-0",
        adjudication: null
      },
      D1: {
        targetPlayers: ["Sasha Tanji", "chunchun tong"],
        opponentPlayers: ["Melanie Fix", "Annie Johnson"],
        targetRatings: [{}, {}],
        opponentRatings: [{}, {}],
        result: "L",
        score: "2-6 6-3 1-0",
        adjudication: null
      }
    }
  });

  assert.equal(rows.length, 2);
  assert.match(rows[0].cells.join(" "), /S1/);
  assert.match(rows[0].cells.join(" "), /Chiqu Li/);
  assert.match(rows[0].cells.join(" "), /UTR 3\.89/);
  assert.match(rows[0].cells.join(" "), /6-2 6-0/);
  assert.match(rows[1].cells.join(" "), /D1/);
  assert.match(rows[1].cells.join(" "), /chunchun tong/);
  assert.match(rows[1].cells.join(" "), /2-6 6-3 1-0/);
  assert.match(rows[0].cells.join(" "), /Open TennisRecord match page/);
  assert.equal(rows[0].className, "match-group-start");
  assert.equal(rows[1].className, "");
});

test("matchStackingDetails renders singles courts and strongest-rating reads", () => {
  const html = matchStackingDetails([{
    date: "2026-08-01",
    phase: "sectionals_final",
    targetTeamName: "Target Team",
    opponentTeam: "Opponent <One>",
    officialTeamResult: { wins: 3, losses: 2, result: "W" },
    sourceRead: "S2 absorbs the stronger player.",
    strongestCourtByDr: "S1",
    strongestCourtByUtr: "S2",
    lines: [{
      court: "S2",
      result: "W",
      score: "6-2 6-1",
      targetPlayers: ["Second Player"],
      opponentPlayers: ["Opponent B"],
      averageDr: 3.1,
      averageUtr: 3.5,
      opponentAverageDr: 3.0,
      opponentAverageUtr: 3.2
    }, {
      court: "S1",
      result: "L",
      score: "4-6 3-6",
      targetPlayers: ["First Player"],
      opponentPlayers: ["Opponent A"],
      averageDr: 3.2,
      averageUtr: 3.4,
      opponentAverageDr: 3.0,
      opponentAverageUtr: 3.6
    }]
  }], "singles");

  assert.match(html, /Court-by-court singles stacking read/);
  assert.match(html, />1 match</);
  assert.match(html, /Overview analysis/);
  assert.match(html, /Line strength was mixed between S1 and S2/);
  assert.match(html, /Complete court comparisons: DR 1\/1 · singles UTR 1\/1/);
  assert.match(html, /0 of 1/);
  assert.match(html, /0 by DR · 1 by singles UTR/);
  assert.match(html, /Opponent &lt;One&gt;/);
  assert.match(html, /S1 Result · Target Team vs Opp/);
  assert.match(html, /Target Team:<\/b> First Player/);
  assert.match(html, /Opp:<\/b> Opponent A/);
  assert.match(html, /4-6 3-6/);
  assert.match(html, /Highest:<\/strong> DR S1; UTR S2/);
  assert.match(html, /Lost down:<\/strong> S1 by DR \(\+0\.20\)/);
  assert.match(html, /3-2 W/);
  assert.match(html, /3\.20/);
  assert.match(html, /3\.50/);
  assert.ok(html.indexOf("First Player") < html.indexOf("Second Player"));
});

test("matchStackingDetails renders doubles lineups and unavailable ratings", () => {
  const html = matchStackingDetails([{
    date: "2026-08-02",
    phase: "nationals",
    targetTeamName: "Target Team",
    opponentTeam: "Opponent Two",
    sourceRead: null,
    strongestCourtByDr: "D2",
    strongestCourtByUtr: null,
    lines: [{
      court: "D1",
      result: "W",
      score: "6-4 6-4",
      targetPlayers: ["Player C", "Player D"],
      opponentPlayers: ["Opponent C", "Opponent D"],
      averageDr: 3.1,
      averageUtr: 3.2,
      opponentAverageDr: 3.0,
      opponentAverageUtr: 3.1
    }, {
      court: "D2",
      result: "L",
      score: "5-7 6-7",
      targetPlayers: ["Player A", "Player B"],
      opponentPlayers: ["Opponent A", "Opponent B"],
      averageDr: 3.25,
      averageUtr: null,
      opponentAverageDr: 3.1,
      opponentAverageUtr: 3.0
    }]
  }], "doubles");

  assert.match(html, /Court-by-court stacking read/);
  assert.match(html, />1 match</);
  assert.match(html, /historical match-page pair-average DR/);
  assert.match(html, /D1 Result · Target Team vs Opp/);
  assert.match(html, /Player A \+ Player B/);
  assert.match(html, /Pair avg<\/b> DR 3\.25 \/ UTR —/);
  assert.match(html, /Highest:<\/strong> DR D2; UTR —/);
  assert.match(html, /Lost down:<\/strong> D2 by DR \(\+0\.15\)\./);
  assert.match(html, /Complete court comparisons: DR 1\/1 · doubles UTR 0\/1/);
  assert.match(html, /D2\/D3 carried the strongest line more often than D1/);
  assert.match(html, /No court recorded/);
});

test("topDoublesPairsTable renders only the first eight ranked pairs", () => {
  const pairs = Array.from({ length: 9 }, (_, index) => ({
    pair: `Pair ${index + 1}`,
    appearances: 6 - index,
    courts: [{ court: "D1", appearances: 1 }],
    record: { wins: 1, losses: 0 },
    postseasonRecord: { wins: 0, losses: 0 },
    currentRatings: {
      drAverage: index === 0 ? 3.25 : null,
      doublesUtrAverage: index === 0 ? 3.5 : null
    },
    comparisonMetrics: { lowerDrWins: 0 }
  }));

  const html = topDoublesPairsTable(pairs);

  assert.match(html, /#1/);
  assert.match(html, /Pair 1/);
  assert.match(html, /3\.2500/);
  assert.match(html, /3\.50/);
  assert.match(html, /#8/);
  assert.match(html, /Pair 8/);
  assert.doesNotMatch(html, /Pair 9/);
});

test("rankIneligiblePlayers groups and ranks players closest to eligibility", () => {
  const ranked = rankIneligiblePlayers([
    { name: "Eligible", status: "eligible", matchesNeeded: 0, countedMatches: 3, actualMatches: 3 },
    { name: "Needs Two", status: "ineligible", matchesNeeded: 2, countedMatches: 1, actualMatches: 1 },
    { name: "Needs One B", status: "ineligible", matchesNeeded: 1, countedMatches: 2, actualMatches: 1 },
    { name: "Needs One A", status: "ineligible", matchesNeeded: 1, countedMatches: 2, actualMatches: 2 }
  ]);

  assert.deepEqual(
    ranked.map(player => player.name),
    ["Needs One A", "Needs One B", "Needs Two"]
  );
});

test("singlesPlayersTable renders likely roles and every known result", () => {
  const html = singlesPlayersTable([{
    name: "Singles Player",
    dr: 3.1234,
    singlesUtr: { display: "3.45" },
    likelyRole: "S1 regular",
    comparisonMetrics: {
      lowerDrWins: 1,
      lowerUtrWins: 0,
      favoriteDrLosses: 0,
      favoriteUtrLosses: 0
    },
    appearances: [{
      date: "2026-08-01",
      postseason: true,
      court: "S1",
      opponent: "Higher Player",
      result: "W",
      onCourtResult: "W",
      score: "4-6 6-3 1-0",
      adjudication: null,
      ratings: {
        dr: { target: 3.1, opponent: 3.2 },
        singlesUtr: {
          target: 3.45,
          opponent: 3.4,
          targetRating: { display: "3.45" },
          opponentRating: { display: "3.40" }
        }
      }
    }]
  }]);

  assert.match(html, /S1 regular/);
  assert.match(html, /Higher Player/);
  assert.match(html, /08\/01 · postseason · S1/);
  assert.match(html, /DR 3\.10 \/ 3\.20/);
  assert.match(html, /UTR 3\.45 \/ 3\.40/);
  assert.match(html, /4-6 6-3 1-0/);
  assert.match(html, /★/);
});
