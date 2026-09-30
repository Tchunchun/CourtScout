import {
  activeNationalRoster,
  buildReportCollections,
  escapeHtml,
  matchCourtRows,
  matchStackingDetails,
  rankIneligiblePlayers,
  ratingCell,
  ratingDisplay,
  reportTeamLabels,
  sectionalName,
  singlesPlayersTable,
  sortTeamsByReportTitle,
  TEMP_REPORTS_COLLECTION_ID,
  topDoublesPairsTable
} from "./render.mjs";
import {
  MATCH_CARD_COURTS,
  buildOnsitePredictions,
  cloneMatchCard,
  compareCourtLine,
  confirmedOnsitePlayers,
  createMatchCard,
  createTournamentEvidence,
  draftFromPrediction,
  extractLineupFromText,
  matchRosterNames,
  parseStoredMatchCards,
  parseStoredTournamentEvidence,
  summarizeMatchup,
  validateDraft
} from "./match-card.mjs";
import {
  courtScoutRouteHash,
  parseCourtScoutRoute
} from "./navigation.mjs";
import {
  TEAM_WORKSPACE_SCHEDULE_LIMIT,
  assignTeamRole,
  collectionMatchSchedule,
  defaultTeamWorkspace,
  emptyTeamWorkspace,
  groupWorkspaceTeams,
  parseTeamWorkspace,
  rankTeamsBySchedule,
  teamRole
} from "./team-workspace.mjs";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const views = {
  intake: $("#intakeView"),
  progress: $("#progressView"),
  reports: $("#reportsView"),
  results: $("#resultsView"),
  analysisSetup: $("#analysisSetupView"),
  analysis: $("#analysisView"),
  matchCards: $("#matchCardsView")
};
const MATCH_CARDS_STORAGE_KEY = "courtScoutMatchCards";
const TOURNAMENT_EVIDENCE_STORAGE_KEY = "courtScoutTournamentEvidence";
const TEAM_WORKSPACE_STORAGE_KEY = "courtScoutTeamWorkspace";
const ACTIVE_COLLECTION_STORAGE_KEY = "courtScoutActiveTeamCollection";
const PENDING_SCOUT_COLLECTION_STORAGE_KEY = "courtScoutPendingTeamCollection";
let collectionCreateDatasetId = null;
const state = {
  jobId: localStorage.getItem("courtScoutJob"),
  jobKind: null,
  dataset: null,
  teams: [],
  teamCollections: [],
  activeCollectionId: localStorage.getItem(ACTIVE_COLLECTION_STORAGE_KEY),
  selectedTeamId: null,
  analysis: null,
  analysisTeamId: null,
  analysisScope: null,
  analysisTab: "eligibility",
  tab: "roster",
  search: "",
  matchCards: [],
  tournamentEvidence: [],
  tournamentEvidenceError: null,
  pendingTournamentEvidence: null,
  matchCardStorageError: null,
  activeMatchCardId: null,
  matchCardContext: null,
  matchCardError: "",
  teamWorkspace: emptyTeamWorkspace(),
  teamWorkspaceStorageError: null,
  matchCardPrefillOpponentId: null
};
const analysisScopes = new Set(["national", "sectional", "local"]);
const analysisTabs = new Set(["eligibility", "singles", "doubles", "lineups"]);
const eligibilityScopeLabels = {
  national: "National",
  sectional: "Sectional",
  local: "Local"
};
let routeReady = false;

function updateBrowserRoute(route, { replace = false } = {}) {
  if (!routeReady) return;
  const hash = courtScoutRouteHash(route);
  if (window.location.hash === hash) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", hash);
}

function updateRouteForView(name) {
  if (name === "intake") {
    updateBrowserRoute({ view: "scout" });
  } else if (name === "reports") {
    updateBrowserRoute({ view: "reports" });
  } else if (name === "results" && state.selectedTeamId) {
    updateBrowserRoute({
      view: "team",
      teamId: state.selectedTeamId,
      tab: state.tab
    });
  } else if (name === "analysisSetup" && state.selectedTeamId) {
    updateBrowserRoute({
      view: "analysis-setup",
      teamId: state.selectedTeamId
    });
  } else if (name === "analysis" && state.selectedTeamId) {
    updateBrowserRoute({
      view: "analysis",
      teamId: state.selectedTeamId,
      tab: state.analysisTab
    });
  } else if (name === "matchCards") {
    updateBrowserRoute(state.activeMatchCardId
      ? { view: "card", cardId: state.activeMatchCardId }
      : { view: "cards" });
  }
}

async function applyBrowserRoute() {
  const route = parseCourtScoutRoute(window.location.hash);
  if (route.view === "reports") {
    renderReportsTeamList();
    showView("reports");
    return;
  }
  if (route.view === "team") {
    if (!state.teams.some(team => team.id === route.teamId)) {
      renderReportsTeamList();
      showView("reports");
      return;
    }
    state.tab = route.tab;
    await openTeamData(route.teamId);
    return;
  }
  if (route.view === "analysis-setup") {
    if (state.teams.some(team => team.id === route.teamId)) {
      openAnalysisSetup(route.teamId);
      return;
    }
    renderReportsTeamList();
    showView("reports");
    return;
  }
  if (route.view === "analysis") {
    if (!state.teams.some(team => team.id === route.teamId)) {
      renderReportsTeamList();
      showView("reports");
      return;
    }
    state.analysisTab = route.tab;
    await openCompletedAnalysis(route.teamId);
    return;
  }
  if (route.view === "cards") {
    openMatchCardsWorkspace();
    return;
  }
  if (route.view === "card") {
    if (state.matchCards.some(card => card.id === route.cardId)) {
      await openMatchCard(route.cardId);
    } else {
      openMatchCardsWorkspace();
    }
    return;
  }
  showView("intake");
}

function analysisStorageKey(teamId) {
  return `courtScoutAnalysis:${teamId}`;
}

function staleAnalysisStorageKey(teamId) {
  return `courtScoutAnalysisStale:${teamId}`;
}

function completedAnalysisScope(teamId) {
  if (!teamId) return null;
  const scope = localStorage.getItem(analysisStorageKey(teamId));
  return analysisScopes.has(scope) ? scope : null;
}

function analysisIsStale(teamId) {
  return Boolean(
    teamId && localStorage.getItem(staleAnalysisStorageKey(teamId))
  );
}

function markAnalysisStale(teamId) {
  if (!completedAnalysisScope(teamId)) return;
  localStorage.setItem(staleAnalysisStorageKey(teamId), new Date().toISOString());
}

function clearAnalysisStale(teamId) {
  localStorage.removeItem(staleAnalysisStorageKey(teamId));
}

function rememberCompletedAnalysis(teamId, scope) {
  localStorage.setItem(analysisStorageKey(teamId), scope);
  clearAnalysisStale(teamId);
}

function updateAnalysisFreshnessUi() {
  const stale = analysisIsStale(state.selectedTeamId);
  $("#analysisRefreshNotice").hidden = !stale;
  $("#analysisStaleNotice").hidden = !stale;
  $$(".team-workspace-status").forEach(status => {
    status.hidden = !stale;
  });
}

function updateAnalysisAction() {
  const teamId = state.selectedTeamId;
  const hasCurrentAnalysis =
    state.analysis != null && state.analysisTeamId === teamId;
  const stale = analysisIsStale(teamId);
  $("#analyzeCollectedTeam").hidden = stale;
  $("#analyzeCollectedTeam").textContent =
    hasCurrentAnalysis || completedAnalysisScope(teamId)
      ? "Open analysis"
      : "Set up analysis";
  updateAnalysisFreshnessUi();
  updateTeamWorkspaceActions();
}

function teamCollectionId(team) {
  return state.teamCollections.find(collection =>
    collection.teamDatasetIds.includes(team.datasetId)
  )?.id ?? "";
}

function collectionCompetitionLevelLabel(level) {
  return {
    local: "Local season",
    sectional: "Sectional",
    national: "National"
  }[level] ?? "Local season";
}

function activeCollectionTeams() {
  return state.activeCollectionId
    ? state.teams.filter(team =>
      teamCollectionId(team) === state.activeCollectionId
    )
    : state.teams;
}

function collectionOptions(includeAll = false, emptyName = null) {
  return [
    ...(includeAll ? [{ id: "", name: "All gathered teams" }] : [{
      id: "",
      name: emptyName ?? "Temp collection (unassigned)"
    }]),
    ...state.teamCollections
  ].map(collection =>
    `<option value="${escapeHtml(collection.id)}">${escapeHtml(collection.name)}</option>`
  ).join("");
}

function renderCollectionControls() {
  if (
    state.activeCollectionId &&
    !state.teamCollections.some(collection => collection.id === state.activeCollectionId)
  ) {
    state.activeCollectionId = null;
    localStorage.removeItem(ACTIVE_COLLECTION_STORAGE_KEY);
  }
  $("#teamCollection").innerHTML = collectionOptions(true);
  $("#teamCollection").value = state.activeCollectionId ?? "";
  $("#gatherEventCollection").innerHTML = collectionOptions(
    false,
    "Temp collection (unassigned)"
  );
  $("#gatherEventCollection").value = "";
  $("#teamEventCollection").innerHTML = collectionOptions();
  const team = selectedTeam();
  const selectedCollectionId = team ? teamCollectionId(team) : "";
  $("#teamEventCollection").value = selectedCollectionId;
}

async function loadTeamCollections() {
  const response = await api("/api/team-collections");
  state.teamCollections = response.collections;
  if (!state.activeCollectionId && state.teamCollections.length) {
    state.activeCollectionId = state.teamCollections[0].id;
    localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, state.activeCollectionId);
  }
  renderCollectionControls();
}

function teamWorkspaceStorageKey(collectionId = state.activeCollectionId) {
  return collectionId
    ? `${TEAM_WORKSPACE_STORAGE_KEY}:${collectionId}`
    : null;
}

function readStoredTeamWorkspace(collectionId) {
  const storageKey = teamWorkspaceStorageKey(collectionId);
  if (!storageKey) return emptyTeamWorkspace();
  return parseTeamWorkspace(localStorage.getItem(storageKey));
}

function loadStoredTeamWorkspace() {
  try {
    const storageKey = teamWorkspaceStorageKey();
    if (!storageKey) {
      state.teamWorkspace = emptyTeamWorkspace();
      state.teamWorkspaceStorageError = null;
      return;
    }
    const scopedWorkspace = localStorage.getItem(storageKey);
    const legacyWorkspace = localStorage.getItem(TEAM_WORKSPACE_STORAGE_KEY);
    const collection = state.teamCollections.find(
      item => item.id === state.activeCollectionId
    );
    state.teamWorkspace = scopedWorkspace || legacyWorkspace
      ? parseTeamWorkspace(scopedWorkspace ?? legacyWorkspace)
      : defaultTeamWorkspace(collection, state.teams);
    if (!scopedWorkspace && legacyWorkspace) {
      localStorage.setItem(storageKey, JSON.stringify(state.teamWorkspace));
      localStorage.removeItem(TEAM_WORKSPACE_STORAGE_KEY);
    }
    state.teamWorkspaceStorageError = null;
  } catch (error) {
    state.teamWorkspace = emptyTeamWorkspace();
    state.teamWorkspaceStorageError =
      `Team roles could not be read: ${error.message}`;
  }
}

function persistTeamWorkspace() {
  const storageKey = teamWorkspaceStorageKey();
  if (!storageKey) {
    state.teamWorkspaceStorageError =
      "Choose an event collection before assigning team roles.";
    return false;
  }
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(state.teamWorkspace)
    );
    state.teamWorkspaceStorageError = null;
    return true;
  } catch (error) {
    state.teamWorkspaceStorageError =
      `Team roles could not be saved locally: ${error.message}`;
    return false;
  }
}

function workspaceRole(teamId) {
  return teamRole(state.teamWorkspace, teamId);
}

function updateWorkspaceRole(teamId, role) {
  const team = state.teams.find(item => item.id === teamId);
  if (
    !state.activeCollectionId ||
    (team && teamCollectionId(team) !== state.activeCollectionId)
  ) {
    $("#teamRoleError").textContent =
      "Choose the team’s event collection before assigning its role.";
    return false;
  }
  const previous = state.teamWorkspace;
  try {
    state.teamWorkspace = assignTeamRole(previous, teamId, role);
  } catch (error) {
    $("#teamRoleError").textContent = error.message;
    return false;
  }
  if (!persistTeamWorkspace()) {
    state.teamWorkspace = previous;
    $("#teamRoleError").textContent = state.teamWorkspaceStorageError;
    return false;
  }
  $("#teamRoleError").textContent = "";
  renderTeamList();
  renderReportsTeamList();
  updateTeamWorkspaceActions();
  if (!views.matchCards.hidden && !state.activeMatchCardId) {
    renderMatchCardsHome();
  }
  return true;
}

function workspaceActionFor(teamId) {
  const role = workspaceRole(teamId);
  if (role === "our") {
    return { action: "scout-opponent", label: "Scout an opponent" };
  }
  if (role === "scheduled") {
    return { action: "build-matchup", label: "Build matchup" };
  }
  if (!state.teamWorkspace.ourTeamId) {
    return { action: "set-our-team", label: "Set as our team" };
  }
  if (
    state.teamWorkspace.scheduledOpponentIds.length <
    TEAM_WORKSPACE_SCHEDULE_LIMIT
  ) {
    return { action: "add-to-schedule", label: "Add to schedule" };
  }
  return null;
}

