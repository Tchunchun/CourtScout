export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function sectionalName(section) {
  return String(section ?? "")
    .replace(/Adult\s+18\+/gi, "")
    .replace(/(?:^|\s)F(?=\s|$)/gi, "")
    .replace(/\b3\.0\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function reportTeamLabels(section, teamName) {
  const sectional = sectionalName(section);
  const name = String(teamName ?? "").trim();
  const prefix = `${sectional} - `;
  const team = sectional && name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? name.slice(prefix.length)
    : name;
  return {
    sectional,
    team,
    title: [sectional, team].filter(Boolean).join(" - ")
  };
}

export function sortTeamsByReportTitle(teams) {
  return [...(teams ?? [])].sort((a, b) => {
    const aTitle = reportTeamLabels(a.team?.section, a.team?.name ?? a.datasetId).title;
    const bTitle = reportTeamLabels(b.team?.section, b.team?.name ?? b.datasetId).title;
    return aTitle.localeCompare(bTitle, undefined, {
      sensitivity: "base",
      numeric: true
    });
  });
}

export const TEMP_REPORTS_COLLECTION_ID = "__temp_reports__";

export function buildReportCollections(collections, teams) {
  const cards = (collections ?? []).map(collection => ({
    id: collection.id,
    name: collection.name,
    competitionLevel: collection.competitionLevel,
    teams: (teams ?? []).filter(team =>
      collection.teamDatasetIds.includes(team.datasetId)
    )
  }));
  const assignedDatasetIds = new Set(
    (collections ?? []).flatMap(collection => collection.teamDatasetIds)
  );
  cards.push({
    id: TEMP_REPORTS_COLLECTION_ID,
    name: "Temp collection",
    competitionLevel: null,
    temporary: true,
    teams: (teams ?? []).filter(team =>
      !assignedDatasetIds.has(team.datasetId)
    )
  });
  return cards;
}

export function ratingDisplay(rating) {
  if (!rating) return "NR";
  return rating.display ?? (rating.value != null ? Number(rating.value).toFixed(2) : "NR");
}

export function ratingCell(rating) {
  const display = ratingDisplay(rating);
  const masked = /x|\*/i.test(display);
  const missing = display === "NR";
  return `<span class="rating${masked ? " masked" : ""}${missing ? " missing" : ""}"${missing ? ' title="Not rated"' : ""}>${escapeHtml(display)}</span>`;
}

function normalizedRosterName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]/gu, "")
    .toLocaleLowerCase();
}

export function activeNationalRoster(dataset) {
  if (!(dataset?.nationalRoster ?? []).length) {
    return dataset?.roster ?? [];
  }
  const scoutingPlayers = new Map(
    (dataset.roster ?? []).map(player => [normalizedRosterName(player.name), player])
  );
  return dataset.nationalRoster.map(player => {
    const scoutingPlayer = scoutingPlayers.get(normalizedRosterName(player.name));
    return {
      ...(scoutingPlayer ?? {}),
      name: player.name,
      gender: player.gender,
      ntrp: {
        ...(scoutingPlayer?.ntrp ?? {}),
        level: player.ntrp
      },
      nationalRosterAsOf: dataset.nationalRosterAsOf
    };
  });
}

export function rankIneligiblePlayers(players) {
  return (players ?? [])
    .filter(player => player.status === "ineligible")
    .sort((a, b) =>
      a.matchesNeeded - b.matchesNeeded ||
      b.countedMatches - a.countedMatches ||
      b.actualMatches - a.actualMatches ||
      a.name.localeCompare(b.name)
    );
}

function recordDisplay(value) {
  return `${value?.wins ?? 0}–${value?.losses ?? 0}`;
}