function updateTeamWorkspaceActions() {
  const teamId = state.selectedTeamId;
  const team = selectedTeam();
  const selectedCollectionId = team ? teamCollectionId(team) : "";
  $("#teamEventCollection").value = selectedCollectionId;
  const rolesAvailable = Boolean(
    teamId &&
    state.activeCollectionId &&
    selectedCollectionId === state.activeCollectionId
  );
  if (!rolesAvailable) {
    const collection = state.teamCollections.find(
      item => item.id === selectedCollectionId
    );
    $("#teamRoleSelect").disabled = true;
    $("#teamRoleSelect").value = "scouting";
    $("#teamRoleSummary").textContent = selectedCollectionId
      ? "Collection role"
      : "Standalone report";
    $("#teamRoleHint").textContent = selectedCollectionId
      ? `Choose ${collection?.name ?? "this event collection"} to assign Our team or an opponent role.`
      : "Assign this report to a collection before choosing a team role.";
    $("#teamRoleError").textContent = state.teamWorkspaceStorageError ?? "";
    [$("#teamNextAction"), $("#analysisNextAction")].forEach(button => {
      if (button) button.hidden = true;
    });
    return;
  }
  const role = workspaceRole(teamId);
  const summaries = {
    our: {
      title: "Our team",
      hint: "Pinned as the home side for Match Cards."
    },
    scheduled: {
      title: "Scheduled opponent",
      hint: `${state.teamWorkspace.scheduledOpponentIds.length} of ${TEAM_WORKSPACE_SCHEDULE_LIMIT} scheduled opponents added.`
    },
    scouting: {
      title: "Scouting pool",
      hint: "Available for research and reports without appearing in match preparation."
    }
  };
  $("#teamRoleSelect").disabled = false;
  $("#teamRoleSelect").value = role;
  $("#teamRoleSelect").querySelector('[value="scheduled"]').disabled =
    role !== "scheduled" &&
    state.teamWorkspace.scheduledOpponentIds.length >=
      TEAM_WORKSPACE_SCHEDULE_LIMIT;
  $("#teamRoleSummary").textContent = summaries[role].title;
  $("#teamRoleHint").textContent = summaries[role].hint;
  $("#teamRoleError").textContent = state.teamWorkspaceStorageError ?? "";
  const workspaceAction = workspaceActionFor(teamId);
  [$("#teamNextAction"), $("#analysisNextAction")].forEach(button => {
    if (!button) return;
    button.hidden = !workspaceAction;
    button.dataset.workspaceAction = workspaceAction?.action ?? "";
    button.textContent = workspaceAction?.label ?? "";
  });
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.hidden = key !== name;
  });
  const matchCardStep = name === "matchCards";
  const reportsStep = ["reports", "results", "analysisSetup", "analysis"].includes(name);
  document.body.classList.toggle("stage-one", !reportsStep && !matchCardStep);
  document.body.classList.toggle("stage-two", reportsStep);
  document.body.classList.toggle("stage-three", matchCardStep);
  document.body.classList.toggle("intake-active", name === "intake");
  if (name !== "intake") {
    document.body.classList.remove("intake-teams-open");
  }
  [$("#scoutStage"), $("#reportsStage"), $("#matchCardsStage")].forEach(button =>
    button.removeAttribute("aria-current")
  );
  const activeStage = matchCardStep
    ? $("#matchCardsStage")
    : reportsStep ? $("#reportsStage") : $("#scoutStage");
  activeStage.setAttribute("aria-current", "page");
  const stageTwoStep = name === "results"
    ? "report"
    : ["analysisSetup", "analysis"].includes(name) ? "analysis" : null;
  $$("[data-stage-two-step]").forEach(button => {
    if (button.dataset.stageTwoStep === stageTwoStep) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  $("#headerStatusText").textContent = matchCardStep
    ? "Match day planning"
    : reportsStep ? "Reports & analysis" : "Team scouting";
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  window.scrollTo({ top: 0, behavior });
  requestAnimationFrame(() => {
    views[name].querySelector(".view-heading")?.focus({ preventScroll: true });
  });
  updateRouteForView(name);
}

function syncTabState(selector, dataKey, value, panelSelector) {
  const tabs = $$(selector);
  const selected = tabs.find(tab => tab.dataset[dataKey] === value);
  tabs.forEach(tab => {
    const isSelected = tab === selected;
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
  });
  if (selected) {
    $(panelSelector)?.setAttribute("aria-labelledby", selected.id);
  }
}

function bindTablist(selector, dataKey, activate) {
  const tabs = $$(selector);
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", event => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex == null) return;
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      activate(nextTab);
      nextTab.focus();
    });
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Something went wrong.");
  return body;
}

function teamDescription(team) {
  return [
    team.team?.section,
    team.reportAvailable === false
      ? `${team.activeRosterSize ?? 0} active players · report pending`
      : `${team.matchCount ?? 0} matches · ${team.activeRosterSize ?? team.rosterSize ?? 0} active players`
  ].filter(Boolean).join(" · ");
}

function teamHeadingHtml(name) {
  const match = String(name).match(/^(.*\S)\s+(\S*\d\S*)$/);
  if (!match) return escapeHtml(name);
  return `${escapeHtml(match[1])}<span>${escapeHtml(match[2])}</span>`;
}

function teamSectionHtml(section) {
  const name = sectionalName(section);
  return name
    ? `<strong class="team-section-name">${escapeHtml(name)}</strong>`
    : "";
}

function profileStatusLabel(status) {
  const normalized = String(status ?? "unresolved").toLowerCase();
  if (normalized.startsWith("unresolved") || normalized.includes("not_found")) return "Unresolved";
  if (normalized.includes("ambiguous") || normalized.includes("multiple")) return "Needs review";
  if (normalized.includes("resolved")) return "Resolved";
  return "Needs review";
}

function bestTeamDatasets(teams, pinnedId) {
  const stageRank = {
    tennisrecord_complete: 1,
    utr_partial: 2,
    step_1_complete: 3
  };
  const selected = new Map();
  for (const team of teams) {
    const identity = [
      team.team?.season,
      team.team?.name?.toLowerCase(),
      team.team?.level,
      team.team?.gender
    ].join("|");
    const current = selected.get(identity);
    if (!current || team.id === pinnedId) {
      selected.set(identity, team);
      continue;
    }
    if (current.id === pinnedId) continue;
    const teamRank = stageRank[team.collectionStage] ?? 0;
    const currentRank = stageRank[current.collectionStage] ?? 0;
    if (
      teamRank > currentRank ||
      (teamRank === currentRank && team.matchCount > current.matchCount) ||
      (
        teamRank === currentRank &&
        team.matchCount === current.matchCount &&
        team.generatedAt > current.generatedAt
      )
    ) {
      selected.set(identity, team);
    }
  }
  return [...selected.values()];
}

function renderTeamList() {
  const list = $("#teamList");
  const visibleTeams = activeCollectionTeams();
  $("#landingTeamCount").textContent = String(visibleTeams.length);
  if (!visibleTeams.length) {
    list.innerHTML = `<p class="team-list-status">${
      state.teams.length
        ? "No teams in this collection yet."
        : "No gathered teams yet."
    }</p>`;
    return;
  }
  const teamButton = team => `
    <button class="team-link" type="button"
      ${team.reportAvailable === false
        ? "disabled"
        : `data-team-id="${escapeHtml(team.id)}"`}
      aria-pressed="${team.id === state.selectedTeamId}">
      <span>${escapeHtml(team.team?.name ?? team.datasetId)}</span>
      <small title="${escapeHtml(teamDescription(team))}">
        <span>${escapeHtml(team.team?.section ?? "Section unavailable")}</span>
        <span>${team.reportAvailable === false
          ? `${team.activeRosterSize ?? 0} active players`
          : `${team.matchCount ?? 0} matches`}</span>
      </small>
    </button>
  `;
  const group = (title, count, teams, emptyMessage) => `
    <section class="team-list-group">
      <div class="team-list-group-heading">
        <span>${escapeHtml(title)}</span><b>${escapeHtml(count)}</b>
      </div>
      ${teams.length
        ? teams.map(teamButton).join("")
        : `<p class="team-list-group-empty">${escapeHtml(emptyMessage)}</p>`}
    </section>`;
  if (!state.activeCollectionId) {
    list.innerHTML = group(
      "All gathered teams",
      String(visibleTeams.length),
      visibleTeams,
      "No gathered teams yet."
    );
  } else {
    const groups = groupWorkspaceTeams(visibleTeams, state.teamWorkspace);
    list.innerHTML = [
      group(
        "Our team",
        groups.ourTeam ? "1" : "0",
        groups.ourTeam ? [groups.ourTeam] : [],
        "No team assigned yet."
      ),
      group(
        "Scheduled opponents",
        `${groups.scheduledOpponents.length}/${TEAM_WORKSPACE_SCHEDULE_LIMIT}`,
        groups.scheduledOpponents,
        "No scheduled opponents yet."
      ),
      group(
        "Scouting pool",
        String(groups.scoutingPool.length),
        groups.scoutingPool,
        "No additional scouting reports yet."
      )
    ].join("");
  }
  if (window.matchMedia("(max-width: 900px)").matches) {
    requestAnimationFrame(() => {
      list.querySelector("[aria-pressed='true']")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center"
      });
    });
  }
}

function renderReportsTeamList() {
  const teams = sortTeamsByReportTitle(
    state.activeCollectionId
      ? state.teams.filter(team =>
        teamCollectionId(team) === state.activeCollectionId
      )
      : state.teams.filter(team => !teamCollectionId(team))
  );
  const collection = state.teamCollections.find(
    item => item.id === state.activeCollectionId
  );
  const collectionName = collection?.name ?? "Temp collection";
  const readyCount = teams.filter(team => team.reportAvailable !== false).length;
  const rankedTeams = rankTeamsBySchedule(teams, state.teamWorkspace);
  const hasSchedule = rankedTeams.some(({ scheduleRank }) => scheduleRank != null);
  $("#reportsCollectionName").textContent = collectionName;
  $("#reportsCollectionLevel").textContent = collection
    ? collectionCompetitionLevelLabel(collection.competitionLevel)
    : "Unassigned";
  $("#reportsTeamCount").textContent =
    `${teams.length} ${teams.length === 1 ? "team" : "teams"}`;
  $("#reportsTeamSummary").textContent =
    `${readyCount} ${readyCount === 1 ? "report" : "reports"} ready in this collection.`;
  $("#reportsTeamList").innerHTML = teams.length
    ? rankedTeams.map(({ team, scheduleRank }) => {
      const labels = reportTeamLabels(
        team.team?.section,
        team.team?.name ?? team.datasetId
      );
      const reportAvailable = team.reportAvailable !== false;
      const role = workspaceRole(team.id);
      const status = scheduleRank != null
        ? "Scheduled opponent"
        : role === "our"
          ? "Our team"
          : reportAvailable ? "Scouted team" : "National team";
      return `
      <article class="report-team-row${hasSchedule ? " has-schedule" : ""}${scheduleRank != null ? " scheduled" : ""}">
        ${hasSchedule ? `
          <div class="report-team-rank">
            ${scheduleRank != null
              ? `<strong>#${scheduleRank}</strong><small>Schedule</small>`
              : '<span aria-hidden="true">—</span><small>Not scheduled</small>'}
          </div>
        ` : ""}
        <div class="report-team-summary">
          <span>${status}</span>
          <strong title="${escapeHtml(labels.title)}">
            <span class="team-section-name">${escapeHtml(labels.sectional || "Section unavailable")}</span>
            <span> - </span>
            <span>${escapeHtml(labels.team)}</span>
          </strong>
          <small>${reportAvailable
            ? `${team.matchCount ?? 0} matches · ${team.activeRosterSize ?? team.rosterSize ?? 0} active players`
            : `${team.activeRosterSize ?? 0} active players · report pending`}</small>
        </div>
        <div class="report-team-actions">
          <button class="button-secondary" type="button"
            ${reportAvailable
              ? `data-report-team-id="${escapeHtml(team.id)}"`
              : "disabled"}
            aria-label="${reportAvailable
              ? `View report and analysis for ${escapeHtml(labels.title)}`
              : `Report not gathered for ${escapeHtml(labels.title)}`}">
            ${reportAvailable ? "View report &amp; analysis" : "Report not gathered"}
          </button>
          ${scheduleRank != null ? `
            <button class="button-primary compact" type="button"
              data-prepare-match-id="${escapeHtml(team.id)}"
              aria-label="Prepare match against ${escapeHtml(labels.title)}">
              Prepare match
            </button>
          ` : ""}
        </div>
      </article>
    `;
    }).join("")
    : `
      <div class="reports-empty-state">
        <strong>No scouted teams in this collection yet</strong>
        <p>Scout a team to gather its roster, match history, and ratings.</p>
        <button class="button-primary compact" type="button" data-scout-collection-team>Scout your first team</button>
      </div>
    `;
}

function renderReportsCollections() {
  const cards = buildReportCollections(state.teamCollections, state.teams);

  const reportCount = state.teams.filter(
    team => team.reportAvailable !== false
  ).length;
  $("#reportsCollectionSummary").textContent = cards.length
    ? `${cards.length} ${cards.length === 1 ? "collection" : "collections"} · ${reportCount} ${reportCount === 1 ? "report" : "reports"} ready`
    : "Collections keep reports for the same event together.";
  $("#reportsCollectionList").innerHTML = cards.length
    ? cards.map(({ id, name, competitionLevel, temporary, teams }) => {
      const readyCount = teams.filter(team =>
        team.reportAvailable !== false
      ).length;
      return `
        <button class="report-collection-card" type="button"
          data-reports-collection-id="${escapeHtml(id)}">
          <span class="report-collection-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 7.5h6l2-2h10v13H3z"/><path d="M3 9.5h18"/></svg>
          </span>
          <span class="report-collection-copy">
            <span class="report-collection-level">${
              competitionLevel
                ? escapeHtml(collectionCompetitionLevelLabel(competitionLevel))
                : temporary ? "Unassigned" : "Unfiled"
            }</span>
            <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
            <small>${teams.length} ${teams.length === 1 ? "team" : "teams"} · ${readyCount} ${readyCount === 1 ? "report" : "reports"} ready</small>
          </span>
          <span class="report-collection-action">View team reports <b aria-hidden="true">→</b></span>
        </button>
      `;
    }).join("")
    : `
      <div class="reports-empty-state">
        <strong>No report collections yet</strong>
        <p>Create a collection to organize teams for an event, then gather team data in Step 1.</p>
        <button class="button-primary compact" type="button" data-create-report-collection>Create collection</button>
      </div>
    `;
}

function showReportsHome() {
  renderReportsCollections();
  $("#reportsViewEyebrow").textContent = "Step 2 · Reports & analysis";
  $("#reportsViewHeading").textContent = "Report collections";
  $("#reportsViewDescription").textContent =
    "Choose an event collection, then open a team report to review and analyze.";
  $("#createReportCollection").hidden = false;
  $("#reportsCollectionsPanel").hidden = false;
  $("#reportsTeamsPanel").hidden = true;
  showView("reports");
}

function showReportsCollection(collectionId) {
  setActiveCollection(collectionId);
  renderReportsTeamList();
  $("#reportsViewEyebrow").textContent = "Reports & analysis · Collection";
  $("#reportsViewHeading").textContent = "Team reports";
  $("#reportsViewDescription").textContent =
    "Choose a team to inspect its roster, match history, and analysis.";
  $("#createReportCollection").hidden = true;
  $("#reportsCollectionsPanel").hidden = true;
  $("#reportsTeamsPanel").hidden = false;
  showView("reports");
}

function showSelectedTeamCollection() {
  const team = selectedTeam();
  showReportsCollection(team ? teamCollectionId(team) || null : state.activeCollectionId);
}

async function loadTeams(selectedId = state.selectedTeamId) {
  try {
    const response = await api("/api/teams");
    state.teams = bestTeamDatasets(response.teams, selectedId);
    if (selectedId && state.teams.some(team => team.id === selectedId)) {
      state.selectedTeamId = selectedId;
    }
    renderTeamList();
    renderReportsTeamList();
    renderReportsCollections();
    renderCollectionControls();
    updateTeamWorkspaceActions();
    if (!views.matchCards.hidden && !state.activeMatchCardId) {
      renderMatchCardsHome();
    }
  } catch (error) {
    const message = escapeHtml(error.message);
    $("#teamList").innerHTML =
      `<p class="team-list-status error">${message}</p>`;
    $("#reportsCollectionList").innerHTML =
      `<p class="empty-state">Report collections could not be loaded: ${message}</p>`;
    $("#reportsTeamList").innerHTML =
      `<p class="empty-state">Team reports could not be loaded: ${message}</p>`;
  }
}

function selectedTeam() {
  return state.teams.find(team => team.id === state.selectedTeamId) ?? null;
}

function openAnalysisSetup(teamId) {
  const team = state.teams.find(item => item.id === teamId);
  if (!team) {
    $("#analysisError").textContent = "This team dataset is not available.";
    return;
  }
  state.selectedTeamId = team.id;
  renderTeamList();
  $("#analysisTeamName").textContent = team.team?.name ?? team.datasetId;
  $("#analysisTeamMeta").textContent = teamDescription(team);
  $("#eligibilityScope").value =
    (state.analysisTeamId === team.id ? state.analysisScope : null) ??
    completedAnalysisScope(team.id) ??
    "national";
  $("#analysisError").textContent = "";
  updateAnalysisFreshnessUi();
  showView("analysisSetup");
}

async function openTeamData(teamId) {
  const team = state.teams.find(item => item.id === teamId);
  if (!team) return;
  state.selectedTeamId = team.id;
  renderTeamList();
  renderCollectionControls();
  try {
    const data = await api(`/api/team-data?team=${encodeURIComponent(team.id)}`);
    renderDataset(data);
  } catch (error) {
    $("#analysisError").textContent = error.message;
    openAnalysisSetup(team.id);
  }
}

function setUtrStatus(signedIn, error = null) {
  $("#utrStatusTitle").textContent = signedIn ? "UTR connected" : "UTR sign-in required";
  $("#utrStatusText").textContent = signedIn
    ? "Your signed-in session is ready for exact decimal collection."
    : error ?? "Your password stays with UTR. We never receive or store it.";
  $("#connectUtr").textContent = signedIn ? "Check again" : "Open UTR sign in";
  $("#utrConnect").classList.toggle("connected", signedIn);
}

async function checkUtrStatus() {
  const button = $("#connectUtr");
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const status = await api("/api/utr/status");
    setUtrStatus(status.signedIn, status.error);
    return status.signedIn;
  } finally {
    button.disabled = false;
  }
}

function syncRatingOptions() {
  const includeUtr = $("#includeUtr").checked;
  const includeWtn = $("#includeWtn").checked;
  const exact = includeUtr &&
    $('input[name="utrMode"]:checked').value === "authenticated";
  $("#utrOptions").hidden = !includeUtr;
  $("#utrConnect").hidden = !exact;
  const ratings = [
    ...(includeUtr ? [exact ? "Exact UTR" : "Public UTR"] : []),
    ...(includeWtn ? ["WTN"] : [])
  ];
  $("#ratingSummary").textContent = ratings.length
    ? `Ratings: ${ratings.join(" + ")}`
    : "Ratings: None";
  $("#formError").textContent = "";
  if (exact) void checkUtrStatus();
}

$("#includeUtr").addEventListener("change", syncRatingOptions);
$("#includeWtn").addEventListener("change", syncRatingOptions);
$$('input[name="utrMode"]').forEach(input => {
  input.addEventListener("change", syncRatingOptions);
});
$("#connectUtr").addEventListener("click", async () => {
  const button = $("#connectUtr");
  if (button.textContent.includes("Check")) {
    await checkUtrStatus();
    return;
  }
  button.disabled = true;
  button.textContent = "Opening…";
  try {
    await api("/api/utr/connect", { method: "POST", body: "{}" });
    $("#utrStatusTitle").textContent = "Finish signing in with UTR";
    $("#utrStatusText").textContent = "Complete sign-in in the new window, then return here and check again.";
    button.textContent = "Check sign-in";
  } catch (error) {
    setUtrStatus(false, error.message);
  } finally {
    button.disabled = false;
  }
});

$("#collectionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const teamUrl = $("#teamUrl").value.trim();
  const utrMode = $("#includeUtr").checked
    ? $('input[name="utrMode"]:checked').value
    : "none";
  const includeWtn = $("#includeWtn").checked;
  $("#formError").textContent = "";
  submit.disabled = true;
  submit.firstChild.textContent = "Starting collection ";
  const collectionTarget = $("#scoutCollectionContext").dataset.collectionTarget;
  const eventCollectionId =
    collectionTarget && collectionTarget !== TEMP_REPORTS_COLLECTION_ID
      ? collectionTarget
      : null;

  try {
    const job = await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        teamUrl,
        utrMode,
        includeWtn,
        eventCollectionId
      })
    });
    state.jobId = job.id;
    state.jobKind = job.kind;
    localStorage.setItem("courtScoutJob", job.id);
    if (collectionTarget) {
      localStorage.setItem(
        PENDING_SCOUT_COLLECTION_STORAGE_KEY,
        collectionTarget
      );
    } else {
      localStorage.removeItem(PENDING_SCOUT_COLLECTION_STORAGE_KEY);
    }
    showView("progress");
    updateProgress(job);
    pollJob();
  } catch (error) {
    $("#formError").textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.firstChild.textContent = "Start gathering data ";
  }
});

function syncRefreshOptions() {
  const includeUtr = $("#refreshUtr").checked;
  const exact = includeUtr &&
    $('input[name="refreshUtrMode"]:checked').value === "authenticated";
  $("#refreshUtrOptions").hidden = !includeUtr;
  $("#refreshConnectUtr").hidden = !exact;
  $("#refreshError").textContent = "";
}

$("#openRefreshData").addEventListener("click", () => {
  if (!state.dataset || !state.selectedTeamId) return;
  const current = getRatingSelections(state.dataset);
  $("#refreshTennisRecord").checked = false;
  $("#refreshUtr").checked = false;
  $("#refreshWtn").checked = false;
  $('input[name="refreshRatingScope"][value="all"]').checked = true;
  const utrMode = current.utr === "authenticated" ? "authenticated" : "public";
  $(`input[name="refreshUtrMode"][value="${utrMode}"]`).checked = true;
  $("#refreshError").textContent = "";
  syncRefreshOptions();
  $("#refreshDialog").showModal();
});

$("#closeRefreshDialog").addEventListener("click", () => {
  $("#refreshDialog").close();
});
$("#cancelRefresh").addEventListener("click", () => {
  $("#refreshDialog").close();
});
$("#refreshUtr").addEventListener("change", syncRefreshOptions);
$$('input[name="refreshUtrMode"]').forEach(input => {
  input.addEventListener("change", syncRefreshOptions);
});
$("#refreshConnectUtr").addEventListener("click", async () => {
  const button = $("#refreshConnectUtr");
  button.disabled = true;
  button.textContent = "Opening…";
  try {
    await api("/api/utr/connect", { method: "POST", body: "{}" });
    button.textContent = "UTR opened — finish sign in";
  } catch (error) {
    $("#refreshError").textContent = error.message;
    button.textContent = "Open UTR sign in";
  } finally {
    button.disabled = false;
  }
});

$("#refreshForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const refreshTennisRecord = $("#refreshTennisRecord").checked;
  const refreshUtr = $("#refreshUtr").checked;
  const refreshWtn = $("#refreshWtn").checked;
  const ratingScope = $('input[name="refreshRatingScope"]:checked').value;
  const utrMode = refreshUtr
    ? $('input[name="refreshUtrMode"]:checked').value
    : "none";
  $("#refreshError").textContent = "";
  submit.disabled = true;
  submit.textContent = "Starting refresh…";
  try {
    const job = await api("/api/refresh-jobs", {
      method: "POST",
      body: JSON.stringify({
        teamId: state.selectedTeamId,
        refreshTennisRecord,
        refreshUtr,
        utrMode,
        refreshWtn,
        ratingScope
      })
    });
    state.jobId = job.id;
    state.jobKind = job.kind;
    localStorage.setItem("courtScoutJob", job.id);
    $("#refreshDialog").close();
    showView("progress");
    updateProgress(job);
    pollJob();
  } catch (error) {
    $("#refreshError").textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Refresh selected sources";
  }
});

function updateProgress(job) {
  state.jobKind = job.kind;
  if (job.teamId) state.selectedTeamId = job.teamId;
  $("#progressPercent").textContent = `${job.progress}%`;
  $("#progressBar").style.width = `${job.progress}%`;
  $("#progressDetail").textContent = job.error ?? job.detail;
  const selections = job.refreshSelections ?? job.ratingSelections ?? {
    utr: job.mode ?? "public",
    wtn: true
  };
  const order = [
    job.kind !== "refresh" || selections.tennisrecord ? "tennisrecord" : null,
    selections.utr !== "none" ? "utr" : null,
    selections.wtn ? "wtn" : null,
    "validation"
  ].filter(Boolean);
  $(".progress-copy .eyebrow").textContent = job.kind === "refresh"
    ? "Refresh in progress"
    : "Collection in progress";
  $(".progress-copy h1").textContent = job.kind === "refresh"
    ? "Updating your scouting dataset."
    : "Building your scouting dataset.";
  $("#tryAgain").textContent = job.kind === "refresh"
    ? "Return to team"
    : "Return to setup";
  const current = order.indexOf(job.phase);
  $$(".phase-list > div").forEach(item => {
    const index = order.indexOf(item.dataset.phase);
    item.hidden = index === -1;
    item.classList.toggle("active", index === current);
    item.classList.toggle("done", index !== -1 && (
      job.phase === "complete" || index < current
    ));
  });
  if (job.status === "failed") {
    $("#progressDetail").textContent = job.error;
    $(".progress-copy .eyebrow").textContent = job.kind === "refresh"
      ? "Refresh needs attention"
      : "Collection needs attention";
    $(".progress-copy h1").textContent = job.kind === "refresh"
      ? "The previous dataset is still available."
      : "We couldn’t finish this dataset.";
    $("#tryAgain").hidden = false;
  }
}

async function pollJob() {
  if (!state.jobId) return;
  try {
    const job = await api(`/api/jobs/${state.jobId}`);
    updateProgress(job);
    if (job.status === "complete") {
      await loadResults(job);
      return;
    }
    if (job.status !== "failed") {
      window.setTimeout(pollJob, 1200);
    }
  } catch {
    localStorage.removeItem("courtScoutJob");
    state.jobId = null;
    routeReady = true;
    showView("intake");
  }
}

function getRows() {
  const data = state.dataset;
  const selections = getRatingSelections(data);
  if (state.tab === "roster") {
    const hasNationalRoster = Boolean(data.nationalRoster?.length);
    return activeNationalRoster(data).map(player => ({
      search: `${player.name} ${player.location ?? ""}`,
      cells: [
        escapeHtml(player.name),
        ...(hasNationalRoster ? [escapeHtml(player.gender)] : []),
        player.location ? escapeHtml(player.location) : '<span class="missing-value" title="Not available">—</span>',
        player.ntrp?.level ? escapeHtml(player.ntrp.level) : '<span class="missing-value" title="Not available">—</span>',
        player.dr != null ? `<span class="rating">${Number(player.dr).toFixed(2)}</span>` : '<span class="missing-value" title="Not available">—</span>',
        ...(selections.utr !== "none" ? [
          ratingCell(player.utr?.singles),
          ratingCell(player.utr?.doubles)
        ] : []),
        ...(selections.wtn ? [
          ratingCell(player.wtn?.singles),
          ratingCell(player.wtn?.doubles)
        ] : [])
      ]
    }));
  }
  if (state.tab === "opponents") {
    return data.opponents.map(player => ({
      search: `${player.name} ${(player.locations ?? []).join(" ")}`,
      cells: [
        escapeHtml(player.name),
        (player.locations ?? []).length
          ? escapeHtml(player.locations.join(", "))
          : '<span class="missing-value" title="Not available">—</span>',
        player.dr != null ? `<span class="rating">${Number(player.dr).toFixed(2)}</span>` : '<span class="missing-value" title="Not available">—</span>',
        ...(selections.utr !== "none" ? [
          ratingCell(player.utr?.singles),
          ratingCell(player.utr?.doubles),
          `<span class="pill status-pill" title="${escapeHtml(player.utr?.lookupStatus?.replaceAll("_", " ") ?? "unresolved")}">${escapeHtml(profileStatusLabel(player.utr?.lookupStatus))}</span>`
        ] : []),
        ...(selections.wtn ? [
          ratingCell(player.wtn?.singles),
          ratingCell(player.wtn?.doubles)
        ] : [])
      ]
    }));
  }
  if (state.tab === "matches") {
    return data.matches.flatMap(matchCourtRows);
  }
  return data.sources.map(source => ({
    search: `${source.type} ${source.authentication ?? ""}`,
    cells: [
      escapeHtml(source.type.replaceAll("_", " ")),
      escapeHtml(source.retrievedAt ?? "—"),
      `<span class="pill">${escapeHtml(source.authentication ?? "public")}</span>`,
      escapeHtml((source.fields ?? []).join(", ")),
      source.url ? `<a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">View source ↗</a>` : "—"
    ]
  }));
}

const headings = {
  matches: ["Date", "Opponent team", "Phase", "Match", "Court", "Our lineup", "Court result", "Opponent lineup"],
  sources: ["Source", "Retrieved", "Access", "Fields collected", "Link"]
};

function getRatingSelections(data) {
  const exact = data.sources.some(source =>
    source.authentication === "user-authenticated" && source.type.includes("utr")
  );
  const publicUtr = data.sources.some(source =>
    source.type.includes("utr") && source.authentication === "not_authenticated"
  );
  return data.ratingSelections ?? {
    utr: exact ? "authenticated" : publicUtr ? "public" : "none",
    wtn: data.sources.some(source =>
      source.type === "world_tennis_number_public_profiles"
    )
  };
}

function getHeadings() {
  const selections = getRatingSelections(state.dataset);
  if (state.tab === "roster") {
    const hasNationalRoster = Boolean(state.dataset.nationalRoster?.length);
    return [
      "Player",
      ...(hasNationalRoster ? ["Gender"] : []),
      "Location",
      "NTRP",
      "Dynamic rating",
      ...(selections.utr !== "none" ? ["Singles UTR", "Doubles UTR"] : []),
      ...(selections.wtn ? ["Singles WTN", "Doubles WTN"] : [])
    ];
  }
  if (state.tab === "opponents") {
    return [
      "Opponent",
      "Location",
      "Dynamic rating",
      ...(selections.utr !== "none"
        ? ["Singles UTR", "Doubles UTR", "Profile status"]
        : []),
      ...(selections.wtn ? ["Singles WTN", "Doubles WTN"] : [])
    ];
  }
  return headings[state.tab];
}