export function topDoublesPairsTable(pairs, limit = 8) {
  const topPairs = (pairs ?? []).slice(0, limit);
  if (!topPairs.length) {
    return '<p class="top-pairs-empty">No doubles pairs are available.</p>';
  }
  return `
    <div class="table-wrap top-pairs-table"><table>
      <thead><tr><th>Pair</th><th>Uses</th><th>Courts</th><th>Record</th><th>Postseason</th><th>Avg DR</th><th>Avg doubles UTR</th><th>Lower-DR wins</th></tr></thead>
      <tbody>${topPairs.map((pair, index) => `
        <tr>
          <td><span class="pair-rank">#${index + 1}</span>${escapeHtml(pair.pair)}</td>
          <td>${pair.appearances}</td>
          <td>${pair.courts.map(item => `${escapeHtml(item.court)} ×${item.appearances}`).join(", ")}</td>
          <td>${recordDisplay(pair.record)}</td>
          <td>${recordDisplay(pair.postseasonRecord)}</td>
          <td>${Number.isFinite(pair.currentRatings.drAverage) ? pair.currentRatings.drAverage.toFixed(2) : "—"}</td>
          <td>${Number.isFinite(pair.currentRatings.doublesUtrAverage) ? pair.currentRatings.doublesUtrAverage.toFixed(2) : "Incomplete"}</td>
          <td>${pair.comparisonMetrics.lowerDrWins}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;
}