function renderTable() {
  const tableHeadings = getHeadings();
  const isNumericColumn = heading =>
    /NTRP|rating|UTR|WTN|Courts/i.test(heading);
  $("#dataHead").innerHTML = `<tr>${tableHeadings.map(item =>
    `<th class="${isNumericColumn(item) ? "numeric" : ""}">${item}</th>`
  ).join("")}</tr>`;
  $("#datasetPanel").classList.toggle("matches-table-wrap", state.tab === "matches");
  $("#tableScrollHint").hidden = state.tab !== "matches";
  const query = state.search.toLowerCase();
  const rows = getRows().filter(row => row.search.toLowerCase().includes(query));
  $("#dataBody").innerHTML = rows
    .map(row => `
      <tr class="${row.className ?? ""}">
        ${row.cells.map((cell, index) =>
          `<td class="${isNumericColumn(tableHeadings[index] ?? "") ? "numeric" : ""}">${cell}</td>`
        ).join("")}
      </tr>
    `)
    .join("");
  $("#emptyState").hidden = rows.length > 0;
  $("#tableSearch").placeholder = state.tab === "matches"
    ? "Search matches"
    : state.tab === "sources"
      ? "Search sources"
      : state.tab === "opponents" ? "Search opponents" : "Search roster";
  $("#tableSearch").setAttribute(
    "aria-label",
    state.tab === "matches"
      ? "Search matches"
      : state.tab === "sources"
        ? "Search sources"
        : state.tab === "opponents" ? "Search opponents" : "Search roster"
  );
}

bindTablist("[data-tab]", "tab", button => {
    state.tab = button.dataset.tab;
    state.search = "";
    $("#tableSearch").value = "";
    syncTabState("[data-tab]", "tab", state.tab, "#datasetPanel");
    renderTable();
    updateBrowserRoute({
      view: "team",
      teamId: state.selectedTeamId,
      tab: state.tab
    });
});

$("#tableSearch").addEventListener("input", event => {
  state.search = event.target.value;
  renderTable();
});

async function loadResults(job) {
  const data = await api(`/api/jobs/${state.jobId}/data`);
  let collectionSyncError = null;
  if (job.kind !== "refresh" && job.eventCollectionId) {
    state.activeCollectionId = job.eventCollectionId;
    localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, job.eventCollectionId);
    try {
      await loadTeamCollections();
      loadStoredTeamWorkspace();
    } catch (error) {
      collectionSyncError =
        `The collection list could not be refreshed: ${error.message}`;
    }
  }
  localStorage.removeItem(PENDING_SCOUT_COLLECTION_STORAGE_KEY);
  const teamId = job?.teamId ??
    (job?.collectionName ? `collections/${job.collectionName}` : null);
  if (teamId) {
    state.selectedTeamId = teamId;
  }
  if (job.kind === "refresh" && teamId) {
    markAnalysisStale(teamId);
  }
  routeReady = true;
  renderDataset(data);
  if (teamId) await loadTeams(teamId);
  if (collectionSyncError || job.warning) {
    $("#teamRoleError").textContent = job.warning ?? collectionSyncError;
  }
}

function renderDataset(data) {
  state.dataset = data;
  const selections = getRatingSelections(data);
  const allPeople = [...data.roster, ...data.opponents];
  const requestedProfiles = [];
  if (selections.utr !== "none") {
    requestedProfiles.push(...allPeople.map(player => player.utr));
  }
  if (selections.wtn) {
    requestedProfiles.push(...allPeople.map(player => player.wtn));
  }
  const resolved = requestedProfiles.filter(profile =>
    ["singles", "doubles"].some(type => {
      const rating = profile?.[type];
      return rating?.value != null ||
        (rating?.display && rating.display !== "NR");
    })
  ).length;
  const catalogTeam = state.teams.find(team =>
    team.datasetId === data.datasetId
  );
  $("#teamName").innerHTML = teamHeadingHtml(
    catalogTeam?.team?.name ?? data.team.name
  );
  $("#teamMeta").innerHTML = [
    data.team.season && escapeHtml(data.team.season),
    teamSectionHtml(data.team.section),
    data.team.gender && escapeHtml(data.team.gender)
  ].filter(Boolean).join(" · ");
  const activeRosterSize = data.nationalRoster?.length ?? data.roster.length;
  $("#rosterCount").textContent = activeRosterSize;
  $("#rosterCountLabel").textContent = data.nationalRoster?.length
    ? `active as of ${data.nationalRosterAsOf}`
    : "team players";
  $("#datasetTabRoster").textContent = data.nationalRoster?.length
    ? "National roster"
    : "Roster";
  $("#opponentCount").textContent = data.opponents.length;
  $("#matchCount").textContent = data.matches.length;
  $("#ratingCoverage").textContent = requestedProfiles.length
    ? `${Math.round((resolved / requestedProfiles.length) * 100)}%`
    : "N/A";
  $(".quality-banner").classList.remove("partial");
  $("#qualityTitle").textContent = "Data ready";
  const ratingLabels = [];
  if (selections.utr === "authenticated") ratingLabels.push("Exact UTR");
  if (selections.utr === "public") ratingLabels.push("Public UTR");
  if (selections.wtn) ratingLabels.push("Public WTN");
  $("#qualityMode").textContent = ratingLabels.length
    ? ratingLabels.join(" + ")
    : "Ratings not requested";
  $("#qualityText").textContent = ratingLabels.length
    ? "Validated with selected rating sources."
    : "Only TennisRecord team, roster, and match data were requested.";
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  $("#downloadData").href = URL.createObjectURL(blob);
  syncTabState("[data-tab]", "tab", state.tab, "#datasetPanel");
  renderTable();
  updateAnalysisAction();
  updateTeamWorkspaceActions();
  showView("results");
}

function formatRecord(value) {
  return `${value?.wins ?? 0}–${value?.losses ?? 0}`;
}

function eligibilityTable(players, { ranked = false, emptyMessage }) {
  if (!players.length) {
    return `<p class="eligibility-empty">${escapeHtml(emptyMessage)}</p>`;
  }
  return `
    <div class="table-wrap eligibility-table"><table>
      <colgroup>
        <col class="eligibility-player-column">
        <col class="eligibility-dr-column">
        <col class="eligibility-utr-column">
        <col class="eligibility-local-column">
        <col class="eligibility-local-column">
        <col class="eligibility-count-column">
        <col class="eligibility-count-column">
        <col class="eligibility-role-column">
        <col class="eligibility-note-column">
      </colgroup>
      <thead><tr><th>Player</th><th class="eligibility-number">DR</th><th class="eligibility-number">UTR S / D</th><th class="eligibility-number">Local S<br>(W-L)</th><th class="eligibility-number">Local D<br>(W-L)</th><th class="eligibility-number"><abbr title="Actual local match appearances; defaults received are excluded">Local #</abbr></th><th class="eligibility-number"><abbr title="Actual postseason match appearances; defaults received are excluded">Post #</abbr></th><th>Role</th><th>Standout Note</th></tr></thead>
      <tbody>${players.map((player, index) => `
        <tr>
          <td class="eligibility-player">${ranked ? `<span class="eligibility-rank">#${index + 1}</span>` : ""}${escapeHtml(player.name)}</td>
          <td class="eligibility-number">${Number.isFinite(player.dr) ? Number(player.dr).toFixed(2) : "—"}</td>
          <td class="eligibility-number">${escapeHtml(ratingDisplay(player.utr?.singles))} / ${escapeHtml(ratingDisplay(player.utr?.doubles))}</td>
          <td class="eligibility-number">${player.local.singles.appearances} (${player.local.singles.record.wins}–${player.local.singles.record.losses})</td>
          <td class="eligibility-number">${player.local.doubles.appearances} (${player.local.doubles.record.wins}–${player.local.doubles.record.losses})</td>
          <td class="eligibility-number eligibility-total">${player.local.appearances}</td>
          <td class="eligibility-number eligibility-total">${player.postseasonAppearances}</td>
          <td class="eligibility-role">${escapeHtml(player.role)}</td>
          <td class="eligibility-note">${escapeHtml(player.standoutNote)}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;
}

function renderEligibilityAnalysis() {
  const eligibility = state.analysis.eligibility;
  const eligiblePlayers = eligibility.players.filter(player => player.status === "eligible");
  const ineligiblePlayers = rankIneligiblePlayers(eligibility.players);
  const otherPlayers = eligibility.players.filter(player =>
    player.status !== "eligible" && player.status !== "ineligible"
  );
  return `
    <div class="analysis-section-heading">
      <div><span class="step-label">${escapeHtml(eligibility.label)} target</span>
      <h2>Player eligibility</h2></div>
      <p>Computer-rated players need ${eligibility.rules.computerRatedMatches} match(es);
      self-rated or appealed players need ${eligibility.rules.selfRatedOrAppealedMatches} actual match(es).</p>
    </div>
    <div class="eligibility-groups">
      <section class="eligibility-group">
        <div class="analysis-subsection-heading">
          <div><span class="step-label">${eligiblePlayers.length} players</span><h3>Eligible players</h3></div>
          <p>Players who currently meet the selected eligibility target.</p>
        </div>
        ${eligibilityTable(eligiblePlayers, {
          emptyMessage: "No players currently meet this eligibility target."
        })}
      </section>
      <section class="eligibility-group">
        <div class="analysis-subsection-heading">
          <div><span class="step-label">${ineligiblePlayers.length} players</span><h3>Ineligible players</h3></div>
          <p>Ranked by fewest matches still needed, then most counted appearances.</p>
        </div>
        ${eligibilityTable(ineligiblePlayers, {
          ranked: true,
          emptyMessage: "No ineligible players for this eligibility target."
        })}
      </section>
      ${otherPlayers.length ? `
        <section class="eligibility-group">
          <div class="analysis-subsection-heading">
            <div><span class="step-label">${otherPlayers.length} players</span><h3>Unavailable or unresolved</h3></div>
            <p>Players who cannot yet be included in an eligible lineup.</p>
          </div>
          ${eligibilityTable(otherPlayers, {
            emptyMessage: "No unavailable or unresolved players."
          })}
        </section>` : ""}
    </div>`;
}

function renderSinglesAnalysis() {
  const singles = state.analysis.singles;
  return `
    <div class="analysis-section-heading">
      <div><span class="step-label">S1 + S2</span><h2>Singles players</h2></div>
      <p>${singles.matchStacking.length} ${singles.matchStacking.length === 1 ? "match" : "matches"} analyzed ·
      ${singles.summary.playersUsed} players used ·
      ${singles.summary.lowerDrWins} lower-DR wins ·
      ${singles.summary.favoriteDrLosses} favorite losses.</p>
    </div>
    <div class="court-analysis-grid">
      ${singles.courts.map(court => `
        <article><span>${escapeHtml(court.court)}</span><strong>${formatRecord(court.record)}</strong>
        <small>${court.primaryPersonnel.slice(0, 3).map(item => escapeHtml(item.name)).join(", ")}</small></article>
      `).join("")}
    </div>
    <section class="singles-player-section">
      <div class="analysis-subsection-heading">
        <div><span class="step-label">Player evidence</span><h3>Known singles results by player</h3></div>
        <p>★ marks a known win over a higher-rated opponent by DR or UTR.</p>
      </div>
      ${singlesPlayersTable(singles.players)}
    </section>
    ${matchStackingDetails(singles.matchStacking, "singles")}`;
}

function renderDoublesAnalysis() {
  const doubles = state.analysis.doubles;
  return `
    <div class="analysis-section-heading">
      <div><span class="step-label">D1–D3</span><h2>Doubles pairs</h2></div>
      <p>${doubles.summary.matchesAnalyzed} ${doubles.summary.matchesAnalyzed === 1 ? "match" : "matches"} analyzed ·
      ${doubles.summary.uniquePairs} unique pairs ·
      ${doubles.summary.repeatedPairs} repeat pairs ·
      ${doubles.summary.oneOffPairs} one-off pairs.</p>
    </div>
    <div class="court-analysis-grid">
      ${doubles.courts.map(court => `
        <article><span>${escapeHtml(court.court)}</span><strong>${formatRecord(court.record)}</strong>
        <small>${court.primaryPersonnel.slice(0, 2).map(item => escapeHtml(item.name)).join(", ")}</small></article>
      `).join("")}
    </div>
    <section class="top-pairs-section">
      <div class="analysis-subsection-heading">
        <div><span class="step-label">Top combinations</span><h3>Top 8 doubles pairs</h3></div>
        <p>Ranked by appearances, then win rate.</p>
      </div>
      ${topDoublesPairsTable(doubles.pairs)}
    </section>
    ${matchStackingDetails(doubles.matchStacking, "doubles")}
    `;
}

function renderLineupPredictions() {
  const lineupAnalysis = state.analysis.lineupPredictions;
  if (!lineupAnalysis) {
    return `
      <div class="analysis-section-heading">
        <div><span class="step-label">Update required</span><h2>Likely team lineups</h2></div>
      </div>
      <div class="lineup-version-warning" role="alert">
        <strong>Lineup predictions are not available from the running analysis server.</strong>
        <span>The page received analysis version ${escapeHtml(state.analysis.analysisVersion ?? "unknown")}.
        Restart Court Scout to load analysis version 1.1 or newer, then run the team analysis again.</span>
      </div>`;
  }
  const predictions = lineupAnalysis.predictions ?? [];
  return `
    <div class="analysis-section-heading">
      <div><span class="step-label">Top 3 projections</span><h2>Likely team lineups</h2></div>
      <p>${lineupAnalysis.summary.matchesAnalyzed} matches analyzed ·
      ${lineupAnalysis.summary.eligiblePlayers} eligible players ·
      ${lineupAnalysis.summary.excludedPlayers} unavailable for this target.</p>
    </div>
    <div class="lineup-methodology">
      <strong>How this prediction works</strong>
      <span>${escapeHtml(lineupAnalysis.methodology)} These are pattern-based projections, not confirmed future lineups.</span>
    </div>
    ${predictions.length ? `
      <div class="lineup-predictions">
        ${predictions.map(prediction => `
          <article class="lineup-prediction">
            <header>
              <div><span>Prediction ${prediction.rank}</span><h3>Lineup option #${prediction.rank}</h3></div>
              <div class="lineup-confidence">
                <span class="${escapeHtml(prediction.confidence)}">${escapeHtml(prediction.confidence)} confidence</span>
                <strong>${prediction.historicalSupport}% support</strong>
              </div>
            </header>
            <div class="predicted-courts">
              ${prediction.lines.map(line => `
                <div class="predicted-court">
                  <strong>${escapeHtml(line.court)}</strong>
                  <div>
                    <span>${line.players.map(escapeHtml).join(" + ")}</span>
                    <small>${line.appearances} prior use${line.appearances === 1 ? "" : "s"} ·
                    ${formatRecord(line.record)} record · last ${escapeHtml(line.lastUsedDate ?? "unknown")}</small>
                  </div>
                </div>`).join("")}
            </div>
            <footer>
              <span>${prediction.observedTogether
                ? `Full lineup seen together ${prediction.observedTogether} time${prediction.observedTogether === 1 ? "" : "s"}`
                : "Projected combination from court-specific usage"}</span>
              <span>${prediction.evidence.postseasonCourtAppearances} postseason ·
              ${prediction.evidence.totalCourtAppearances} total court appearances</span>
            </footer>
          </article>
        `).join("")}
      </div>` : `
      <p class="lineup-empty">There is not enough eligible, non-overlapping court history to generate a complete lineup.</p>
    `}
  `;
}

function renderAnalysisContent() {
  const renderers = {
    eligibility: renderEligibilityAnalysis,
    singles: renderSinglesAnalysis,
    doubles: renderDoublesAnalysis,
    lineups: renderLineupPredictions
  };
  $("#analysisContent").innerHTML = renderers[state.analysisTab]();
  syncTabState(
    "[data-analysis-tab]",
    "analysisTab",
    state.analysisTab,
    "#analysisContent"
  );
}

function renderAnalysis() {
  const report = state.analysis;
  $("#reportTeamName").textContent = report.team.name;
  $("#reportTeamMeta").innerHTML = [
    report.team.season && escapeHtml(report.team.season),
    teamSectionHtml(report.team.section),
    report.team.league && escapeHtml(report.team.league),
    escapeHtml(`${report.eligibility.label} eligibility`)
  ].filter(Boolean).join(" · ");
  $("#eligibleCount").textContent =
    `${report.eligibility.summary.eligible}/${report.eligibility.summary.rosterSize}`;
  $("#eligibilityLabel").textContent = `${report.eligibility.label} eligible`;
  $("#singlesRecord").textContent = formatRecord(report.singles.summary.record);
  $("#doublesRecord").textContent = formatRecord(report.doubles.summary.record);
  $("#repeatPairCount").textContent = report.doubles.summary.repeatedPairs;
  const warnings = report.disclosures.warnings;
  $("#analysisWarnings").hidden = warnings.length === 0;
  $("#analysisWarnings").innerHTML = warnings.length
    ? `<strong>Data notes</strong><ul>${warnings.map(warning =>
      `<li>${escapeHtml(warning)}</li>`
    ).join("")}</ul>`
    : "";
  if (!analysisTabs.has(state.analysisTab)) state.analysisTab = "eligibility";
  renderAnalysisContent();
  updateAnalysisAction();
  showView("analysis");
}

async function requestAnalysis(team, scope, options = {}) {
  const refresh = options.refresh ? "&refresh=true" : "";
  const report = await api(
    `/api/analysis?team=${encodeURIComponent(team.id)}&eligibility=${encodeURIComponent(scope)}${refresh}`
  );
  state.analysis = report;
  state.analysisTeamId = team.id;
  state.analysisScope = scope;
  rememberCompletedAnalysis(team.id, scope);
  return report;
}

async function openCompletedAnalysis(teamId) {
  const team = state.teams.find(item => item.id === teamId);
  if (!team) {
    $("#analysisError").textContent = "This team dataset is not available.";
    return;
  }
  state.selectedTeamId = team.id;
  renderTeamList();
  if (state.analysis && state.analysisTeamId === team.id) {
    renderAnalysis();
    return;
  }
  if (analysisIsStale(team.id)) {
    openAnalysisSetup(team.id);
    return;
  }
  const scope = completedAnalysisScope(team.id);
  if (!scope) {
    openAnalysisSetup(team.id);
    return;
  }
  const button = $("#analyzeCollectedTeam");
  button.disabled = true;
  button.textContent = "Loading analysis…";
  try {
    await requestAnalysis(team, scope);
    renderAnalysis();
  } catch (error) {
    openAnalysisSetup(team.id);
    $("#analysisError").textContent = `Couldn’t load the previous analysis. ${error.message}`;
  } finally {
    button.disabled = false;
    updateAnalysisAction();
  }
}

async function runAnalysis() {
  const team = selectedTeam();
  if (!team) {
    $("#analysisError").textContent = "Choose a gathered team first.";
    return;
  }
  const button = $("#runAnalysis");
  const scope = $("#eligibilityScope").value;
  $("#analysisError").textContent = "";
  button.disabled = true;
  button.textContent = "Running analysis…";
  try {
    await requestAnalysis(team, scope, { refresh: true });
    renderAnalysis();
  } catch (error) {
    $("#analysisError").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Generate analysis";
  }
}

async function rerunRefreshedAnalysis() {
  const team = selectedTeam();
  if (!team) return;
  const scope =
    (state.analysisTeamId === team.id ? state.analysisScope : null) ??
    completedAnalysisScope(team.id);
  if (!scope) {
    openAnalysisSetup(team.id);
    return;
  }
  const buttons = $$("[data-rerun-refreshed-analysis]");
  buttons.forEach(button => {
    button.disabled = true;
    button.textContent = "Running…";
  });
  $("#analysisResultError").textContent = "";
  try {
    await requestAnalysis(team, scope, { refresh: true });
    renderAnalysis();
  } catch (error) {
    openAnalysisSetup(team.id);
    $("#analysisError").textContent = `Couldn’t re-run the analysis. ${error.message}`;
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
      button.textContent = "Re-run analysis";
    });
    updateAnalysisAction();
  }
}

async function rerunAnalysis() {
  const team = selectedTeam();
  if (!team) {
    openAnalysisSetup(state.selectedTeamId);
    return;
  }
  const button = $("#rerunAnalysis");
  const scope =
    (state.analysisTeamId === team.id ? state.analysisScope : null) ??
    completedAnalysisScope(team.id) ??
    "national";
  $("#analysisResultError").textContent = "";
  button.disabled = true;
  button.textContent = "Running…";
  try {
    await requestAnalysis(team, scope, { refresh: true });
    renderAnalysis();
  } catch (error) {
    $("#analysisResultError").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Run again";
  }
}

function loadStoredMatchCards() {
  try {
    state.matchCards = parseStoredMatchCards(
      localStorage.getItem(MATCH_CARDS_STORAGE_KEY)
    );
  } catch (error) {
    state.matchCards = [];
    state.matchCardStorageError =
      `Saved match cards could not be read: ${error.message}`;
  }
}

function persistMatchCards() {
  try {
    localStorage.setItem(
      MATCH_CARDS_STORAGE_KEY,
      JSON.stringify(state.matchCards)
    );
    state.matchCardStorageError = null;
    return true;
  } catch (error) {
    state.matchCardStorageError =
      `Match cards could not be saved locally: ${error.message}`;
    return false;
  }
}

function loadStoredTournamentEvidence() {
  try {
    state.tournamentEvidence = parseStoredTournamentEvidence(
      localStorage.getItem(TOURNAMENT_EVIDENCE_STORAGE_KEY)
    );
    state.tournamentEvidenceError = null;
  } catch (error) {
    state.tournamentEvidence = [];
    state.tournamentEvidenceError =
      `Tournament evidence could not be read: ${error.message}`;
  }
}

function persistTournamentEvidence() {
  try {
    localStorage.setItem(
      TOURNAMENT_EVIDENCE_STORAGE_KEY,
      JSON.stringify(state.tournamentEvidence)
    );
    state.tournamentEvidenceError = null;
    return true;
  } catch (error) {
    state.tournamentEvidenceError =
      `Tournament evidence could not be saved locally: ${error.message}`;
    return false;
  }
}

function matchCardTeam(teamId) {
  return state.teams.find(team => team.id === teamId) ?? null;
}

function matchCardTeamName(teamId) {
  const team = matchCardTeam(teamId);
  return team?.team?.name ?? team?.datasetId ?? "Unavailable team";
}

function matchCardTeamOption(team, selectedId) {
  return `
    <option value="${escapeHtml(team.id)}" ${team.id === selectedId ? "selected" : ""}>
      ${escapeHtml(team.team?.name ?? team.datasetId)}
    </option>`;
}

function matchCardOurTeamOptions(selectedId) {
  const ourTeam = matchCardTeam(state.teamWorkspace.ourTeamId);
  return ourTeam
    ? matchCardTeamOption(ourTeam, selectedId)
    : '<option value="">Assign Our team in Step 1</option>';
}

function matchCardOpponentOptions(selectedId) {
  const scheduledTeams = state.teamWorkspace.scheduledOpponentIds
    .map(matchCardTeam)
    .filter(Boolean);
  return scheduledTeams.length
    ? scheduledTeams.map(team => matchCardTeamOption(team, selectedId)).join("")
    : '<option value="">Add a scheduled opponent in Step 1</option>';
}

function matchCardCollectionOptions(selectedId) {
  return [
    '<option value="">Choose a tournament</option>',
    ...state.teamCollections.map(collection => `
      <option value="${escapeHtml(collection.id)}" ${collection.id === selectedId ? "selected" : ""}>
        ${escapeHtml(collection.name)}
      </option>`)
  ].join("");
}

function matchScheduleDateLabel(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function roundRobinScheduleHtml(matches) {
  if (!matches.length) return "";
  return `
    <section class="round-robin-schedule" aria-labelledby="roundRobinScheduleHeading">
      <div class="round-robin-schedule-heading">
        <div>
          <span class="step-label">Official round robin</span>
          <h2 id="roundRobinScheduleHeading">PNW match schedule</h2>
        </div>
        <span>${matches.length} matches</span>
      </div>
      <div class="round-robin-match-grid">
        ${matches.map((match, index) => `
          <article class="round-robin-match">
            <span class="round-robin-number">Match ${index + 1}</span>
            <div class="round-robin-time">
              <strong>${escapeHtml(matchScheduleDateLabel(match.date))}</strong>
              <span>${escapeHtml(match.time)}</span>
            </div>
            <div class="round-robin-opponent">
              <span>vs</span>
              <strong>${escapeHtml(matchCardTeamName(match.opponentTeamId))}</strong>
              <small>${escapeHtml(match.site)}</small>
            </div>
            <button class="button-secondary compact" type="button"
              data-card-action="plan-scheduled-match"
              data-opponent-team-id="${escapeHtml(match.opponentTeamId)}"
              data-match-date="${escapeHtml(match.date)}">
              Plan matchup
            </button>
          </article>
        `).join("")}
      </div>
    </section>`;
}

function newMatchCardId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return [...values].map(value => value.toString(16).padStart(8, "0")).join("-");
}

function matchCardListHtml() {
  const visibleCards = state.matchCards.filter(card =>
    state.activeCollectionId &&
    (
      card.collectionId === state.activeCollectionId ||
      (!card.collectionId && matchCardTeam(card.ourTeamId) &&
        teamCollectionId(matchCardTeam(card.ourTeamId)) === state.activeCollectionId)
    )
  );
  if (!visibleCards.length) {
    return `
      <div class="match-card-empty">
        <strong>No Match Day Cards yet</strong>
        <span>Create the first card for this tournament after choosing an opponent.</span>
      </div>`;
  }
  const groups = new Map();
  for (const card of [...visibleCards].sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? "") ||
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
  )) {
    const cards = groups.get(card.ourTeamId) ?? [];
    cards.push(card);
    groups.set(card.ourTeamId, cards);
  }
  return [...groups.entries()].map(([teamId, cards]) => `
    <section class="match-card-group">
      <div class="match-card-group-heading">
        <span>Team</span>
        <h3>${escapeHtml(matchCardTeamName(teamId))}</h3>
      </div>
      <div class="saved-card-grid">
        ${cards.map(card => `
          <button type="button" class="saved-match-card" data-card-action="open" data-card-id="${escapeHtml(card.id)}">
            <span class="saved-card-status ${card.status === "final" ? "final" : ""}">${escapeHtml(card.status ?? "draft")}</span>
            <span class="saved-card-main">
              <strong>${escapeHtml(card.title)}</strong>
              <small>vs ${escapeHtml(matchCardTeamName(card.opponentTeamId))}</small>
            </span>
            <span class="saved-card-meta">
              <span>${escapeHtml(card.date ?? "Date not set")}</span>
              <span>${escapeHtml(card.location ?? "home")}</span>
              <span>${escapeHtml(eligibilityScopeLabels[card.eligibilityScope] ?? "National")}</span>
            </span>
            <span class="saved-card-open" aria-hidden="true">Open →</span>
          </button>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function renderMatchCardsHome() {
  state.activeMatchCardId = null;
  state.matchCardContext = null;
  const hasActiveCollection = Boolean(state.activeCollectionId);
  const defaultOurTeam = hasActiveCollection
    ? matchCardTeam(state.teamWorkspace.ourTeamId)?.id ?? ""
    : "";
  const scheduledTeams = hasActiveCollection
    ? state.teamWorkspace.scheduledOpponentIds.map(matchCardTeam).filter(Boolean)
    : [];
  const collection = state.teamCollections.find(
    item => item.id === state.activeCollectionId
  );
  const roundRobinMatches = hasActiveCollection
    ? collectionMatchSchedule(collection, state.teams)
    : [];
  const scoutingCandidates = hasActiveCollection
    ? activeCollectionTeams().filter(team =>
      team.id !== defaultOurTeam &&
      !state.teamWorkspace.scheduledOpponentIds.includes(team.id)
    )
    : [];
  const defaultOpponent = scheduledTeams.some(
    team => team.id === state.matchCardPrefillOpponentId
  )
    ? state.matchCardPrefillOpponentId
    : scheduledTeams[0]?.id ?? "";
  const canCreateCard = Boolean(defaultOurTeam && defaultOpponent);
  const defaultEligibilityScope =
    completedAnalysisScope(defaultOurTeam) ?? "national";
  const today = new Date().toISOString().slice(0, 10);
  $("#matchCardsWorkspace").innerHTML = `
    <div class="match-cards-topbar">
      <div>
        <p class="eyebrow">Step 3 · Match day planning <span class="feature-status">Work in progress</span></p>
        <h1 class="view-heading" tabindex="-1">Match Day Cards</h1>
        <p>Draft our lineup against a scouted opponent, compare every court, and print a shareable card.</p>
      </div>
    </div>
    ${state.matchCardStorageError
      ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardStorageError)}</p>`
      : ""}
    ${state.teamWorkspaceStorageError
      ? `<p class="match-card-alert" role="alert">${escapeHtml(state.teamWorkspaceStorageError)}</p>`
      : ""}
    <section class="match-readiness" aria-label="Match preparation readiness">
      <div>
        <span class="step-label">Workspace readiness</span>
        <h2>${!hasActiveCollection
          ? "Choose an event collection"
          : canCreateCard ? "Ready to build a matchup" : "Complete the scouting setup"}</h2>
      </div>
      <div class="match-readiness-items">
        <article class="${defaultOurTeam ? "ready" : ""}">
          <span>${defaultOurTeam ? "✓" : "1"}</span>
          <div><strong>Our team</strong><small>${defaultOurTeam
            ? escapeHtml(matchCardTeamName(defaultOurTeam))
            : "Gather or assign the team you are preparing."}</small></div>
        </article>
        <article class="${scheduledTeams.length ? "ready" : ""}">
          <span>${scheduledTeams.length ? "✓" : "2"}</span>
          <div><strong>Scheduled opponents</strong><small>${scheduledTeams.length} of ${TEAM_WORKSPACE_SCHEDULE_LIMIT} added</small></div>
        </article>
      </div>
      ${!hasActiveCollection
        ? '<button class="button-secondary compact" type="button" data-card-action="choose-collection">Choose collection</button>'
        : !defaultOurTeam
        ? activeCollectionTeams().length
          ? '<button class="button-secondary compact" type="button" data-card-action="choose-our-team">Assign Our team</button>'
          : '<button class="button-secondary compact" type="button" data-card-action="scout-our-team">Scout Our team</button>'
        : !scheduledTeams.length
          ? scoutingCandidates.length
            ? '<button class="button-secondary compact" type="button" data-card-action="choose-opponent">Add a scheduled opponent</button>'
            : '<button class="button-secondary compact" type="button" data-card-action="scout-opponent">Scout an opponent</button>'
          : ""}
    </section>
    ${roundRobinScheduleHtml(roundRobinMatches)}
    <div class="match-card-create-panel">
      <div>
        <span class="step-label">Start here</span>
        <h2>Choose the matchup</h2>
        <p>Select the tournament first, then the scheduled opponent you are preparing for.</p>
      </div>
      <form id="matchCardCreateForm" class="match-card-create-form">
        <label>Tournament
          <select name="collectionId" data-match-collection required>
            ${matchCardCollectionOptions(state.activeCollectionId)}
          </select>
        </label>
        <label>Opponent
         <select name="opponentTeamId" required>${matchCardOpponentOptions(defaultOpponent)}</select>
        </label>
        <input name="ourTeamId" type="hidden" value="${escapeHtml(defaultOurTeam)}">
        <label>Match date
          <input name="date" type="date" required value="${today}">
        </label>
        <label>Location
          <select name="location">
            <option value="home">Home</option>
            <option value="away">Away</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
        <label>Eligibility target
          <select name="eligibilityScope">
            ${Object.entries(eligibilityScopeLabels).map(([scope, label]) => `
              <option value="${scope}" ${scope === defaultEligibilityScope ? "selected" : ""}>${label}</option>
            `).join("")}
          </select>
        </label>
        <label class="match-card-title-field">Card name
          <input name="title" maxlength="80" placeholder="e.g. Nationals semifinal">
        </label>
        <button class="button-primary compact" type="submit" ${canCreateCard ? "" : "disabled"}>Plan this match</button>
      </form>
      <p class="form-error" id="matchCardCreateError" role="alert"></p>
    </div>
    <div class="saved-cards">
      <div class="saved-cards-heading">
        <span class="step-label">Saved locally</span>
        <h2>Upcoming Match Day Cards</h2>
      </div>
      ${matchCardListHtml()}
    </div>`;
}

function evidenceForCard(card) {
  return state.tournamentEvidence.filter(item =>
    item.collectionId === card.collectionId &&
    item.opponentTeamId === card.opponentTeamId
  );
}

function matchCardPredictions(card, context) {
  const activeRoster = activeNationalRoster(context.opponentData);
  return buildOnsitePredictions(
    context.opponentAnalysis.lineupPredictions?.predictions ?? [],
    evidenceForCard(card)
  ).map(prediction => ({
    ...prediction,
    lines: prediction.lines.map(line => ({
      ...line,
      players: line.players.flatMap(name => {
        const activePlayer = activeRoster.find(player =>
          player.name.localeCompare(name, undefined, {
            sensitivity: "base"
          }) === 0
        );
        return activePlayer ? [activePlayer.name] : [];
      })
    }))
  }));
}

function opponentPrediction(card, context, rank) {
  return matchCardPredictions(card, context)
    ?.find(prediction => prediction.rank === rank) ??
    matchCardPredictions(card, context)?.[0] ??
    null;
}

function predictionLine(prediction, court) {
  return prediction?.lines?.find(line => line.court === court) ?? {
    court,
    players: []
  };
}

function selectedDraftPlayers(card, exceptCourt, exceptIndex) {
  return new Set(MATCH_CARD_COURTS.flatMap(({ court }) =>
    (card.draft[court] ?? []).filter((name, index) =>
      name && !(court === exceptCourt && index === exceptIndex)
    )
  ));
}

function playerOptionLabel(player, discipline, eligible) {
  const utr = ratingDisplay(player.utr?.[discipline]);
  const dr = Number.isFinite(player.dr) ? Number(player.dr).toFixed(2) : "NR";
  return `${player.name} · DR ${dr} · UTR ${utr}${eligible ? "" : " · eligibility warning"}`;
}

function lineupSelectHtml(card, context, court, index, eligibleNames) {
  const discipline = court.startsWith("S") ? "singles" : "doubles";
  const selected = card.draft[court]?.[index] ?? "";
  const selectedElsewhere = selectedDraftPlayers(card, court, index);
  const roster = [...activeNationalRoster(context.ourData)].sort((a, b) =>
    Number(eligibleNames.has(b.name)) - Number(eligibleNames.has(a.name)) ||
    (b.dr ?? -Infinity) - (a.dr ?? -Infinity) ||
    a.name.localeCompare(b.name)
  );
  const selectedMissingFromRoster = selected &&
    !roster.some(player => player.name === selected);
  return `
    <select class="lineup-player-select" data-court="${court}" data-player-index="${index}" aria-label="${court} player ${index + 1}">
      <option value="">Choose player</option>
      ${selectedMissingFromRoster
        ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} · no longer on gathered roster</option>`
        : ""}
      ${roster.map(player => `
        <option value="${escapeHtml(player.name)}"
          ${player.name === selected ? "selected" : ""}
          ${selectedElsewhere.has(player.name) ? "disabled" : ""}>
          ${escapeHtml(playerOptionLabel(player, discipline, eligibleNames.has(player.name)))}
        </option>
      `).join("")}
    </select>`;
}