function comparisonRating(value, digits, sourceRating = null) {
  if (sourceRating?.display) return escapeHtml(sourceRating.display);
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function singlesComparisonSummary(player) {
  const metrics = player.comparisonMetrics;
  const hasUpset = metrics.lowerDrWins > 0 || metrics.lowerUtrWins > 0;
  const favoriteLosses = metrics.favoriteDrLosses + metrics.favoriteUtrLosses;
  return `
    <div class="known-result-summary">
      <span class="result-marker ${hasUpset ? "upset" : ""}" aria-hidden="true">${hasUpset ? "★" : "○"}</span>
      <span><strong>DR: ${metrics.lowerDrWins} higher-rated win${metrics.lowerDrWins === 1 ? "" : "s"}; UTR: ${metrics.lowerUtrWins} higher-rated win${metrics.lowerUtrWins === 1 ? "" : "s"}.</strong>
      ${favoriteLosses
        ? `${favoriteLosses} favorite-loss signal${favoriteLosses === 1 ? "" : "s"} across complete rating comparisons.`
        : "No favorite-loss signal in complete rating comparisons."}</span>
    </div>`;
}

function knownSinglesResult(appearance) {
  const resultClass = appearance.result === "W"
    ? "win"
    : appearance.result === "L" ? "loss" : "";
  const phase = appearance.postseason ? " · postseason" : "";
  const adjudication = appearance.adjudication
    ? ` · ${appearance.adjudication.replaceAll("_", " ")}`
    : "";
  const dr = appearance.ratings.dr;
  const utr = appearance.ratings.singlesUtr;
  return `
    <div class="known-result">
      <div><strong>${escapeHtml(appearance.date.slice(5).replace("-", "/"))}${phase} · ${escapeHtml(appearance.court)}</strong>
      vs ${escapeHtml(appearance.opponent ?? "unknown opponent")}</div>
      <div class="known-result-ratings">DR ${comparisonRating(dr.target, 2)} / ${comparisonRating(dr.opponent, 2)}
      · UTR ${comparisonRating(utr.target, 2, utr.targetRating)} / ${comparisonRating(utr.opponent, 2, utr.opponentRating)}</div>
      <span class="pill ${resultClass}">${escapeHtml(appearance.onCourtResult ?? appearance.result)} · ${escapeHtml(appearance.score ?? "score unavailable")}${escapeHtml(adjudication)}</span>
    </div>`;
}

export function singlesPlayersTable(players) {
  if (!(players ?? []).length) {
    return '<p class="singles-results-empty">No known singles results are available.</p>';
  }
  return `
    <div class="table-wrap singles-results-table"><table>
      <thead><tr><th>Player</th><th>Current DR</th><th>Singles UTR</th><th>Likely Role</th><th>Known Singles Results</th></tr></thead>
      <tbody>${players.map(player => `
        <tr>
          <td>${escapeHtml(player.name)}</td>
          <td>${Number.isFinite(player.dr) ? Number(player.dr).toFixed(2) : "—"}</td>
          <td>${escapeHtml(ratingDisplay(player.singlesUtr))}</td>
          <td class="singles-role">${escapeHtml(player.likelyRole)}</td>
          <td class="known-results">
            ${singlesComparisonSummary(player)}
            ${player.appearances.map(knownSinglesResult).join("")}
          </td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;
}

function stackingRating(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "—";
}

function completeStackingMatches(matches, ratingKey) {
  return matches.filter(match =>
    match.lines?.length > 1 &&
    match.lines.every(line => Number.isFinite(line[ratingKey]))
  );
}

function strongestCourtTendency(matches, strongestKey) {
  const counts = new Map();
  for (const match of matches) {
    const court = match[strongestKey];
    if (court) counts.set(court, (counts.get(court) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([court, count]) => ({ court, count }))
    .sort((a, b) =>
      b.count - a.count ||
      a.court.localeCompare(b.court, undefined, { numeric: true })
    )[0] ?? null;
}

function stackingOverview(matches, discipline, ratingLabel) {
  const topCourt = discipline === "singles" ? "S1" : "D1";
  const lowerCourts = discipline === "singles" ? "S2" : "D2/D3";
  const drMatches = completeStackingMatches(matches, "averageDr");
  const utrMatches = completeStackingMatches(matches, "averageUtr");
  const comparableMatches = matches.filter(match =>
    drMatches.includes(match) && utrMatches.includes(match)
  );
  const agreements = comparableMatches.filter(match =>
    match.strongestCourtByDr === match.strongestCourtByUtr
  ).length;
  const drTendency = strongestCourtTendency(drMatches, "strongestCourtByDr");
  const utrTendency = strongestCourtTendency(utrMatches, "strongestCourtByUtr");
  const lowerDr = drMatches.filter(match => match.strongestCourtByDr !== topCourt).length;
  const lowerUtr = utrMatches.filter(match => match.strongestCourtByUtr !== topCourt).length;
  const completeComparisons = drMatches.length + utrMatches.length;
  const lowerSignalRate = completeComparisons
    ? (lowerDr + lowerUtr) / completeComparisons
    : 0;
  const pattern = lowerSignalRate > 0.5
    ? `${lowerCourts} carried the strongest line more often than ${topCourt}.`
    : lowerSignalRate >= 0.25
      ? `Line strength was mixed between ${topCourt} and ${lowerCourts}.`
      : lowerDr || lowerUtr
        ? `${topCourt} usually led, with ${lowerCourts} occasionally carrying the stronger line.`
        : `${topCourt} consistently carried the strongest available line.`;
  const agreementText = comparableMatches.length
    ? `${agreements} of ${comparableMatches.length}`
    : "Not enough data";

  return {
    drTendency,
    drMatchCount: drMatches.length,
    utrTendency,
    utrMatchCount: utrMatches.length,
    agreementText,
    lowerCourtText: `${lowerDr} by DR · ${lowerUtr} by ${ratingLabel}`,
    coverageText: `Complete court comparisons: DR ${drMatches.length}/${matches.length} · ${ratingLabel} ${utrMatches.length}/${matches.length}.`,
    read: `${pattern} Ratings indicate lineup strength, not intent.`
  };
}

function stackingDate(date) {
  const parts = String(date ?? "").split("-");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : String(date ?? "—");
}

function teamMatchDisplay(match) {
  const result = match.officialTeamResult;
  const score = Number.isFinite(result?.wins) && Number.isFinite(result?.losses)
    ? `, ${result.wins}-${result.losses}${result.result ? ` ${result.result}` : ""}`
    : "";
  return `vs ${escapeHtml(match.opponentTeam ?? "Unknown opponent")}${escapeHtml(score)}`;
}

function stackingLossSignals(match) {
  const signals = [];
  for (const line of match.lines ?? []) {
    if (line.result !== "L") continue;
    const ratingSignals = [];
    if (Number.isFinite(line.averageDr) &&
        Number.isFinite(line.opponentAverageDr) &&
        line.averageDr > line.opponentAverageDr) {
      ratingSignals.push(`DR (+${(line.averageDr - line.opponentAverageDr).toFixed(2)})`);
    }
    if (Number.isFinite(line.averageUtr) &&
        Number.isFinite(line.opponentAverageUtr) &&
        line.averageUtr > line.opponentAverageUtr) {
      ratingSignals.push(`UTR (+${(line.averageUtr - line.opponentAverageUtr).toFixed(2)})`);
    }
    if (ratingSignals.length) signals.push(`${line.court} by ${ratingSignals.join(" and ")}`);
  }
  return signals;
}

function stackingRead(match) {
  const drCourt = match.strongestCourtByDr ?? "—";
  const utrCourt = match.strongestCourtByUtr ?? "—";
  const losses = stackingLossSignals(match);
  return `
    <strong>Highest:</strong> DR ${escapeHtml(drCourt)}; UTR ${escapeHtml(utrCourt)}.<br>
    <strong>Lost down:</strong> ${escapeHtml(losses.length ? `${losses.join("; ")}.` : "None.")}
    ${match.sourceRead ? `<small>${escapeHtml(match.sourceRead)}</small>` : ""}`;
}

function stackingCourtCell(line, match, discipline) {
  if (!line) return '<td class="stack-cell stack-missing">No court recorded</td>';
  const resultClass = line.result === "W" ? "stack-win" : line.result === "L" ? "stack-loss" : "";
  const resultLabel = line.result ?? "—";
  const adjudication = line.adjudication
    ? ` · ${String(line.adjudication).replaceAll("_", " ")}`
    : "";
  const targetLabel = match.targetTeamName ?? "Team";
  const targetPlayers = line.targetPlayers?.length
    ? line.targetPlayers.map(escapeHtml).join(" + ")
    : "Lineup unavailable";
  const opponentPlayers = line.opponentPlayers?.length
    ? line.opponentPlayers.map(escapeHtml).join(" + ")
    : "No opponent recorded";
  const ratingPrefix = discipline === "doubles" ? "Pair avg" : targetLabel;
  return `
    <td class="stack-cell ${resultClass}">
      <span class="stack-status">${escapeHtml(resultLabel)} · ${escapeHtml(line.score ?? "score unavailable")}${escapeHtml(adjudication)}</span>
      <span class="stack-names"><b>${escapeHtml(targetLabel)}:</b> ${targetPlayers}<br><b>Opp:</b> ${opponentPlayers}</span>
      <span class="stack-rating"><b>${escapeHtml(ratingPrefix)}</b> DR ${stackingRating(line.averageDr)} / UTR ${stackingRating(line.averageUtr)}<br><b>Opp</b> DR ${stackingRating(line.opponentAverageDr)} / UTR ${stackingRating(line.opponentAverageUtr)}</span>
    </td>`;
}

export function matchStackingDetails(matches, discipline) {
  const ratingLabel = discipline === "singles" ? "singles UTR" : "doubles UTR";
  const courts = discipline === "singles" ? ["S1", "S2"] : ["D1", "D2", "D3"];
  const targetTeamName = matches?.[0]?.targetTeamName ?? "Team";
  const matchLabel = `${matches?.length ?? 0} ${matches?.length === 1 ? "match" : "matches"}`;
  if (!matches?.length) {
    return `
      <section class="stacking-analysis">
        <div class="stacking-heading">
          <div><span class="step-label">${matchLabel}</span><h3>Court-by-court stacking</h3></div>
        </div>
        <p class="stacking-empty">No ${escapeHtml(discipline)} courts are available to compare.</p>
      </section>`;
  }

  const overview = stackingOverview(matches, discipline, ratingLabel);
  return `
    <section class="stacking-analysis">
      <div class="stacking-heading">
        <div><span class="step-label">${matchLabel}</span><h3>Court-by-court ${discipline === "singles" ? "singles stacking read" : "stacking read"}</h3></div>
        <p>${discipline === "doubles"
          ? "Full names, exact scores, historical match-page pair-average DR, and current doubles UTR. The read identifies the strongest court by each rating and every loss to a lower-rated pair."
          : "Full names, exact scores, historical match-page DR, and current singles UTR. An em dash marks an incomplete comparison."}</p>
      </div>
      <div class="stacking-overview">
        <div class="stacking-overview-copy">
          <span>Overview analysis</span>
          <strong>${escapeHtml(overview.read)}</strong>
          <small>${escapeHtml(overview.coverageText)}</small>
        </div>
        <div class="stacking-overview-metrics">
          <article>
            <span>DR tendency</span>
            <strong>${escapeHtml(overview.drTendency?.court ?? "Unavailable")}</strong>
            <small>${overview.drTendency ? `${overview.drTendency.count} of ${overview.drMatchCount} complete matches` : "No complete comparison"}</small>
          </article>
          <article>
            <span>${escapeHtml(ratingLabel)} tendency</span>
            <strong>${escapeHtml(overview.utrTendency?.court ?? "Unavailable")}</strong>
            <small>${overview.utrTendency ? `${overview.utrTendency.count} of ${overview.utrMatchCount} complete matches` : "No complete comparison"}</small>
          </article>
          <article>
            <span>DR / UTR agreement</span>
            <strong>${escapeHtml(overview.agreementText)}</strong>
            <small>Same strongest court</small>
          </article>
          <article>
            <span>Lower-court signals</span>
            <strong>${escapeHtml(overview.lowerCourtText)}</strong>
            <small>Matches led outside ${discipline === "singles" ? "S1" : "D1"}</small>
          </article>
        </div>
      </div>
      <div class="table-wrap stacking-table-wrap">
        <table class="stacking-table ${discipline}-stacking-table">
          <thead><tr>
            <th>Date</th>
            <th>Team Match</th>
            ${courts.map(court => `<th>${court} Result · ${escapeHtml(targetTeamName)} vs Opp</th>`).join("")}
            <th>${discipline === "singles" ? "Standout Read" : "Stacking Read"}</th>
          </tr></thead>
          <tbody>${matches.map(match => {
            const lines = new Map((match.lines ?? []).map(line => [line.court, line]));
            return `<tr>
              <td>${escapeHtml(stackingDate(match.date))}</td>
              <td>${teamMatchDisplay(match)}</td>
              ${courts.map(court => stackingCourtCell(lines.get(court), match, discipline)).join("")}
              <td class="stacking-read">${stackingRead(match)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function courtPlayerLine(name, rating, ratingType) {
  const dr = rating?.currentDr ?? rating?.dr ?? rating?.historicalDr?.value;
  const utr = ratingDisplay(rating?.utr?.[ratingType]);
  const details = [
    dr != null ? `DR ${Number(dr).toFixed(2)}` : null,
    utr !== "NR" ? `UTR ${utr}` : "UTR NR"
  ].filter(Boolean).join(" · ");
  return `<div class="court-player"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(details)}</small></div>`;
}

export function matchCourtRows(match) {
  const courtEntries = Object.entries(match.courts);
  const wins = courtEntries.filter(([, court]) => court.result === "W").length;
  const losses = courtEntries.filter(([, court]) => court.result === "L").length;
  const matchResult = wins === losses ? "—" : wins > losses ? "W" : "L";
  const matchResultClass = matchResult === "W" ? "win" : matchResult === "L" ? "loss" : "";

  return courtEntries.map(([courtName, court], index) => {
    const ratingType = courtName.startsWith("S") ? "singles" : "doubles";
    const targetPlayers = court.targetPlayers.map((name, index) =>
      courtPlayerLine(name, court.targetRatings?.[index], ratingType)
    ).join("");
    const opponentPlayers = court.opponentPlayers.map((name, index) =>
      courtPlayerLine(name, court.opponentRatings?.[index], ratingType)
    ).join("");
    const resultClass = court.result === "W" ? "win" : "loss";
    const adjudication = court.adjudication
      ? `<small class="court-adjudication">${escapeHtml(court.adjudication.replaceAll("_", " "))}</small>`
      : "";
    return {
      className: index === 0 ? "match-group-start" : "",
      search: [
        match.date,
        match.opponent,
        match.phase,
        courtName,
        court.score,
        ...court.targetPlayers,
        ...court.opponentPlayers
      ].filter(Boolean).join(" "),
      cells: [
        `<time datetime="${escapeHtml(match.date)}">${escapeHtml(match.date)}</time>`,
        match.sourceUrl
          ? `<a class="source-link match-table-opponent" href="${escapeHtml(match.sourceUrl)}" target="_blank" rel="noreferrer" title="Open TennisRecord match page">${escapeHtml(match.opponent)} ↗</a>`
          : `<strong class="match-table-opponent">${escapeHtml(match.opponent)}</strong>`,
        `<span class="pill">${escapeHtml(match.phase)}</span>`,
        `<span class="pill ${matchResultClass}">${escapeHtml(matchResult)} · ${wins}–${losses}</span>`,
        `<span class="match-court-name">${escapeHtml(courtName)}</span>`,
        `<div class="match-table-lineup">${targetPlayers}</div>`,
        `<div class="match-table-result">
          <span class="pill ${resultClass}">${escapeHtml(court.result)}</span>
          <strong>${escapeHtml(court.score ?? "No score")}</strong>
          ${adjudication}
        </div>`,
        `<div class="match-table-lineup opponent">${opponentPlayers}</div>`
      ]
    };
  });
}