function metricDisplay(value, digits) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "NR";
}

function marginDisplay(value, digits) {
  if (!Number.isFinite(value)) return "No comparison";
  const formatted = Math.abs(value).toFixed(digits);
  if (Math.abs(value) < 0.00001) return "Even";
  return `${value > 0 ? "Our +" : "Opp +"}${formatted}`;
}

function matchCardComparisons(card, context) {
  const prediction = opponentPrediction(card, context, card.opponentPredictionRank);
  return MATCH_CARD_COURTS.map(({ court }) => {
    const opponent = predictionLine(prediction, court);
    return compareCourtLine({
      court,
      ourPlayers: (card.draft[court] ?? []).filter(Boolean),
      opponentPlayers: opponent.players,
      ourRoster: activeNationalRoster(context.ourData),
      opponentRoster: activeNationalRoster(context.opponentData)
    });
  });
}

function evidencePlayerOptions(roster, selected = "") {
  return [
    '<option value="">Not assigned</option>',
    ...roster.map(player => `
      <option value="${escapeHtml(player.name)}" ${player.name === selected ? "selected" : ""}>
        ${escapeHtml(player.name)}
      </option>`)
  ].join("");
}

function pendingEvidenceReviewHtml(card, context) {
  const pending = state.pendingTournamentEvidence;
  if (!pending || pending.cardId !== card.id) return "";
  const detected = new Set(pending.observedPlayers);
  return `
    <form id="tournamentEvidenceReviewForm" class="evidence-review">
      <div class="evidence-review-preview">
        <img src="${pending.imageDataUrl}" alt="Uploaded tournament result screenshot">
        <div>
          <strong>${escapeHtml(pending.sourceName)}</strong>
          <small>OCR confidence ${pending.ocrConfidence ?? "unavailable"}% · review every field before saving</small>
          <label>Match date
            <input name="matchDate" type="date" value="${escapeHtml(pending.matchDate)}">
          </label>
        </div>
      </div>
      <fieldset>
        <legend>Players observed onsite</legend>
        <p>Checked players were found in the screenshot. Add or remove players to correct the extraction.</p>
        <div class="evidence-player-checks">
          ${activeNationalRoster(context.opponentData).map(player => `
            <label>
              <input type="checkbox" name="observedPlayers" value="${escapeHtml(player.name)}" ${detected.has(player.name) ? "checked" : ""}>
              <span>${escapeHtml(player.name)}</span>
            </label>
          `).join("")}
        </div>
      </fieldset>
      <fieldset>
        <legend>Extracted opponent lineup</legend>
        <p>Assign only courts visible in this result. A complete lineup becomes the newest opponent scenario.</p>
        <div class="evidence-lineup-grid">
          ${MATCH_CARD_COURTS.map(({ court, players }) => `
            <div>
              <strong>${court}</strong>
              ${Array.from({ length: players }, (_, index) => `
                <select name="${court}-${index}" aria-label="${court} player ${index + 1}">
                  ${evidencePlayerOptions(
                    activeNationalRoster(context.opponentData),
                    pending.lines[court]?.[index]
                  )}
                </select>
              `).join("")}
            </div>
          `).join("")}
        </div>
      </fieldset>
      <p class="form-error" id="tournamentEvidenceError" role="alert"></p>
      <div class="evidence-review-actions">
        <button class="button-secondary compact" type="button" data-card-action="cancel-evidence">Cancel</button>
        <button class="button-primary compact" type="submit">Accept tournament evidence</button>
      </div>
    </form>`;
}

function tournamentEvidenceHtml(card, context) {
  const evidence = evidenceForCard(card);
  const onsiteNames = confirmedOnsitePlayers(
    state.tournamentEvidence,
    card.collectionId,
    card.opponentTeamId
  );
  const roster = [...activeNationalRoster(context.opponentData)].sort((a, b) =>
    Number(onsiteNames.has(b.name)) - Number(onsiteNames.has(a.name)) ||
    a.name.localeCompare(b.name)
  );
  return `
    <section class="tournament-evidence no-print">
      <div class="match-card-section-heading">
        <div>
          <span class="step-label">Tournament evidence</span>
          <h2>Who is onsite?</h2>
        </div>
        <label class="button-secondary compact evidence-upload">
          <input type="file" data-result-screenshot accept="image/png,image/jpeg,image/webp">
          Add result screenshot
        </label>
      </div>
      <p class="evidence-intro">
        Result screenshots confirm onsite players and reveal recent lineup patterns.
        Planning stays available even without evidence.
      </p>
      ${state.tournamentEvidenceError
        ? `<p class="match-card-alert" role="alert">${escapeHtml(state.tournamentEvidenceError)}</p>`
        : ""}
      <p class="form-error" id="resultScreenshotError" role="alert"></p>
      ${pendingEvidenceReviewHtml(card, context)}
      <div class="active-roster-summary">
        <div>
          <strong>${onsiteNames.size}</strong>
          <span>confirmed onsite</span>
        </div>
        <p>${evidence.length
          ? `Based on ${evidence.length} reviewed result screenshot${evidence.length === 1 ? "" : "s"}.`
          : "No tournament results added yet. Historical predictions remain available."}</p>
      </div>
      <div class="active-roster-grid">
        ${roster.map(player => `
          <article class="${onsiteNames.has(player.name) ? "onsite" : ""}">
            <span aria-hidden="true">${onsiteNames.has(player.name) ? "✓" : "—"}</span>
            <div>
              <strong>${escapeHtml(player.name)}</strong>
              <small>${onsiteNames.has(player.name) ? "Confirmed onsite" : "Not yet observed"}</small>
            </div>
          </article>
        `).join("")}
      </div>
      ${evidence.length ? `
        <div class="evidence-history">
          <h3>Reviewed results</h3>
          ${evidence.map(item => `
            <article>
              <img src="${item.imageDataUrl}" alt="">
              <div>
                <strong>${escapeHtml(item.sourceName)}</strong>
                <small>${escapeHtml(item.matchDate || "Date not provided")} · ${item.observedPlayers.length} players observed</small>
              </div>
              <button type="button" data-card-action="delete-evidence" data-evidence-id="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.sourceName)}">Remove</button>
            </article>
          `).join("")}
        </div>` : ""}
    </section>`;
}

function matchCardCourtHtml(comparison) {
  const disciplineLabel = comparison.discipline === "singles"
    ? "Singles UTR"
    : "Doubles UTR";
  return `
    <article class="matchup-court ${comparison.edge}">
      <header>
        <strong>${escapeHtml(comparison.court)}</strong>
        <span>${escapeHtml(comparison.edge)} · ${escapeHtml(comparison.confidence)} confidence</span>
      </header>
      <div class="matchup-sides">
        <div>
          <span>Our lineup</span>
          <strong>${comparison.ourPlayers.map(escapeHtml).join(" + ") || "Not selected"}</strong>
          <small>DR ${metricDisplay(comparison.ours.dr, 2)} · ${disciplineLabel} ${metricDisplay(comparison.ours.utr, 2)}</small>
        </div>
        <div>
          <span>Opponent prediction</span>
          <strong>${comparison.opponentPlayers.map(escapeHtml).join(" + ") || "Unavailable"}</strong>
          <small>DR ${metricDisplay(comparison.opponent.dr, 2)} · ${disciplineLabel} ${metricDisplay(comparison.opponent.utr, 2)}</small>
        </div>
      </div>
      <footer>
        <span>DR: ${marginDisplay(comparison.margins.dr, 2)}</span>
        <span>${disciplineLabel}: ${marginDisplay(comparison.margins.utr, 2)}</span>
      </footer>
    </article>`;
}

function renderMatchCardEditor() {
  const card = state.matchCards.find(item => item.id === state.activeMatchCardId);
  const context = state.matchCardContext;
  if (!card) {
    renderMatchCardsHome();
    return;
  }
  if (!context || context.cardId !== card.id) {
    $("#matchCardsWorkspace").innerHTML = `
      <div class="match-card-loading">
        <p class="eyebrow">Loading Step 3</p>
        <h1 class="view-heading" tabindex="-1">Building the Match Day Card…</h1>
        <p>Loading both rosters, eligibility, and opponent predictions.</p>
      </div>`;
    return;
  }
  const predictions = matchCardPredictions(card, context);
  const prediction = opponentPrediction(card, context, card.opponentPredictionRank);
  const eligibleNames = new Set(
    context.ourAnalysis.eligibility.players
      .filter(player => player.status === "eligible")
      .map(player => player.name)
  );
  const validation = validateDraft(card.draft, eligibleNames);
  const comparisons = matchCardComparisons(card, context);
  const summary = summarizeMatchup(comparisons);
  const ourTeamName = context.ourData.team.name;
  const opponentName = context.opponentData.team.name;
  const eligibilityLabel =
    eligibilityScopeLabels[card.eligibilityScope] ?? "National";
  const collectionName = state.teamCollections.find(
    collection => collection.id === card.collectionId
  )?.name ?? "Tournament";
  $("#matchCardsWorkspace").innerHTML = `
    <div class="match-card-editor">
      <div class="match-card-editor-topbar no-print">
        <button class="button-secondary compact" type="button" data-card-action="back">← All cards</button>
        <div>
          <button class="button-primary compact" type="button" data-card-action="print">Print / Save PDF</button>
          <details class="match-card-more-menu">
            <summary class="button-secondary compact">More</summary>
            <div>
              <button type="button" data-card-action="clone">Duplicate card</button>
              <button class="danger" type="button" data-card-action="delete">Delete card</button>
            </div>
          </details>
        </div>
      </div>
      <header class="match-card-title">
        <div>
          <p class="eyebrow">Step 3 · Match Day Card</p>
          <h1 class="view-heading" tabindex="-1">${escapeHtml(card.title)}</h1>
          <div class="match-card-meta" aria-label="Match details">
            <span>${escapeHtml(card.date)}</span>
            <span>${escapeHtml(card.location)}</span>
            <span>${escapeHtml(collectionName)}</span>
            <span>${escapeHtml(eligibilityLabel)} eligibility</span>
            <span>${escapeHtml(ourTeamName)} vs ${escapeHtml(opponentName)}</span>
          </div>
          <p class="match-card-save-note no-print">Saved automatically on this device</p>
        </div>
        <label class="card-status no-print">Card status
          <select data-card-field="status">
            <option value="draft" ${card.status === "draft" ? "selected" : ""}>Draft</option>
            <option value="final" ${card.status === "final" ? "selected" : ""}>Final</option>
          </select>
        </label>
        <label class="card-status no-print">Eligibility target
          <select data-card-field="eligibility">
            ${Object.entries(eligibilityScopeLabels).map(([scope, label]) => `
              <option value="${scope}" ${card.eligibilityScope === scope ? "selected" : ""}>${label}</option>
            `).join("")}
          </select>
        </label>
        <span class="print-status">${escapeHtml(card.status)}</span>
      </header>
      ${state.matchCardStorageError
        ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardStorageError)}</p>`
        : ""}
      ${state.matchCardError
        ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardError)}</p>`
        : ""}
      ${tournamentEvidenceHtml(card, context)}
      <section class="opponent-prediction-picker no-print">
        <div>
          <span class="step-label">Opponent</span>
          <h2>Onsite-informed lineup</h2>
          <p>${evidenceForCard(card).length
            ? "Recent tournament evidence is weighted ahead of older scouting history."
            : "No onsite evidence yet; scenarios use scouting history only."}</p>
        </div>
        <label class="prediction-select">Opponent scenario
          <select data-card-field="prediction">
            ${predictions.map(item => `
              <option value="${item.rank}" ${item.rank === card.opponentPredictionRank ? "selected" : ""}>
                ${item.source === "tournament" ? "Latest tournament lineup" : `Historical option ${item.historicalRank}`}
                · ${item.onsiteConfirmed}/${item.onsiteTotal} confirmed onsite
              </option>
            `).join("")}
          </select>
        </label>
      </section>
      <section class="our-lineup-builder">
        <div class="match-card-section-heading">
          <div><span class="step-label">Team</span><h2>Set the lineup</h2></div>
          <p>${validation.selectedPlayers}/${validation.requiredPlayers} players selected · ${validation.unavailableNames.length
            ? `${validation.unavailableNames.length} eligibility warning${validation.unavailableNames.length === 1 ? "" : "s"}`
            : `${escapeHtml(eligibilityLabel)} eligible roster`}</p>
        </div>
        <div class="lineup-builder-grid">
          ${MATCH_CARD_COURTS.map(({ court, players }) => `
            <article>
              <strong>${court}</strong>
              <div>${Array.from({ length: players }, (_, index) =>
                lineupSelectHtml(card, context, court, index, eligibleNames)
              ).join("")}</div>
            </article>
          `).join("")}
        </div>
        ${validation.unavailableNames.length
          ? `<p class="lineup-eligibility-warning"><strong>Eligibility warning:</strong> ${validation.unavailableNames.map(escapeHtml).join(", ")} ${validation.unavailableNames.length === 1 ? "is" : "are"} not eligible for the selected ${escapeHtml(eligibilityLabel)} target.</p>`
          : ""}
      </section>
      <section class="matchup-analysis">
        <div class="match-card-section-heading">
          <div><span class="step-label">Matchup</span><h2>At a glance</h2></div>
        </div>
        <div class="matchup-overview">
          <strong>${escapeHtml(summary.read)}</strong>
          <div>
            <span><b>${summary.favorable}</b> favorable</span>
            <span><b>${summary.swing}</b> swing</span>
            <span><b>${summary.challenging}</b> challenging</span>
            <span><b>${summary.limited}</b> limited data</span>
          </div>
        </div>
        <details class="matchup-details">
          <summary>
            <span>View court-by-court analysis</span>
            <small>DR and UTR comparisons</small>
          </summary>
          <div class="matchup-courts">${comparisons.map(matchCardCourtHtml).join("")}</div>
        </details>
      </section>
      <footer class="match-card-footnote">
        Opponent projection #${prediction?.rank ?? "—"} · ${prediction?.source === "tournament"
          ? `reviewed tournament result from ${escapeHtml(prediction.evidenceDate || "an unknown date")}`
          : `${prediction?.onsiteConfirmed ?? 0}/${prediction?.onsiteTotal ?? 0} players confirmed onsite; weighted with Step 1 scouting history`}.
        This card is a planning aid, not a prediction of final match results.
      </footer>
    </div>`;
}

async function loadMatchCardContext(card) {
  const eligibilityScope = analysisScopes.has(card.eligibilityScope)
    ? card.eligibilityScope
    : "national";
  const [ourData, opponentData, ourAnalysis, opponentAnalysis] = await Promise.all([
    api(`/api/team-data?team=${encodeURIComponent(card.ourTeamId)}`),
    api(`/api/team-data?team=${encodeURIComponent(card.opponentTeamId)}`),
    api(`/api/analysis?team=${encodeURIComponent(card.ourTeamId)}&eligibility=${eligibilityScope}`),
    api(`/api/analysis?team=${encodeURIComponent(card.opponentTeamId)}&eligibility=${eligibilityScope}`)
  ]);
  return {
    cardId: card.id,
    ourData,
    opponentData,
    ourAnalysis,
    opponentAnalysis
  };
}

async function openMatchCard(cardId) {
  const card = state.matchCards.find(item => item.id === cardId);
  if (!card) {
    state.matchCardError = "This saved Match Day Card is no longer available.";
    renderMatchCardsHome();
    return;
  }
  if (!card.collectionId) {
    const ourTeam = matchCardTeam(card.ourTeamId);
    card.collectionId = (ourTeam ? teamCollectionId(ourTeam) : null) ||
      state.activeCollectionId;
    if (card.collectionId) persistMatchCards();
  }
  state.activeMatchCardId = card.id;
  state.matchCardContext = null;
  state.matchCardError = "";
  renderMatchCardEditor();
  showView("matchCards");
  try {
    state.matchCardContext = await loadMatchCardContext(card);
    let cardChanged = false;
    const predictions = matchCardPredictions(card, state.matchCardContext);
    if (
      predictions.length &&
      !predictions.some(item => item.rank === card.opponentPredictionRank)
    ) {
      card.opponentPredictionRank = predictions[0].rank;
      cardChanged = true;
    }
    if (!card.draftInitialized) {
      const ourPrediction =
        state.matchCardContext.ourAnalysis.lineupPredictions?.predictions?.[0];
      if (ourPrediction && validateDraft(card.draft).selectedPlayers === 0) {
        card.draft = draftFromPrediction(ourPrediction);
      }
      card.draftInitialized = true;
      cardChanged = true;
    }
    if (cardChanged) {
      card.updatedAt = new Date().toISOString();
      persistMatchCards();
    }
    renderMatchCardEditor();
    requestAnimationFrame(() => {
      $(".match-card-title .view-heading")?.focus({ preventScroll: true });
    });
  } catch (error) {
    state.matchCardError = `Couldn’t build this Match Day Card. ${error.message}`;
    $("#matchCardsWorkspace").innerHTML = `
      <div class="match-card-loading">
        <p class="eyebrow">Step 3 needs attention</p>
        <h1 class="view-heading" tabindex="-1">Couldn’t load this card.</h1>
        <p class="match-card-alert" role="alert">${escapeHtml(state.matchCardError)}</p>
        <button class="button-secondary" type="button" data-card-action="back">Return to Match Day Cards</button>
      </div>`;
  }
}

function openMatchCardsWorkspace(opponentId = null) {
  state.matchCardPrefillOpponentId =
    typeof opponentId === "string" ? opponentId : null;
  renderMatchCardsHome();
  showView("matchCards");
}

async function createMatchCardFromForm(form) {
  const values = new FormData(form);
  const collectionId = values.get("collectionId");
  const ourTeamId = values.get("ourTeamId");
  const opponentTeamId = values.get("opponentTeamId");
  if (!collectionId || !ourTeamId || !opponentTeamId) {
    $("#matchCardCreateError").textContent =
      "Choose a tournament with Our team and a scheduled opponent.";
    return;
  }
  if (ourTeamId === opponentTeamId) {
    $("#matchCardCreateError").textContent = "Team and opponent must be different.";
    return;
  }
  const card = createMatchCard({
    id: newMatchCardId(),
    title: values.get("title"),
    date: values.get("date"),
    location: values.get("location"),
    collectionId,
    ourTeamId,
    opponentTeamId,
    eligibilityScope: values.get("eligibilityScope")
  });
  state.matchCards.push(card);
  if (!persistMatchCards()) {
    state.matchCards = state.matchCards.filter(item => item.id !== card.id);
    renderMatchCardsHome();
    return;
  }
  await openMatchCard(card.id);
}

function prepareResultScreenshot(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Upload a PNG, JPEG, or WebP screenshot.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a screenshot smaller than 10 MB.");
  }
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The screenshot could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("The screenshot is not a readable image."));
      image.onload = () => {
        const resize = (maxDimension, quality) => {
          const scale = Math.min(
            1,
            maxDimension / Math.max(image.naturalWidth, image.naturalHeight)
          );
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext("2d").drawImage(
            image,
            0,
            0,
            canvas.width,
            canvas.height
          );
          return canvas.toDataURL("image/jpeg", quality);
        };
        resolvePromise({
          ocrDataUrl: resize(1800, 0.88),
          previewDataUrl: resize(480, 0.72)
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function reviewResultScreenshot(file) {
  const card = state.matchCards.find(item => item.id === state.activeMatchCardId);
  const context = state.matchCardContext;
  if (!card || !context) return;
  const input = $("[data-result-screenshot]");
  const errorElement = $("#resultScreenshotError");
  input.disabled = true;
  errorElement.textContent = "Reading the screenshot locally…";
  try {
    const { ocrDataUrl, previewDataUrl } = await prepareResultScreenshot(file);
    const ocr = await api("/api/result-ocr", {
      method: "POST",
      body: JSON.stringify({ imageDataUrl: ocrDataUrl })
    });
    const rosterNames = activeNationalRoster(context.opponentData)
      .map(player => player.name);
    state.pendingTournamentEvidence = {
      cardId: card.id,
      sourceName: file.name,
      imageDataUrl: previewDataUrl,
      ocrConfidence: ocr.confidence,
      observedPlayers: matchRosterNames(ocr.text, rosterNames),
      lines: extractLineupFromText(ocr.text, rosterNames),
      matchDate: card.date
    };
    renderMatchCardEditor();
    requestAnimationFrame(() => {
      $("#tournamentEvidenceReviewForm input")?.focus({ preventScroll: true });
    });
  } catch (error) {
    errorElement.textContent = error.message;
    input.disabled = false;
  }
}

function acceptTournamentEvidence(form) {
  const card = state.matchCards.find(item => item.id === state.activeMatchCardId);
  const pending = state.pendingTournamentEvidence;
  if (!card || !pending || pending.cardId !== card.id) return;
  if (!card.collectionId) {
    $("#tournamentEvidenceError").textContent =
      "Return to Match Day Cards and choose this card’s tournament before saving evidence.";
    return;
  }
  const values = new FormData(form);
  const observedPlayers = values.getAll("observedPlayers");
  const lines = Object.fromEntries(MATCH_CARD_COURTS.map(({ court, players }) => [
    court,
    Array.from({ length: players }, (_, index) =>
      values.get(`${court}-${index}`) ?? ""
    )
  ]));
  if (!observedPlayers.length && !validateDraft(lines).selectedPlayers) {
    $("#tournamentEvidenceError").textContent =
      "Confirm at least one observed player before accepting this result.";
    return;
  }
  const evidence = createTournamentEvidence({
    id: newMatchCardId(),
    collectionId: card.collectionId,
    opponentTeamId: card.opponentTeamId,
    sourceName: pending.sourceName,
    imageDataUrl: pending.imageDataUrl,
    matchDate: values.get("matchDate"),
    observedPlayers,
    lines,
    extractionMethod: "browser-ocr"
  });
  state.tournamentEvidence.push(evidence);
  if (!persistTournamentEvidence()) {
    state.tournamentEvidence = state.tournamentEvidence.filter(
      item => item.id !== evidence.id
    );
    renderMatchCardEditor();
    return;
  }
  state.pendingTournamentEvidence = null;
  card.opponentPredictionRank = 1;
  card.updatedAt = new Date().toISOString();
  persistMatchCards();
  renderMatchCardEditor();
}

function updateActiveMatchCard(update, focusSelector = null) {
  const card = state.matchCards.find(item => item.id === state.activeMatchCardId);
  if (!card) return;
  update(card);
  card.updatedAt = new Date().toISOString();
  persistMatchCards();
  renderMatchCardEditor();
  if (focusSelector) {
    requestAnimationFrame(() => {
      $(focusSelector)?.focus({ preventScroll: true });
    });
  }
}

function runWorkspaceAction(action) {
  const teamId = state.selectedTeamId;
  if (action === "scout-opponent") {
    reset();
    return;
  }
  if (action === "set-our-team" && teamId) {
    updateWorkspaceRole(teamId, "our");
    return;
  }
  if (action === "add-to-schedule" && teamId) {
    updateWorkspaceRole(teamId, "scheduled");
    return;
  }
  if (action === "build-matchup" && teamId) {
    openMatchCardsWorkspace(teamId);
  }
}

function reset() {
  localStorage.removeItem("courtScoutJob");
  localStorage.removeItem(PENDING_SCOUT_COLLECTION_STORAGE_KEY);
  state.jobId = null;
  state.jobKind = null;
  state.dataset = null;
  $("#formError").textContent = "";
  $("#tryAgain").hidden = true;
  $(".progress-copy .eyebrow").textContent = "Collection in progress";
  $(".progress-copy h1").textContent = "Building your scouting dataset.";
  $("#gatherEventCollection").value = "";
  $("#scoutCollectionContext").hidden = true;
  delete $("#scoutCollectionContext").dataset.collectionTarget;
  showView("intake");
}

function scoutTeamForCollection(collectionTarget) {
  reset();
  const isTempCollection = collectionTarget === TEMP_REPORTS_COLLECTION_ID;
  const collectionId = isTempCollection ? null : collectionTarget;
  const collection = state.teamCollections.find(item => item.id === collectionId);
  const context = $("#scoutCollectionContext");
  $("#gatherEventCollection").value = collectionId ?? "";
  context.dataset.collectionTarget = collectionTarget;
  context.textContent = isTempCollection
    ? "This team will stay in Temp collection until it is assigned."
    : `This team will be added to ${collection?.name ?? "the selected collection"}.`;
  context.hidden = false;
  requestAnimationFrame(() => $("#teamUrl").focus({ preventScroll: true }));
}

function scoutTeamForActiveCollection() {
  scoutTeamForCollection(
    state.activeCollectionId ?? TEMP_REPORTS_COLLECTION_ID
  );
}

$("#tryAgain").addEventListener("click", () => {
  if (state.jobKind === "refresh" && state.selectedTeamId) {
    localStorage.removeItem("courtScoutJob");
    state.jobId = null;
    state.jobKind = null;
    $("#tryAgain").hidden = true;
    if (state.dataset) renderDataset(state.dataset);
    else void openTeamData(state.selectedTeamId);
    return;
  }
  const collectionTarget = localStorage.getItem(
    PENDING_SCOUT_COLLECTION_STORAGE_KEY
  );
  if (collectionTarget) {
    scoutTeamForCollection(collectionTarget);
  } else {
    reset();
  }
});
$("#newCollection").addEventListener("click", () => reset());
$("#gatherTeam").addEventListener("click", () => reset());
$("#landingViewTeams").addEventListener("click", () => {
  showReportsHome();
});
$("#closeTeamSidebar").addEventListener("click", () => {
  document.body.classList.remove("intake-teams-open");
  $("#landingViewTeams").focus();
});
$("#intakeView").addEventListener("click", event => {
  if (!event.target.closest("#landingViewTeams")) {
    document.body.classList.remove("intake-teams-open");
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.body.classList.contains("intake-teams-open")) {
    document.body.classList.remove("intake-teams-open");
    $("#landingViewTeams").focus();
  }
});
$("#teamList").addEventListener("click", event => {
  const button = event.target.closest("[data-team-id]");
  if (button) {
    document.body.classList.remove("intake-teams-open");
    void openTeamData(button.dataset.teamId);
  }
});
$("#reportsTeamList").addEventListener("click", event => {
  if (event.target.closest("[data-scout-collection-team]")) {
    scoutTeamForActiveCollection();
    return;
  }
  const prepareButton = event.target.closest("[data-prepare-match-id]");
  if (prepareButton) {
    openMatchCardsWorkspace(prepareButton.dataset.prepareMatchId);
    return;
  }
  const reportButton = event.target.closest("[data-report-team-id]");
  if (reportButton) void openTeamData(reportButton.dataset.reportTeamId);
});
$("#scoutCollectionTeam").addEventListener(
  "click",
  scoutTeamForActiveCollection
);
$("#reportsCollectionList").addEventListener("click", event => {
  if (event.target.closest("[data-create-report-collection]")) {
    openCollectionDialog();
    return;
  }
  const button = event.target.closest("[data-reports-collection-id]");
  if (!button) return;
  showReportsCollection(
    button.dataset.reportsCollectionId === TEMP_REPORTS_COLLECTION_ID
      ? null
      : button.dataset.reportsCollectionId
  );
});
$$("[data-back-to-collections]").forEach(button => {
  button.addEventListener("click", showReportsHome);
});
$$("[data-back-to-reports]").forEach(button => {
  button.addEventListener("click", () => {
    showSelectedTeamCollection();
  });
});
$$("[data-team-workspace-view]").forEach(button => {
  button.addEventListener("click", () => {
    if (!state.selectedTeamId) return;
    if (button.dataset.teamWorkspaceView === "report") {
      void openTeamData(state.selectedTeamId);
      return;
    }
    void openCompletedAnalysis(state.selectedTeamId);
  });
});
$("#analyzeCollectedTeam").addEventListener("click", () => {
  if (!state.selectedTeamId) return;
  if (analysisIsStale(state.selectedTeamId)) {
    void rerunRefreshedAnalysis();
    return;
  }
  void openCompletedAnalysis(state.selectedTeamId);
});
$$("[data-rerun-refreshed-analysis]").forEach(button => {
  button.addEventListener("click", () => {
    void rerunRefreshedAnalysis();
  });
});
$$("[data-stage-two-step]").forEach(button => {
  button.addEventListener("click", () => {
    if (!state.selectedTeamId) return;
    if (button.dataset.stageTwoStep === "report") {
      void openTeamData(state.selectedTeamId);
    } else {
      void openCompletedAnalysis(state.selectedTeamId);
    }
  });
});
$("#teamRoleSelect").addEventListener("change", event => {
  if (!state.selectedTeamId) return;
  if (!updateWorkspaceRole(state.selectedTeamId, event.target.value)) {
    updateTeamWorkspaceActions();
  }
});
function setActiveCollection(collectionId) {
  state.activeCollectionId = collectionId || null;
  if (state.activeCollectionId) {
    localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, state.activeCollectionId);
  } else {
    localStorage.removeItem(ACTIVE_COLLECTION_STORAGE_KEY);
  }
  state.matchCardPrefillOpponentId = null;
  loadStoredTeamWorkspace();
  $("#teamCollection").value = state.activeCollectionId ?? "";
  $("#gatherEventCollection").value = "";
  renderTeamList();
  renderReportsTeamList();
  updateTeamWorkspaceActions();
  if (!views.matchCards.hidden && !state.activeMatchCardId) {
    renderMatchCardsHome();
  }
}

$("#teamCollection").addEventListener("change", event => {
  setActiveCollection(event.target.value);
});
$("#teamEventCollection").addEventListener("change", async event => {
  const team = selectedTeam();
  if (!team) return;
  const previousCollectionId = teamCollectionId(team) || null;
  const collectionId = event.target.value || null;
  const pathId = collectionId ?? (teamCollectionId(team) || "unfiled");
  event.target.disabled = true;
  $("#teamRoleError").textContent = "";
  try {
    const response = await api(
      `/api/team-collections/${encodeURIComponent(pathId)}/team`,
      {
        method: "PUT",
        body: JSON.stringify({ datasetId: team.datasetId, collectionId })
      }
    );
    state.teamCollections = response.collections;
    if (
      previousCollectionId === state.activeCollectionId &&
      previousCollectionId !== collectionId &&
      workspaceRole(team.id) !== "scouting"
    ) {
      state.teamWorkspace = assignTeamRole(
        state.teamWorkspace,
        team.id,
        "scouting"
      );
      persistTeamWorkspace();
    }
    state.activeCollectionId = collectionId;
    if (collectionId) {
      localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, collectionId);
    } else {
      localStorage.removeItem(ACTIVE_COLLECTION_STORAGE_KEY);
    }
    loadStoredTeamWorkspace();
    renderCollectionControls();
    renderTeamList();
    updateTeamWorkspaceActions();
  } catch (error) {
    $("#teamRoleError").textContent = error.message;
    event.target.value = teamCollectionId(team);
  } finally {
    event.target.disabled = false;
  }
});
function openCollectionDialog(datasetId = null) {
  collectionCreateDatasetId = datasetId;
  $("#collectionError").textContent = "";
  $("#collectionName").value = "";
  $("#collectionCompetitionLevel").value = "local";
  $("#collectionDialog").showModal();
  $("#collectionName").focus();
}

$("#createTeamCollection").addEventListener("click", () => {
  openCollectionDialog();
});
$("#createReportCollection")?.addEventListener("click", () => {
  openCollectionDialog();
});
[$("#closeCollectionDialog"), $("#cancelCollectionDialog")].forEach(button => {
  button.addEventListener("click", () => {
    collectionCreateDatasetId = null;
    $("#collectionDialog").close();
  });
});
$("#collectionCreateForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  $("#collectionError").textContent = "";
  try {
    const response = await api("/api/team-collections", {
      method: "POST",
      body: JSON.stringify({
        name: $("#collectionName").value,
        competitionLevel: $("#collectionCompetitionLevel").value,
        datasetId: collectionCreateDatasetId
      })
    });
    state.teamCollections = response.collections;
    state.activeCollectionId = response.collection.id;
    localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, state.activeCollectionId);
    loadStoredTeamWorkspace();
    renderCollectionControls();
    renderTeamList();
    renderReportsCollections();
    updateTeamWorkspaceActions();
    collectionCreateDatasetId = null;
    $("#collectionDialog").close();
  } catch (error) {
    $("#collectionError").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
[$("#teamNextAction"), $("#analysisNextAction")].forEach(button => {
  button.addEventListener("click", () => {
    runWorkspaceAction(button.dataset.workspaceAction);
  });
});
$("#runAnalysis").addEventListener("click", runAnalysis);
$("#changeAnalysis").addEventListener("click", () => {
  if (state.selectedTeamId) openAnalysisSetup(state.selectedTeamId);
});
$("#rerunAnalysis").addEventListener("click", rerunAnalysis);
bindTablist("[data-analysis-tab]", "analysisTab", button => {
  state.analysisTab = button.dataset.analysisTab;
  renderAnalysisContent();
  updateBrowserRoute({
    view: "analysis",
    teamId: state.selectedTeamId,
    tab: state.analysisTab
  });
});
$("#scoutStage").addEventListener("click", () => {
  showView("intake");
});
$("#reportsStage").addEventListener("click", () => {
  showReportsHome();
});
$("#matchCardsStage").addEventListener("click", () => {
  openMatchCardsWorkspace();
});
$("#matchCardsWorkspace").addEventListener("submit", event => {
  if (event.target.id === "matchCardCreateForm") {
    event.preventDefault();
    void createMatchCardFromForm(event.target);
    return;
  }
  if (event.target.id === "tournamentEvidenceReviewForm") {
    event.preventDefault();
    acceptTournamentEvidence(event.target);
  }
});
$("#matchCardsWorkspace").addEventListener("change", event => {
  const target = event.target;
  if (target.matches("[data-result-screenshot]")) {
    const file = target.files?.[0];
    if (file) void reviewResultScreenshot(file);
    return;
  }
  if (target.matches("[data-match-collection]")) {
    setActiveCollection(target.value);
    renderMatchCardsHome();
    requestAnimationFrame(() => {
      $("[data-match-collection]")?.focus({ preventScroll: true });
    });
    return;
  }
  if (target.matches("[data-card-field=eligibility]")) {
    const card = state.matchCards.find(item => item.id === state.activeMatchCardId);
    if (!card || !analysisScopes.has(target.value)) return;
    card.eligibilityScope = target.value;
    card.updatedAt = new Date().toISOString();
    if (!persistMatchCards()) {
      renderMatchCardEditor();
      return;
    }
    state.matchCardContext = null;
    void openMatchCard(card.id);
    return;
  }
  if (target.matches("[data-card-field=status]")) {
    updateActiveMatchCard(card => {
      card.status = target.value;
    }, "[data-card-field=status]");
    return;
  }
  if (target.matches("[data-card-field=prediction]")) {
    updateActiveMatchCard(card => {
      card.opponentPredictionRank = Number(target.value);
    }, "[data-card-field=prediction]");
    return;
  }
  if (target.matches(".lineup-player-select")) {
    const court = target.dataset.court;
    const index = Number(target.dataset.playerIndex);
    updateActiveMatchCard(card => {
      card.draft[court] ??= Array.from(
        { length: court.startsWith("S") ? 1 : 2 },
        () => ""
      );
      card.draft[court][index] = target.value;
      state.matchCardError = "";
    }, `.lineup-player-select[data-court="${court}"][data-player-index="${index}"]`);
  }
});
$("#matchCardsWorkspace").addEventListener("click", event => {
  const button = event.target.closest("[data-card-action]");
  if (!button) return;
  const action = button.dataset.cardAction;
  if (action === "open") {
    void openMatchCard(button.dataset.cardId);
    return;
  }
  if (action === "back") {
    openMatchCardsWorkspace();
    requestAnimationFrame(() => {
      $(".match-cards-topbar .view-heading")?.focus({ preventScroll: true });
    });
    return;
  }
  if (action === "scout-our-team") {
    reset();
    return;
  }
  if (action === "choose-collection") {
    requestAnimationFrame(() => $("#teamCollection").focus());
    return;
  }
  if (action === "choose-our-team") {
    const team = activeCollectionTeams()[0];
    if (team) void openTeamData(team.id);
    return;
  }
  if (action === "choose-opponent") {
    const team = activeCollectionTeams().find(item =>
      item.id !== state.teamWorkspace.ourTeamId &&
      !state.teamWorkspace.scheduledOpponentIds.includes(item.id)
    );
    if (team) void openTeamData(team.id);
    return;
  }
  if (action === "scout-opponent") {
    reset("scheduled");
    return;
  }
  if (action === "plan-scheduled-match") {
    const form = $("#matchCardCreateForm");
    form.elements.opponentTeamId.value = button.dataset.opponentTeamId;
    form.elements.date.value = button.dataset.matchDate;
    form.elements.location.value = "neutral";
    form.elements.title.value =
      `Round robin vs ${matchCardTeamName(button.dataset.opponentTeamId)}`;
    $("#matchCardCreateError").textContent = "";
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    requestAnimationFrame(() => form.elements.title.focus({ preventScroll: true }));
    return;
  }
  if (action === "cancel-evidence") {
    state.pendingTournamentEvidence = null;
    renderMatchCardEditor();
    return;
  }
  if (action === "delete-evidence") {
    state.tournamentEvidence = state.tournamentEvidence.filter(
      item => item.id !== button.dataset.evidenceId
    );
    persistTournamentEvidence();
    const activeCard = state.matchCards.find(
      item => item.id === state.activeMatchCardId
    );
    if (activeCard) {
      activeCard.opponentPredictionRank = 1;
      activeCard.updatedAt = new Date().toISOString();
      persistMatchCards();
    }
    renderMatchCardEditor();
    return;
  }
  if (action === "prediction") {
    updateActiveMatchCard(card => {
      card.opponentPredictionRank = Number(button.dataset.predictionRank);
    }, `[data-card-action="prediction"][data-prediction-rank="${button.dataset.predictionRank}"]`);
    return;
  }
  if (action === "print") {
    window.print();
    return;
  }
  const card = state.matchCards.find(item => item.id === state.activeMatchCardId);
  if (!card) return;
  if (action === "clone") {
    const copy = cloneMatchCard(card, { id: newMatchCardId() });
    state.matchCards.push(copy);
    if (!persistMatchCards()) {
      state.matchCards = state.matchCards.filter(item => item.id !== copy.id);
      renderMatchCardEditor();
      return;
    }
    void openMatchCard(copy.id);
    return;
  }
  if (action === "delete" && window.confirm(`Delete “${card.title}”?`)) {
    state.matchCards = state.matchCards.filter(item => item.id !== card.id);
    persistMatchCards();
    renderMatchCardsHome();
  }
});

loadStoredMatchCards();
loadStoredTournamentEvidence();
void loadTeamCollections()
  .then(async () => {
    await loadTeams();
    loadStoredTeamWorkspace();
    renderTeamList();
    updateTeamWorkspaceActions();
    if (!views.matchCards.hidden && !state.activeMatchCardId) {
      renderMatchCardsHome();
    }
  })
  .then(() => {
    if (state.jobId) return;
    routeReady = true;
    return applyBrowserRoute();
  })
  .catch(error => {
    const message = escapeHtml(error.message);
    $("#teamList").innerHTML =
      `<p class="team-list-status error">${message}</p>`;
    $("#reportsCollectionList").innerHTML =
      `<p class="empty-state">Report collections could not be loaded: ${message}</p>`;
  });

window.addEventListener("popstate", () => {
  if (routeReady && !state.jobId) void applyBrowserRoute();
});

if (state.jobId) {
  showView("progress");
  pollJob();
} else {
  showReportsHome();
}
