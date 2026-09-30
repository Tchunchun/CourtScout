import {
  activeNationalRoster,
  buildReportCollections,
  collectionWorkspaceHeaderHtml,
  collectionWorkspaceListRowHtml,
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
  buildRatingCeilingPrediction,
  buildOnsitePredictions,
  challengeLineupAgainstPredictions,
  cloneMatchCard,
  compareCourtLine,
  confirmedOnsitePlayers,
  createMatchCard,
  createTournamentEvidence,
  initializeBlankDraft,
  explainLineupPrediction,
  extractLineupFromText,
  matchCardCourtDefinitions,
  matchRosterNames,
  mergeMatchCards,
  migrateMatchCardLeagueFormat,
  migrateLegacyMatchCards,
  normalizePlayerGender,
  orderScheduledMatches,
  parseStoredMatchCards,
  parseStoredTournamentEvidence,
  resolveScheduledOpponent,
  summarizeMatchup,
  summarizeRosterUsage,
  summarizeStackingStrategy,
  validateCardFinalization,
  validateDraft,
  validateMixedPair
} from "./match-card.mjs";
import {
  parseCsv,
  scheduleRowsFromCsv,
  suggestScheduleColumns
} from "./schedule.mjs";
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
  pendingMatchCardRefreshId: null,
  matchSchedule: null,
  matchScheduleError: null,
  matchScheduleTeamId: null,
  eventSchedule: null,
  eventScheduleCollectionId: null,
  reportsScheduleLoading: false,
  reportsScheduleError: null,
  schedulePreview: null,
  legacyCardMigration: null,
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

function collectionAnalysisScope(collectionId) {
  const level = state.teamCollections.find(
    collection => collection.id === collectionId
  )?.competitionLevel;
  return analysisScopes.has(level) ? level : "national";
}

function teamAnalysisScope(teamOrId) {
  const team = typeof teamOrId === "string"
    ? state.teams.find(item => item.id === teamOrId)
    : teamOrId;
  if (!team) return "national";
  return collectionAnalysisScope(teamCollectionId(team));
}

function activeCollectionAnalysisScope() {
  return collectionAnalysisScope(state.activeCollectionId);
}

function syncScoutCompetitionLevel() {
  const target = $("#scoutCollectionContext").dataset.collectionTarget;
  const collection = state.teamCollections.find(item => item.id === target);
  const select = $("#scoutCompetitionLevel");
  select.disabled = Boolean(collection);
  select.value = collection?.competitionLevel ?? select.value ?? "local";
  $("#scoutCompetitionLevelHint").textContent = collection
    ? `${collectionCompetitionLevelLabel(collection.competitionLevel)} is inherited from ${collection.name}.`
    : "Analysis and Match Day planning will inherit this eligibility level.";
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
  return analysisScopes.has(scope) && scope === teamAnalysisScope(teamId)
    ? scope
    : null;
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
  const scope = teamAnalysisScope(teamId);
  const hasCurrentAnalysis =
    state.analysis != null && state.analysisTeamId === teamId;
  const stale = analysisIsStale(teamId);
  $("#analyzeCollectedTeam").hidden = stale;
  $("#analyzeCollectedTeam").textContent =
    hasCurrentAnalysis || completedAnalysisScope(teamId)
      ? `Open ${eligibilityScopeLabels[scope]} analysis`
      : `Run ${eligibilityScopeLabels[scope]} analysis`;
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
  $("#scoutCompetitionLevel").disabled = false;
  $("#scoutCompetitionLevel").value = "local";
  $("#teamEventCollection").innerHTML = collectionOptions();
  const team = selectedTeam();
  const selectedCollectionId = team ? teamCollectionId(team) : "";
  $("#teamEventCollection").value = selectedCollectionId;
  syncScoutCompetitionLevel();
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
  return escapeHtml(name);
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
  const scheduleMatchesByTeamId = new Map();
  for (const match of orderScheduledMatches(reportScheduleMatches() ?? [])) {
    const opponentId = resolveScheduledOpponent(match, teams)?.id;
    if (opponentId && !scheduleMatchesByTeamId.has(opponentId)) {
      scheduleMatchesByTeamId.set(opponentId, match);
    }
  }
  const scheduleTeamIds = [...scheduleMatchesByTeamId.keys()];
  const rankedTeams = rankTeamsBySchedule(teams, {
    ...state.teamWorkspace,
    scheduledOpponentIds: scheduleTeamIds
  });
  const hasSchedule = scheduleTeamIds.length > 0;
  const refreshScheduleButton = $("#refreshReportsSchedule");
  refreshScheduleButton.hidden = !state.activeCollectionId;
  refreshScheduleButton.disabled =
    state.reportsScheduleLoading || !state.teamWorkspace.ourTeamId;
  refreshScheduleButton.textContent = state.reportsScheduleLoading
    ? "Refreshing…"
    : "Refresh schedule";
  refreshScheduleButton.title = state.teamWorkspace.ourTeamId
    ? ""
    : "Assign Our team before refreshing the schedule.";
  $("#reportsCollectionContext").innerHTML = collectionWorkspaceHeaderHtml({
    activeView: "reports",
    collectionName,
    collectionLevel: collection
      ? collectionCompetitionLevelLabel(collection.competitionLevel)
      : "Unassigned",
    teamCount: teams.length,
    scheduledMatchCount: scheduleTeamIds.length
  });
  $("#reportsTeamSummary").textContent =
    `${readyCount} ${readyCount === 1 ? "report" : "reports"} ready` +
    `${hasSchedule
      ? ` · ${scheduleTeamIds.length} scheduled ${scheduleTeamIds.length === 1 ? "match" : "matches"}`
      : " · No schedule available"}.`;
  const scheduleError = state.reportsScheduleError
    ? `<p class="match-card-alert" role="alert">${escapeHtml(state.reportsScheduleError)}</p>`
    : "";
  $("#reportsTeamList").innerHTML = scheduleError + (teams.length
    ? rankedTeams.map(({ team, scheduleRank }) => {
      const labels = reportTeamLabels(
        team.team?.section,
        team.team?.name ?? team.datasetId
      );
      const reportAvailable = team.reportAvailable !== false;
      const scheduledMatch = scheduleMatchesByTeamId.get(team.id);
      const role = workspaceRole(team.id);
      const analysisScope = teamAnalysisScope(team);
      const analysisStatus = analysisIsStale(team.id)
        ? "Analysis update available"
        : completedAnalysisScope(team.id)
          ? `${eligibilityScopeLabels[analysisScope]} analysis ready`
          : `Ready for ${eligibilityScopeLabels[analysisScope]} analysis`;
      const status = scheduleRank != null
        ? "Scheduled opponent"
        : role === "our"
          ? "Our team"
          : reportAvailable ? "Scouted team" : "National team";
      return collectionWorkspaceListRowHtml({
        className: scheduleRank != null ? "scheduled" : "",
        marker: hasSchedule
          ? {
              value: scheduleRank != null ? `#${scheduleRank}` : "—",
              label: scheduleRank != null ? "Schedule" : "Not scheduled"
            }
          : null,
        eyebrow: status,
        title: labels.title,
        details: [{
          text: reportAvailable
            ? `${team.matchCount ?? 0} matches · ${team.activeRosterSize ?? team.rosterSize ?? 0} active players`
            : `${team.activeRosterSize ?? 0} active players · report pending`
        }, ...(reportAvailable ? [{
          text: analysisStatus,
          emphasis: true
        }] : []), ...(scheduledMatch ? [{
          text: [
            reportScheduleDateLabel(scheduledMatch.date),
            scheduledMatch.time ?? "Time TBD",
            scheduledMatch.site ?? "Location TBD"
          ].join(" · "),
          emphasis: true
        }] : [])],
        actionsHtml: `
          <button class="button-secondary" type="button"
            ${reportAvailable
              ? `data-report-team-id="${escapeHtml(team.id)}"`
              : "disabled"}
            aria-label="${reportAvailable
              ? `View report and analysis for ${escapeHtml(labels.title)}`
              : `Report not gathered for ${escapeHtml(labels.title)}`}">
            ${reportAvailable ? "View report &amp; analysis" : "Report not gathered"}
          </button>
          ${scheduledMatch && reportAvailable ? `
            <button class="button-primary compact" type="button"
              data-prepare-match-id="${escapeHtml(scheduledMatch.id)}"
              aria-label="Prepare match against ${escapeHtml(labels.title)}">
              Prepare match
            </button>
          ` : ""}
        `
      });
    }).join("")
    : `
      <div class="reports-empty-state">
        <strong>No scouted teams in this collection yet</strong>
        <p>Scout a team to gather its roster, match history, and ratings.</p>
        <button class="button-primary compact" type="button" data-scout-collection-team>Scout your first team</button>
      </div>
    `);
}

function reportScheduleDateLabel(value) {
  if (!value) return "Date TBD";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function reportScheduleMatches() {
  if (state.eventScheduleCollectionId !== state.activeCollectionId) return null;
  return state.eventSchedule?.matches ?? [];
}

function renderReportsSchedule() {
  renderReportsTeamList();
}

function scheduleActionsHtml() {
  const eventType = state.eventSchedule?.eventType ?? "local";
  return `
    <div class="schedule-actions">
      <button class="button-secondary compact" type="button" data-schedule-action="refresh-local"
        ${eventType === "local" ? "" : "disabled"}>Refresh local schedule</button>
      <label class="button-secondary compact schedule-file-action">
        Import CSV
        <input type="file" accept=".csv,text/csv" data-schedule-csv>
      </label>
      <button class="button-secondary compact" type="button" data-schedule-action="add-manual">
        Add match
      </button>
    </div>`;
}

async function loadReportsSchedule() {
  if (!state.activeCollectionId) {
    state.eventSchedule = null;
    state.eventScheduleCollectionId = null;
    renderReportsTeamList();
    return;
  }
  const collectionId = state.activeCollectionId;
  state.reportsScheduleLoading = true;
  state.reportsScheduleError = null;
  state.eventScheduleCollectionId = collectionId;
  renderReportsTeamList();
  try {
    const response = await api(
      `/api/event-schedules/${encodeURIComponent(collectionId)}`
    );
    if (state.activeCollectionId !== collectionId) return;
    const collection = state.teamCollections.find(item => item.id === collectionId);
    const fallbackMatches = collectionMatchSchedule(collection, state.teams);
    state.eventSchedule = response.schedule ?? (
      fallbackMatches.length
        ? {
            collectionId,
            ourTeamId: state.teamWorkspace.ourTeamId,
            eventType: collection?.competitionLevel ?? "local",
            matches: fallbackMatches.map((match, index) => ({
              ...match,
              id: `collection:${collectionId}:${index}`,
              sourceOpponentName: matchCardTeamName(match.opponentTeamId),
              linkedOpponentTeamId: match.opponentTeamId,
              designation: "neutral",
              status: "scheduled"
            }))
          }
        : null
    );
  } catch (error) {
    if (state.activeCollectionId === collectionId) {
      state.reportsScheduleError = `Couldn’t load the schedule. ${error.message}`;
    }
  } finally {
    if (state.activeCollectionId === collectionId) {
      state.reportsScheduleLoading = false;
      renderReportsTeamList();
    }
  }
}

async function refreshReportsSchedule() {
  const collectionId = state.activeCollectionId;
  const ourTeamId = state.teamWorkspace.ourTeamId;
  if (!collectionId || !ourTeamId) return;
  state.reportsScheduleLoading = true;
  state.reportsScheduleError = null;
  renderReportsSchedule();
  try {
    const preview = await api(
      `/api/event-schedules/${encodeURIComponent(collectionId)}/local-preview`,
      {
        method: "POST",
        body: JSON.stringify({ ourTeamId })
      }
    );
    if (!preview.matches.length) {
      throw new Error("TennisRecord did not return any scheduled matches.");
    }
    const response = await api(
      `/api/event-schedules/${encodeURIComponent(collectionId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          ourTeamId,
          eventType: preview.eventType ?? "local",
          eligibilityScope: preview.eligibilityScope ?? "local",
          timezone: preview.timezone ?? null,
          source: preview.source,
          matches: preview.matches
        })
      }
    );
    state.eventSchedule = response.schedule;
    state.eventScheduleCollectionId = collectionId;
  } catch (error) {
    state.reportsScheduleError =
      `Couldn’t refresh the schedule. ${error.message}`;
  } finally {
    state.reportsScheduleLoading = false;
    renderReportsTeamList();
  }
}

async function linkReportsScheduleOpponent(matchId, teamId) {
  try {
    const response = await api(
      `/api/event-schedules/${encodeURIComponent(state.activeCollectionId)}/link`,
      {
        method: "PUT",
        body: JSON.stringify({ matchId, teamId })
      }
    );
    state.eventSchedule = response.schedule;
    state.eventScheduleCollectionId = state.activeCollectionId;
    state.reportsScheduleError = null;
  } catch (error) {
    state.reportsScheduleError = `Couldn’t link the opponent. ${error.message}`;
  }
  renderReportsTeamList();
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
  void loadReportsSchedule();
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
  const scope = teamAnalysisScope(team);
  $("#analysisInheritedScope").textContent =
    `${eligibilityScopeLabels[scope]} eligibility analysis`;
  $("#analysisInheritedScopeHint").textContent =
    `${eligibilityScopeLabels[scope]} was inherited from this report’s event collection.`;
  $("#runAnalysis").textContent = `Run ${eligibilityScopeLabels[scope]} analysis`;
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
  const exact = includeUtr &&
    $('input[name="utrMode"]:checked').value === "authenticated";
  $("#utrOptions").hidden = !includeUtr;
  $("#utrConnect").hidden = !exact;
  const rating = includeUtr ? (exact ? "Exact UTR" : "Public UTR") : null;
  $("#ratingSummary").textContent = rating
    ? `Ratings: ${rating}`
    : "Ratings: None";
  $("#formError").textContent = "";
  if (exact) void checkUtrStatus();
}

$("#includeUtr").addEventListener("change", syncRatingOptions);
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
        eventCollectionId,
        competitionLevel: $("#scoutCompetitionLevel").value
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
    utr: job.mode ?? "public"
  };
  const order = [
    job.kind !== "refresh" || selections.tennisrecord ? "tennisrecord" : null,
    selections.utr !== "none" ? "utr" : null,
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
    return activeNationalRoster(data).map(player => ({
      search: `${player.name} ${player.gender ?? ""} ${player.location ?? ""}`,
      cells: [
        escapeHtml(player.name),
        player.gender
          ? escapeHtml(player.gender)
          : '<span class="missing-value" title="Not available">—</span>',
        player.location ? escapeHtml(player.location) : '<span class="missing-value" title="Not available">—</span>',
        player.ntrp?.level ? escapeHtml(player.ntrp.level) : '<span class="missing-value" title="Not available">—</span>',
        player.dr != null ? `<span class="rating">${Number(player.dr).toFixed(2)}</span>` : '<span class="missing-value" title="Not available">—</span>',
        ...(selections.utr !== "none" ? [
          ratingCell(player.utr?.singles),
          ratingCell(player.utr?.doubles)
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
  return {
    utr: data.ratingSelections?.utr ??
      (exact ? "authenticated" : publicUtr ? "public" : "none")
  };
}

function getHeadings() {
  const selections = getRatingSelections(state.dataset);
  if (state.tab === "roster") {
    return [
      "Player",
      "Gender",
      "Location",
      "NTRP",
      "Dynamic rating",
      ...(selections.utr !== "none" ? ["Singles UTR", "Doubles UTR"] : [])
    ];
  }
  if (state.tab === "opponents") {
    return [
      "Opponent",
      "Location",
      "Dynamic rating",
      ...(selections.utr !== "none"
        ? ["Singles UTR", "Doubles UTR", "Profile status"]
        : [])
    ];
  }
  return headings[state.tab];
}

function renderTable() {
  const tableHeadings = getHeadings();
  const isNumericColumn = heading =>
    /NTRP|rating|UTR|Courts/i.test(heading);
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
  $("#reportTeamName").textContent =
    selectedTeam()?.team?.name ?? report.team.name;
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
  const scope = teamAnalysisScope(team);
  if (
    state.analysis &&
    state.analysisTeamId === team.id &&
    state.analysisScope === scope &&
    !analysisIsStale(team.id)
  ) {
    renderAnalysis();
    return;
  }
  const button = $("#analyzeCollectedTeam");
  button.disabled = true;
  button.textContent = "Loading analysis…";
  try {
    await requestAnalysis(team, scope, {
      refresh: analysisIsStale(team.id)
    });
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
  const scope = teamAnalysisScope(team);
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
    button.textContent = `Run ${eligibilityScopeLabels[scope]} analysis`;
  }
}

async function rerunRefreshedAnalysis() {
  const team = selectedTeam();
  if (!team) return;
  const scope =
    teamAnalysisScope(team);
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
    teamAnalysisScope(team);
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

function persistMatchCards(syncServer = true) {
  try {
    localStorage.setItem(
      MATCH_CARDS_STORAGE_KEY,
      JSON.stringify(state.matchCards)
    );
    state.matchCardStorageError = null;
    if (syncServer) {
      void api("/api/match-cards", {
        method: "PUT",
        body: JSON.stringify({ cards: state.matchCards })
      }).catch(error => {
        state.matchCardStorageError =
          `Cards are saved on this device, but server sync failed: ${error.message}`;
      });
    }
    return true;
  } catch (error) {
    state.matchCardStorageError =
      `Match cards could not be saved locally: ${error.message}`;
    return false;
  }
}

async function loadServerMatchCards() {
  try {
    const response = await api("/api/match-cards");
    const serverCards = parseStoredMatchCards(
      JSON.stringify(response.cards)
    );
    const merged = mergeMatchCards(state.matchCards, serverCards);
    const changed = JSON.stringify(merged) !== JSON.stringify(serverCards);
    state.matchCards = merged;
    persistMatchCards(false);
    if (changed) {
      await api("/api/match-cards", {
        method: "PUT",
        body: JSON.stringify({ cards: state.matchCards })
      });
    }
  } catch (error) {
    state.matchCardStorageError =
      `Server cards could not be synchronized; local cards remain available: ${error.message}`;
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

function newMatchCardId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return [...values].map(value => value.toString(16).padStart(8, "0")).join("-");
}

function scheduledMatchCard(match, opponentTeam = null) {
  const linked = state.matchCards.find(card =>
    card.scheduledMatchId === match.id
  );
  if (linked) return linked;
  if (!opponentTeam) return null;
  return state.matchCards.find(card =>
    !card.scheduledMatchId &&
    card.collectionId === state.activeCollectionId &&
    card.ourTeamId === state.teamWorkspace.ourTeamId &&
    card.opponentTeamId === opponentTeam.id &&
    card.date === match.date
  ) ?? null;
}

function scheduledMatchState(match, opponentTeam, card) {
  if (match.status === "cancelled") return "Cancelled";
  if (match.status === "completed" && !card) return "Completed";
  if (!opponentTeam) return "Needs scouting";
  if (card?.status === "archived") return "Archived";
  if (card?.status === "final") return "Final";
  if (card?.status === "not_started") return "Not started";
  if (card) return "Lineup in progress";
  return "Report ready";
}

function matchCardStatusLabel(status) {
  return {
    not_started: "Not started",
    draft: "Draft",
    final: "Final",
    archived: "Archived"
  }[status] ?? "Draft";
}

function scheduledMatchListHtml() {
  if (state.matchSchedule == null) {
    return '<div class="match-card-empty"><strong>Loading schedule…</strong><span>Reading confirmed matches from Our team.</span></div>';
  }
  const errorHtml = state.matchScheduleError
    ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchScheduleError)}</p>`
    : "";
  if (!state.matchSchedule.length) {
    return `
      ${errorHtml}
      <div class="match-card-empty">
        <strong>No confirmed schedule yet</strong>
        <span>Refresh Our team from TennisRecord to pull local schedule rows, including future scoreless matches.</span>
      </div>`;
  }
  const teams = activeCollectionTeams();
  return `
    ${errorHtml}
    <div class="schedule-match-list">
      ${orderScheduledMatches(state.matchSchedule).map(match => {
        const opponentTeam = resolveScheduledOpponent(match, teams);
        const card = scheduledMatchCard(match, opponentTeam);
        const preparationState = scheduledMatchState(match, opponentTeam, card);
        const location = [
          match.site ?? "Location TBD",
          match.designation !== "unknown" ? match.designation : null
        ].filter(Boolean).join(" · ");
        const actionsHtml = match.status === "cancelled" && !card
              ? '<span class="schedule-no-action">No preparation required</span>'
              : opponentTeam
              ? `<button class="${card || match.status === "completed"
                  ? "button-secondary"
                  : "button-primary"} compact" type="button"
                  data-card-action="open-scheduled-match"
                  data-scheduled-match-id="${escapeHtml(match.id)}">
                  ${card
                    ? match.status === "cancelled" ? "View preparation" : "Resume preparation"
                    : match.status === "completed" ? "Review match" : "Prepare match"}
                </button>`
              : `<div class="schedule-resolution">
                  <select data-schedule-link-match="${escapeHtml(match.id)}"
                    aria-label="Choose gathered team for ${escapeHtml(match.sourceOpponentName)}">
                    <option value="">Choose gathered team</option>
                    ${teams.filter(team =>
                      team.id !== state.teamWorkspace.ourTeamId
                    ).map(team => `
                      <option value="${escapeHtml(team.id)}">${escapeHtml(team.team?.name ?? team.datasetId)}</option>
                    `).join("")}
                  </select>
                  <button class="button-secondary compact" type="button"
                    data-card-action="scout-scheduled-opponent"
                    data-scheduled-match-id="${escapeHtml(match.id)}">
                    Scout opponent
                  </button>
                </div>`;
        return collectionWorkspaceListRowHtml({
          className: `scheduled schedule-match-row ${
            ["completed", "cancelled"].includes(match.status) ? match.status : ""
          }`,
          marker: {
            value: reportScheduleDateLabel(match.date),
            label: match.time ?? "Time TBD"
          },
          eyebrow: `Scheduled match · ${preparationState}`,
          title: match.sourceOpponentName,
          details: [{
            text: location
          }, {
            text: [
              match.round ?? "Round TBD",
              match.status,
              match.time
                ? match.timezone ?? state.eventSchedule?.timezone ?? "Timezone TBD"
                : null
            ].filter(Boolean).join(" · ")
          }, {
            text: card?.updatedAt
              ? `Card updated ${new Date(card.updatedAt).toLocaleString()}`
              : "No saved preparation",
            emphasis: true
          }],
          actionsHtml
        });
      }).join("")}
    </div>`;
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
            <span class="saved-card-status ${card.status === "final" ? "final" : ""}">${escapeHtml(matchCardStatusLabel(card.status))}</span>
            <span class="saved-card-main">
              <strong>${escapeHtml(card.title)}</strong>
              <small>vs ${escapeHtml(matchCardTeamName(card.opponentTeamId))}</small>
            </span>
            <span class="saved-card-meta">
              <span>${escapeHtml(card.date ?? "Date not set")}</span>
              <span>${escapeHtml(card.location ?? "home")}</span>
              <span>${eligibilityScopeLabels[card.eligibilityScope] ?? "National"} eligibility</span>
              ${card.scheduledMatchId ? "" : "<span>Legacy card</span>"}
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
  updateRouteForView("matchCards");
  const hasActiveCollection = Boolean(state.activeCollectionId);
  const authoritativeOurTeamId = state.eventSchedule?.ourTeamId ??
    state.teamWorkspace.ourTeamId;
  const defaultOurTeam = hasActiveCollection
    ? matchCardTeam(authoritativeOurTeamId)?.id ?? ""
    : "";
  const confirmedMatches = (state.matchSchedule ?? []).filter(
    match => match.status !== "cancelled"
  );
  const collection = state.teamCollections.find(
    item => item.id === state.activeCollectionId
  );
  const collectionTeams = hasActiveCollection ? activeCollectionTeams() : [];
  const readyForPlanning = Boolean(defaultOurTeam && confirmedMatches.length);
  $("#matchCardsWorkspace").innerHTML = `
    <div class="match-cards-topbar">
      <div>
        <p class="eyebrow">Step 3 · Match day planning</p>
        <h1 class="view-heading" tabindex="-1">Match Day Cards</h1>
        <p>Draft our lineup against a scouted opponent, compare every court, and print a shareable card.</p>
      </div>
    </div>
    ${collectionWorkspaceHeaderHtml({
      activeView: "cards",
      collectionName: collection?.name ?? "No collection selected",
      collectionLevel: collection
        ? collectionCompetitionLevelLabel(collection.competitionLevel)
        : "Choose a collection to begin",
      teamCount: collectionTeams.length,
      scheduledMatchCount: confirmedMatches.length
    })}
    ${state.matchCardStorageError
      ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardStorageError)}</p>`
      : ""}
    ${state.teamWorkspaceStorageError
      ? `<p class="match-card-alert" role="alert">${escapeHtml(state.teamWorkspaceStorageError)}</p>`
      : ""}
    ${state.legacyCardMigration?.migrated
      ? `<p class="match-card-alert success">${state.legacyCardMigration.migrated} legacy card${state.legacyCardMigration.migrated === 1 ? "" : "s"} linked to the confirmed schedule.</p>`
      : ""}
    ${state.legacyCardMigration?.unresolved
      ? `<p class="match-card-alert">${state.legacyCardMigration.unresolved} legacy card${state.legacyCardMigration.unresolved === 1 ? "" : "s"} could not be linked automatically. Open each card to archive it or retain it unchanged.</p>`
      : ""}
    <section class="match-readiness" aria-label="Match preparation readiness">
      <div>
        <span class="step-label">Workspace readiness</span>
        <h2>${!hasActiveCollection
          ? "Choose an event collection"
          : readyForPlanning ? "Ready to prepare scheduled matches" : "Complete the schedule setup"}</h2>
      </div>
      <div class="match-readiness-items">
        <article class="${defaultOurTeam ? "ready" : ""}">
          <span>${defaultOurTeam ? "✓" : "1"}</span>
          <div><strong>Our team</strong><small>${defaultOurTeam
            ? escapeHtml(matchCardTeamName(defaultOurTeam))
            : "Gather or assign the team you are preparing."}</small></div>
        </article>
        <article class="${confirmedMatches.length ? "ready" : ""}">
          <span>${confirmedMatches.length ? "✓" : "2"}</span>
          <div><strong>Confirmed schedule</strong><small>${confirmedMatches.length} active match${confirmedMatches.length === 1 ? "" : "es"}</small></div>
        </article>
      </div>
      ${!hasActiveCollection
        ? '<button class="button-secondary compact" type="button" data-card-action="choose-collection">Choose collection</button>'
        : !defaultOurTeam
        ? '<button class="button-secondary compact" type="button" data-card-action="scout-our-team">Restore home team</button>'
        : !confirmedMatches.length
          ? `<button class="button-secondary compact" type="button" data-schedule-action="${
            state.eventSchedule?.eventType === "local" ? "refresh-local" : "add-manual"
          }">${state.eventSchedule?.eventType === "local"
            ? "Refresh local schedule"
            : "Add or import schedule"}</button>`
          : ""}
    </section>
    <section class="schedule-planning">
      <div class="saved-cards-heading">
        <div>
          <span class="step-label">Confirmed schedule</span>
          <h2>Choose a scheduled match</h2>
          <p>Each match has one primary Match Day Card. Reopen it to resume preparation.</p>
        </div>
        ${scheduleActionsHtml()}
      </div>
      ${scheduledMatchListHtml()}
    </section>
    <div class="saved-cards">
      <div class="saved-cards-heading">
        <span class="step-label">Saved preparation</span>
        <h2>Match Day Cards</h2>
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
  const genderByName = new Map(
    activeRoster.map(player => [player.name, player.gender])
  );
  const ntrpByName = new Map(
    activeRoster.map(player => [player.name, player.ntrp?.level])
  );
  const maxCombinedNtrp = Number(context.opponentData.team?.level);
  const evidencePredictions = buildOnsitePredictions(
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
  })).filter(prediction =>
    card.leagueFormat !== "mixed" ||
    prediction.lines.every(line =>
      validateMixedPair(
        line.players ?? [],
        genderByName,
        ntrpByName,
        maxCombinedNtrp
      ).valid
    )
  );
  const ratingCeiling = buildRatingCeilingPrediction({
    roster: activeRoster,
    eligibilityPlayers:
      context.opponentAnalysis.eligibility?.players ?? [],
    pairs: context.opponentAnalysis.doubles?.pairs ?? [],
    matches: context.opponentData.matches ?? [],
    leagueFormat: card.leagueFormat,
    maxCombinedNtrp
  });
  const mostLikely = evidencePredictions[0]
    ? { ...evidencePredictions[0], scenarioType: "most_likely" }
    : null;
  const alternate = evidencePredictions[1]
    ? { ...evidencePredictions[1], scenarioType: "alternate" }
    : null;
  return [mostLikely, ratingCeiling, alternate]
    .filter(Boolean)
    .map((prediction, index) => ({
      ...prediction,
      rank: index + 1
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
  return new Set(matchCardCourtDefinitions(card.leagueFormat).flatMap(({ court }) =>
    (card.draft[court] ?? []).filter((name, index) =>
      name && !(court === exceptCourt && index === exceptIndex)
    )
  ));
}

function playerOptionLabel(
  player,
  discipline,
  eligible,
  analysisPlayer,
  leagueFormat
) {
  const utr = ratingDisplay(player.utr?.[discipline]);
  const dr = Number.isFinite(player.dr) ? Number(player.dr).toFixed(2) : "NR";
  const disciplineRecord = analysisPlayer?.local?.[discipline]?.record;
  const recordLabel = disciplineRecord
    ? `${disciplineRecord.wins}–${disciplineRecord.losses}`
    : "No record";
  const role = analysisPlayer?.role ?? "Role unknown";
  const gender = leagueFormat === "mixed"
    ? ` · ${normalizePlayerGender(player.gender) === "Men"
      ? "M"
      : normalizePlayerGender(player.gender) === "Women" ? "F" : "Gender unresolved"}`
    : "";
  const ntrp = leagueFormat === "mixed"
    ? ` · NTRP ${player.ntrp?.level ?? "unknown"}`
    : "";
  return `${player.name}${gender}${ntrp} · ${role} · ${recordLabel} · DR ${dr} · UTR ${utr}${eligible ? "" : " · eligibility warning"}`;
}

function lineupSelectHtml(card, context, court, index, eligibleNames) {
  const discipline = court.startsWith("S") ? "singles" : "doubles";
  const selected = card.draft[court]?.[index] ?? "";
  const selectedElsewhere = selectedDraftPlayers(card, court, index);
  const analysisByName = new Map(
    (context.ourAnalysis.eligibility?.players ?? []).map(player => [
      player.name,
      player
    ])
  );
  const genderByName = new Map(
    activeNationalRoster(context.ourData).map(player => [
      player.name,
      player.gender
    ])
  );
  const ntrpByName = new Map(
    activeNationalRoster(context.ourData).map(player => [
      player.name,
      player.ntrp?.level
    ])
  );
  const maxCombinedNtrp = Number(context.ourData.team?.level);
  const partnerIndex = index === 0 ? 1 : 0;
  const partnerName = card.draft[court]?.[partnerIndex] ?? "";
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
          ${selectedElsewhere.has(player.name) || (
            card.leagueFormat === "mixed" &&
            (
              !normalizePlayerGender(player.gender) ||
              (
                partnerName &&
                !validateMixedPair(
                  [partnerName, player.name],
                  genderByName,
                  ntrpByName,
                  maxCombinedNtrp
                ).valid
              )
            )
          ) ? "disabled" : ""}>
          ${escapeHtml(playerOptionLabel(
            player,
            discipline,
            eligibleNames.has(player.name),
            analysisByName.get(player.name),
            card.leagueFormat
          ))}
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
  return matchCardCourtDefinitions(card.leagueFormat).map(({ court }) => {
    const opponent = predictionLine(prediction, court);
    return compareCourtLine({
      court,
      ourPlayers: (card.draft[court] ?? []).filter(Boolean),
      opponentPlayers: opponent.players,
      ourRoster: activeNationalRoster(context.ourData),
      opponentRoster: activeNationalRoster(context.opponentData),
      leagueFormat: card.leagueFormat
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
          ${matchCardCourtDefinitions(card.leagueFormat).map(({ court, players }) => `
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
  const sideHtml = (side, emptyMessage) => side.players.length
    ? `
      <ul class="court-player-ratings">${side.players.map(player => `
        <li>
          <b>${escapeHtml(player.name)}${comparison.leagueFormat === "mixed"
            ? ` <i class="player-gender ${player.gender?.toLowerCase() ?? "unknown"}">${player.gender === "Men" ? "M" : player.gender === "Women" ? "F" : "?"}</i>`
            : ""}</b>
          <span>DR ${metricDisplay(player.dr, 2)} · UTR ${escapeHtml(player.utrDisplay)}</span>
        </li>
      `).join("")}</ul>
      <small class="court-line-average">Line average · DR ${metricDisplay(side.dr, 2)} · ${disciplineLabel} ${metricDisplay(side.utr, 2)}</small>`
    : `<strong class="court-line-empty">${escapeHtml(emptyMessage)}</strong>`;
  return `
    <article class="matchup-court ${comparison.edge}">
      <header>
        <strong>${escapeHtml(comparison.court)}</strong>
        <span>${escapeHtml(comparison.edge)} · ${escapeHtml(comparison.confidence)} confidence</span>
      </header>
      <div class="matchup-sides">
        <div>
          <span>Our lineup</span>
          ${sideHtml(comparison.ours, "Not selected")}
        </div>
        <div>
          <span>Opponent prediction</span>
          ${sideHtml(comparison.opponent, "Unavailable")}
        </div>
      </div>
      <footer>
        <span>DR: ${marginDisplay(comparison.margins.dr, 2)}</span>
        <span>${disciplineLabel}: ${marginDisplay(comparison.margins.utr, 2)}</span>
      </footer>
    </article>`;
}

function predictedOpponentNames(predictions) {
  return new Set(predictions.slice(0, 3).flatMap(prediction =>
    prediction.lines.flatMap(line => line.players ?? [])
  ));
}

function playerPerformanceEvidenceHtml(context, predictions) {
  const predictedNames = predictedOpponentNames(predictions);
  const players = (context.opponentAnalysis.eligibility?.players ?? [])
    .filter(player => predictedNames.has(player.name))
    .sort((a, b) =>
      b.local.appearances - a.local.appearances ||
      b.postseasonAppearances - a.postseasonAppearances ||
      (b.dr ?? -Infinity) - (a.dr ?? -Infinity)
    );
  if (!players.length) {
    return '<p class="match-card-alert">No predicted-player performance evidence is available.</p>';
  }
  return `
    <div class="decision-player-grid">
      ${players.map(player => {
        const singles = player.local.singles;
        const doubles = player.local.doubles;
        const upsetSignals = player.singlesUpsets.higherDrWins +
          player.singlesUpsets.higherUtrWins;
        return `
          <article>
            <header>
              <div>
                <strong>${escapeHtml(player.name)}</strong>
                <small>${escapeHtml(player.role)}</small>
              </div>
              <span>${escapeHtml(player.status)}</span>
            </header>
            <p>${escapeHtml(player.standoutNote)}</p>
            <div>
              <span>S ${singles.record.wins}–${singles.record.losses} · ${singles.appearances} played</span>
              <span>D ${doubles.record.wins}–${doubles.record.losses} · ${doubles.appearances} played</span>
              <span>${upsetSignals} higher-rated win signal${upsetSignals === 1 ? "" : "s"}</span>
              ${player.primaryPartner
                ? `<span>${escapeHtml(player.primaryPartner.name)} partner · ${player.primaryPartner.record.wins}–${player.primaryPartner.record.losses}</span>`
                : ""}
            </div>
          </article>`;
      }).join("")}
    </div>`;
}

function pairAndStackingEvidenceHtml(context) {
  const pairs = context.opponentAnalysis.doubles?.pairs ?? [];
  const strategy = summarizeStackingStrategy(
    context.opponentAnalysis.doubles?.matchStacking
  );
  return `
    <div class="decision-strategy-grid">
      <article>
        <span class="step-label">Pair evidence</span>
        <h3>${pairs.length ? "Most relevant doubles pairs" : "No known pairs"}</h3>
        ${pairs.length ? `
          <ul>${pairs.slice(0, 4).map(pair => `
            <li>
              <strong>${escapeHtml(pair.pair)}</strong>
              <span>${pair.appearances} appearance${pair.appearances === 1 ? "" : "s"} · ${pair.record.wins}–${pair.record.losses} · ${escapeHtml(pair.courts.map(court => court.court).join(", "))}</span>
            </li>
          `).join("")}</ul>` : "<p>No repeated pair history is available.</p>"}
      </article>
      <article>
        <span class="step-label">Stacking evidence</span>
        <h3>${escapeHtml(strategy?.label ?? "No stacking pattern")}</h3>
        ${strategy ? `
          <p>${escapeHtml(strategy.confidence)} confidence across ${strategy.matchesAnalyzed} match${strategy.matchesAnalyzed === 1 ? "" : "es"}.</p>
          <p>${strategy.lowerCourtStrengthMatches} of ${strategy.matchesWithRatingEvidence} rated match${strategy.matchesWithRatingEvidence === 1 ? "" : "es"} showed lower-court strength. ${strategy.strongestCourtCounts[0]
            ? `${escapeHtml(strategy.strongestCourtCounts[0].court)} was strongest in ${strategy.strongestCourtCounts[0].matches} match${strategy.strongestCourtCounts[0].matches === 1 ? "" : "es"}.`
            : ""}</p>
          <p>${strategy.strongestCourtByDr
            ? `${escapeHtml(strategy.strongestCourtByDr)} was strongest by average DR.`
            : "Court strength is not distinguishable from available ratings."}</p>
          ${strategy.inversions.length
            ? `<ul>${strategy.inversions.slice(0, 3).map(item => `
              <li>${escapeHtml(item.lowerCourt)} ${item.lowerDr.toFixed(2)} DR above ${escapeHtml(item.upperCourt)} ${item.upperDr.toFixed(2)}</li>
            `).join("")}</ul>`
            : ""}
        ` : "<p>No match-level court-strength evidence is available.</p>"}
      </article>
    </div>`;
}

function tournamentEvidenceDisclosureHtml(card, context) {
  const evidence = evidenceForCard(card);
  const onsite = confirmedOnsitePlayers(
    state.tournamentEvidence,
    card.collectionId,
    card.opponentTeamId
  );
  const pending = state.pendingTournamentEvidence?.cardId === card.id;
  return `
    <details class="decision-evidence-disclosure no-print" ${pending ? "open" : ""}>
      <summary>
        <span>
          <strong>Onsite and tournament evidence</strong>
          <small>${onsite.size} player${onsite.size === 1 ? "" : "s"} confirmed · ${evidence.length} reviewed result${evidence.length === 1 ? "" : "s"}</small>
        </span>
        <b>${pending ? "Review extraction" : "Add or review"}</b>
      </summary>
      ${tournamentEvidenceHtml(card, context)}
    </details>`;
}

function opponentReferenceHtml(context) {
  return `
    <details class="opponent-reference-details" id="prep-reference">
      <summary>
        <span>
          <strong>Full opponent reference</strong>
          <small>Roster, every known pair, stacking matches, and data-quality notes</small>
        </span>
        <b>View details</b>
      </summary>
      <div>
        ${opponentActiveRosterHtml(context)}
        ${opponentPairsHtml(context)}
        ${opponentStackingHtml(context)}
      </div>
    </details>`;
}

function opponentActiveRosterHtml(context) {
  const data = context.opponentData;
  const analysis = context.opponentAnalysis;
  const warnings = analysis.disclosures?.warnings ?? [];
  const eligibilityByName = new Map(
    (analysis.eligibility?.players ?? []).map(player => [
      player.name,
      player.status
    ])
  );
  return `
    <section class="opponent-active-roster" id="prep-roster">
      <div class="match-card-section-heading">
        <div>
          <span class="step-label">Opponent</span>
          <h2>Active roster and ratings</h2>
        </div>
        <p>${data.roster.length} players · ${data.matches.length} completed matches</p>
      </div>
      <div class="opponent-report-meta">
        <span>Gathered ${escapeHtml(data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "unknown")}</span>
        <span>Analyzed ${escapeHtml(analysis.generatedAt ? new Date(analysis.generatedAt).toLocaleString() : "unknown")}</span>
        <span>${escapeHtml(analysis.eligibility?.label ?? "Selected")} eligibility</span>
        <button class="button-secondary compact" type="button" data-card-action="refresh-opponent">
          Refresh opponent data
        </button>
      </div>
      ${warnings.length
        ? `<div class="match-card-alert"><strong>Data-quality notes</strong><ul>${warnings.map(warning =>
          `<li>${escapeHtml(warning)}</li>`
        ).join("")}</ul></div>`
        : ""}
      <div class="active-roster-table-wrap">
        <table class="active-roster-table">
          <thead><tr>
            <th>Player</th><th>Gender</th><th>NTRP</th><th>DR</th>
            <th>UTR S</th><th>UTR D</th><th>Eligibility</th>
          </tr></thead>
          <tbody>${data.roster.map(player => `
            <tr>
              <td><strong>${escapeHtml(player.name)}</strong></td>
              <td>${escapeHtml(player.gender ?? "Unknown")}</td>
              <td>${escapeHtml(player.ntrp?.level ?? "—")}</td>
              <td>${Number.isFinite(player.dr) ? Number(player.dr).toFixed(2) : "NR"}</td>
              <td>${escapeHtml(ratingDisplay(player.utr?.singles))}</td>
              <td>${escapeHtml(ratingDisplay(player.utr?.doubles))}</td>
              <td>${escapeHtml(eligibilityByName.get(player.name) ?? "unknown")}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function opponentPairsHtml(context) {
  const pairs = context.opponentAnalysis.doubles?.pairs ?? [];
  return `
    <section class="opponent-pairs" id="prep-pairs">
      <div class="match-card-section-heading">
        <div><span class="step-label">Opponent pairs</span><h2>Known doubles combinations</h2></div>
        <p>${pairs.length} observed pair${pairs.length === 1 ? "" : "s"} · ranked by usage and results</p>
      </div>
      ${pairs.length ? `
        <div class="opponent-pair-grid">
          ${pairs.slice(0, 8).map((pair, index) => `
            <article>
              <header><span>#${index + 1}</span><strong>${escapeHtml(pair.pair)}</strong></header>
              <div>
                <span>${pair.appearances} appearance${pair.appearances === 1 ? "" : "s"}</span>
                <span>${pair.record.wins}–${pair.record.losses}</span>
                <span>${pair.courts.map(court => `${court.court} ×${court.appearances}`).join(", ")}</span>
              </div>
              <div class="pair-player-ratings">
                ${(pair.currentRatings?.players ?? []).map(player => `
                  <p>
                    <strong>${escapeHtml(player.name)}</strong>
                    <span>DR ${Number.isFinite(player.dr) ? player.dr.toFixed(2) : "NR"} · UTR D ${escapeHtml(ratingDisplay(player.doublesUtr))}</span>
                  </p>
                `).join("")}
              </div>
              <footer>
                <span>Average DR ${Number.isFinite(pair.currentRatings?.drAverage) ? pair.currentRatings.drAverage.toFixed(2) : "NR"}</span>
                <span>Average UTR D ${Number.isFinite(pair.currentRatings?.doublesUtrAverage) ? pair.currentRatings.doublesUtrAverage.toFixed(2) : "Incomplete"}</span>
              </footer>
            </article>
          `).join("")}
        </div>`
        : '<p class="match-card-alert">No opponent pair history is available.</p>'}
    </section>`;
}

function opponentStackingHtml(context) {
  const strategy = summarizeStackingStrategy(
    context.opponentAnalysis.doubles?.matchStacking
  );
  if (!strategy) return "";
  return `
    <section class="opponent-stacking" id="prep-stacking">
      <div class="match-card-section-heading">
        <div><span class="step-label">Stacking strategy</span><h2>${escapeHtml(strategy.label)}</h2></div>
        <p>${escapeHtml(strategy.confidence)} · ${strategy.matchesAnalyzed} match${strategy.matchesAnalyzed === 1 ? "" : "es"} analyzed</p>
      </div>
      <p class="stacking-evidence-note">
        ${strategy.lowerCourtStrengthMatches} of ${strategy.matchesWithRatingEvidence} rated match${strategy.matchesWithRatingEvidence === 1 ? "" : "es"} showed a lower doubles court stronger than a court above it.
        Latest evidence: ${escapeHtml(strategy.latestDate ?? "Date unavailable")}
        ${strategy.opponentTeam ? ` vs ${escapeHtml(strategy.opponentTeam)}` : ""}.
        ${strategy.strongestCourtByDr
          ? `${escapeHtml(strategy.strongestCourtByDr)} was strongest by average DR.`
          : ""}
        This describes observed court strength, not confirmed captain intent.
      </p>
      <div class="stacking-court-grid">
        ${strategy.lines.map(line => `
          <article>
            <strong>${escapeHtml(line.court)}</strong>
            <span>${line.targetPlayers.map(escapeHtml).join(" + ")}</span>
            <small>Average DR ${Number.isFinite(line.averageDr) ? line.averageDr.toFixed(2) : "NR"} · ${escapeHtml(line.result ?? "Unknown result")}</small>
          </article>
        `).join("")}
      </div>
      ${strategy.inversions.length
        ? `<ul class="stacking-observations">${strategy.inversions.map(item => `
          <li>${escapeHtml(item.lowerCourt)} averaged ${item.lowerDr.toFixed(2)} DR, above ${escapeHtml(item.upperCourt)} at ${item.upperDr.toFixed(2)}.</li>
        `).join("")}</ul>`
        : ""}
    </section>`;
}

function predictionRationaleHtml(prediction) {
  const rationale = explainLineupPrediction(prediction);
  return `
    <details class="lineup-rationale">
      <summary>Why this lineup?</summary>
      <p>${escapeHtml(rationale.summary)}</p>
      <ul>${rationale.reasons.map(reason =>
        `<li>${escapeHtml(reason)}</li>`
      ).join("")}</ul>
      <div>${rationale.courts.map(court => `
        <span><b>${escapeHtml(court.court)}</b>${escapeHtml(court.reason)}</span>
      `).join("")}</div>
    </details>`;
}

function topOpponentPredictionsHtml(card, predictions, context) {
  if (!predictions.length) {
    const unresolvedGenderCount = card.leagueFormat === "mixed"
      ? activeNationalRoster(context.opponentData).filter(player =>
          !normalizePlayerGender(player.gender)
        ).length
      : 0;
    return `
      <p class="match-card-alert">
        ${unresolvedGenderCount
          ? `${unresolvedGenderCount} opponent player gender${unresolvedGenderCount === 1 ? " is" : "s are"} unresolved. Refresh opponent data before building valid Mixed pairs.`
          : "No opponent lineup scenarios are available yet. Refresh or analyze the opponent to generate scenarios."}
      </p>`;
  }
  const rosterByName = new Map(
    context.opponentData.roster.map(player => [player.name, player])
  );
  const usage = summarizeRosterUsage(
    context.opponentData.roster,
    context.opponentData.matches
  );
  const usageByName = new Map(usage.map(player => [player.name, player]));
  const unusedPlayers = usage.filter(player => !player.playedBefore);
  const visiblePredictions = predictions.slice(0, 3);
  const selectedPrediction = visiblePredictions.find(
    prediction => prediction.rank === card.opponentPredictionRank
  ) ?? visiblePredictions[0];
  const selectedIndex = visiblePredictions.indexOf(selectedPrediction);
  const scenarioTitle = prediction => prediction.source === "tournament"
    ? "Most likely · reviewed tournament lineup"
    : prediction.scenarioType === "rating_ceiling"
      ? "Rating ceiling · strongest known ratings"
      : prediction.scenarioType === "alternate"
        ? "Alternate likely lineup"
        : "Most likely · historical evidence";
  const scenarioSupport = prediction =>
    prediction.scenarioType === "rating_ceiling"
      ? `${prediction.ratingCoverage?.ratedPlayers ?? 0}/${prediction.ratingCoverage?.totalPlayers ?? 0} rated · ${prediction.unplayedPlayers?.length ?? 0} unplayed`
      : `${prediction.historicalSupport ?? 0}% support`;
  return `
    <p class="opponent-scenario-coverage">
      Testing scenario ${selectedIndex + 1} of ${visiblePredictions.length}.
      ${predictions.length < 3
        ? "More scenarios will appear when additional distinct lineup history or reviewed tournament evidence is available."
        : "Choose an alternate below to retest Our lineup."}
    </p>
    <article class="selected-opponent-prediction">
      <header>
        <div>
          <span>Scenario ${selectedIndex + 1}</span>
          <strong>${scenarioTitle(selectedPrediction)}</strong>
        </div>
        <b>${escapeHtml(selectedPrediction.confidence ?? "emerging")}</b>
      </header>
      <div class="prediction-court-list">
        ${matchCardCourtDefinitions(card.leagueFormat).map(({ court, discipline }) => {
          const line = predictionLine(selectedPrediction, court);
          return `
            <div class="prediction-court">
              <strong>${court}</strong>
              ${line.players?.length ? `
                <ul>${line.players.map(name => {
                  const player = rosterByName.get(name);
                  const playerUsage = usageByName.get(name);
                  const gender = normalizePlayerGender(player?.gender);
                  return `
                    <li class="${playerUsage?.playedBefore ? "played" : "unused"}">
                      <span>
                        <b>${escapeHtml(name)} <i class="player-gender ${gender?.toLowerCase() ?? "unknown"}">${gender === "Men" ? "M" : gender === "Women" ? "F" : "?"}</i></b>
                        <em>${playerUsage?.playedBefore
                          ? `Played ${playerUsage.appearances} match${playerUsage.appearances === 1 ? "" : "es"}`
                          : "Not yet used"}</em>
                      </span>
                      <small>DR ${Number.isFinite(player?.dr) ? player.dr.toFixed(2) : "NR"} · UTR ${escapeHtml(ratingDisplay(player?.utr?.[discipline]))}</small>
                    </li>`;
                }).join("")}</ul>`
                : "<span>Unavailable</span>"}
            </div>`;
        }).join("")}
      </div>
      <footer>
        <span>${escapeHtml(scenarioSupport(selectedPrediction))}</span>
        <span>${selectedPrediction.scenarioType === "rating_ceiling"
          ? "Availability unconfirmed"
          : `${selectedPrediction.observedTogether ?? 0} full-lineup observation${selectedPrediction.observedTogether === 1 ? "" : "s"}`}</span>
      </footer>
      ${predictionRationaleHtml(selectedPrediction)}
    </article>
    ${visiblePredictions.length > 1 ? `
      <div class="opponent-scenario-switcher">
        ${visiblePredictions.map((prediction, index) => `
          <button type="button" data-card-action="prediction"
            data-prediction-rank="${prediction.rank}"
            aria-pressed="${prediction.rank === selectedPrediction.rank}"
            ${prediction.rank === selectedPrediction.rank ? "disabled" : ""}>
            <span>Scenario ${index + 1}</span>
            <strong>${escapeHtml(scenarioTitle(prediction))}</strong>
            <small>${escapeHtml(prediction.confidence ?? "emerging")} · ${escapeHtml(scenarioSupport(prediction))}</small>
          </button>
        `).join("")}
      </div>` : ""}
    <details class="unused-roster-watch">
      <summary>
        <strong>Roster watch</strong>
        <small>${unusedPlayers.length} player${unusedPlayers.length === 1 ? "" : "s"} not yet used in gathered matches</small>
      </summary>
      ${unusedPlayers.length ? `
        <ul>${unusedPlayers.map(item => {
          const player = rosterByName.get(item.name);
          return `
            <li>
              <b>${escapeHtml(item.name)}</b>
              <span>DR ${Number.isFinite(player?.dr) ? player.dr.toFixed(2) : "NR"} · UTR S ${escapeHtml(ratingDisplay(player?.utr?.singles))} · UTR D ${escapeHtml(ratingDisplay(player?.utr?.doubles))}</span>
            </li>`;
        }).join("")}</ul>`
        : "<p>Every roster player appears in at least one gathered match.</p>"}
    </details>`;
}

function lineupChallengeHtml(card, context, predictions, validation) {
  const scenarios = challengeLineupAgainstPredictions({
    draft: card.draft,
    predictions,
    ourRoster: context.ourData.roster,
    opponentRoster: context.opponentData.roster,
    leagueFormat: card.leagueFormat
  });
  return `
    <section class="lineup-challenge" id="prep-challenge">
      <div class="match-card-section-heading">
        <div>
          <span class="step-label">Lineup challenge</span>
          <h2>Test our lineup against the top scenarios</h2>
        </div>
        <p>${validation.selectedPlayers}/${validation.requiredPlayers} players selected · planning edges, not a match-result prediction</p>
      </div>
      ${!validation.complete
        ? `<div class="match-card-alert lineup-challenge-blocked">
            <strong>Complete Our lineup to run the challenge.</strong>
            Choose all ${validation.requiredPlayers} required players. Scores, pros, and risks will appear after the lineup is complete.
          </div>`
        : scenarios.length ? `
        <div class="lineup-challenge-grid">
          ${scenarios.map((scenario, index) => `
            <article>
              <header>
                <div>
                  <span>Opponent scenario ${index + 1}</span>
                  <h3>${scenario.source === "tournament" ? "Tournament evidence" : `Historical option ${scenario.rank}`}</h3>
                </div>
                <div class="challenge-score">
                  <strong>${scenario.score}/${scenario.maxScore}</strong>
                  <small>edge points</small>
                </div>
              </header>
              <div class="challenge-meter" aria-label="${scenario.scorePercent}% of available matchup edge points">
                <span style="width:${scenario.scorePercent}%"></span>
              </div>
              <div class="challenge-edge-counts">
                <span><b>${scenario.summary.favorable}</b> favorable</span>
                <span><b>${scenario.summary.swing}</b> swing</span>
                <span><b>${scenario.summary.challenging}</b> challenging</span>
                <span><b>${scenario.summary.limited}</b> limited</span>
              </div>
              <p class="challenge-rating-coverage">
                Rating signals used: DR ${scenario.ratingCoverage.drCourts}/${scenario.ratingCoverage.totalCourts} courts ·
                UTR ${scenario.ratingCoverage.utrCourts}/${scenario.ratingCoverage.totalCourts} courts.
              </p>
              <div class="challenge-pros-cons">
                <div><strong>Pros</strong><ul>${scenario.pros.map(item =>
                  `<li>${escapeHtml(item)}</li>`
                ).join("")}</ul></div>
                <div><strong>Risks</strong><ul>${scenario.risks.map(item =>
                  `<li>${escapeHtml(item)}</li>`
                ).join("")}</ul></div>
              </div>
            </article>
          `).join("")}
        </div>`
        : '<p class="match-card-alert">No opponent scenarios are available for the lineup challenge yet.</p>'}
      <p class="lineup-challenge-disclaimer">
        Edge points summarize available DR and UTR comparisons. They do not predict the final match result.
      </p>
    </section>`;
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
  updateRouteForView("matchCards");
  const predictions = matchCardPredictions(card, context);
  const prediction = opponentPrediction(card, context, card.opponentPredictionRank);
  const eligibleNames = new Set(
    context.ourAnalysis.eligibility.players
      .filter(player => player.status === "eligible")
      .map(player => player.name)
  );
  const ourGenderByName = new Map(
    activeNationalRoster(context.ourData).map(player => [
      player.name,
      player.gender
    ])
  );
  const ourNtrpByName = new Map(
    activeNationalRoster(context.ourData).map(player => [
      player.name,
      player.ntrp?.level
    ])
  );
  const maxCombinedNtrp = Number(context.ourData.team?.level);
  const unresolvedOurGenderNames = card.leagueFormat === "mixed"
    ? activeNationalRoster(context.ourData)
        .filter(player => !normalizePlayerGender(player.gender))
        .map(player => player.name)
    : [];
  const validation = validateDraft(
    card.draft,
    eligibleNames,
    card.leagueFormat,
    ourGenderByName,
    ourNtrpByName,
    maxCombinedNtrp
  );
  const comparisons = matchCardComparisons(card, context);
  const summary = summarizeMatchup(comparisons);
  const ourTeamName = context.ourData.team.name;
  const opponentName = context.opponentData.team.name;
  const collectionName = state.teamCollections.find(
    collection => collection.id === card.collectionId
  )?.name ?? "Tournament";
  const scheduledMatch = state.matchSchedule?.find(
    match => match.id === card.scheduledMatchId
  );
  const displayDate = scheduledMatch?.date ?? card.date ?? "TBD";
  const displayLocation = scheduledMatch
    ? scheduledMatch.site ?? (
      scheduledMatch.designation !== "unknown"
        ? scheduledMatch.designation
        : "TBD"
    )
    : card.location ?? "TBD";
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
        <div class="match-card-heading">
          <p class="eyebrow">Step 3 · Match Day Card</p>
          <h1 class="view-heading" tabindex="-1">
            ${escapeHtml(ourTeamName)} <span>vs</span> ${escapeHtml(opponentName)}
          </h1>
          <div class="match-card-meta" aria-label="Match details">
            <span>${escapeHtml(displayDate)}</span>
            <span>${escapeHtml(displayLocation)}</span>
            <span>${escapeHtml(scheduledMatch?.round ?? collectionName)}</span>
            <span>${eligibilityScopeLabels[card.eligibilityScope] ?? "National"} eligibility</span>
          </div>
        </div>
        <label class="card-status no-print">Card status
          <select data-card-field="status">
            <option value="not_started" ${card.status === "not_started" ? "selected" : ""}>Not started</option>
            <option value="draft" ${card.status === "draft" ? "selected" : ""}>Draft</option>
            <option value="final" ${card.status === "final" ? "selected" : ""}>Final</option>
            <option value="archived" ${card.status === "archived" ? "selected" : ""}>Archived</option>
          </select>
        </label>
        <span class="print-status">${escapeHtml(matchCardStatusLabel(card.status))}</span>
      </header>
      ${state.matchCardStorageError
        ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardStorageError)}</p>`
        : ""}
      ${state.matchCardError
        ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardError)}</p>`
        : ""}
      <section class="lineup-decision-workspace" id="prep-plan">
        <nav class="lineup-test-mobile-nav no-print" aria-label="Lineup test panels">
          <a href="#prep-our-lineup">Our lineup</a>
          <a href="#prep-courts">Compare</a>
          <a href="#prep-opponent-lineups">Opponent</a>
        </nav>
        <div class="lineup-test-grid">
          <section class="our-lineup-builder lineup-test-column" id="prep-our-lineup">
            <div class="lineup-column-heading">
              <h2>Our lineup</h2>
              <small>${validation.selectedPlayers}/${validation.requiredPlayers} selected · ${validation.unavailableNames.length
                ? `${validation.unavailableNames.length} eligibility warning${validation.unavailableNames.length === 1 ? "" : "s"}`
                : `${eligibilityScopeLabels[card.eligibilityScope] ?? "National"} eligible`}</small>
            </div>
            <div class="lineup-builder-grid">
              ${matchCardCourtDefinitions(card.leagueFormat).map(({ court, players }) => `
                <article>
                  <strong>${court}</strong>
                  <div>${Array.from({ length: players }, (_, index) =>
                    lineupSelectHtml(card, context, court, index, eligibleNames)
                  ).join("")}</div>
                </article>
              `).join("")}
            </div>
            ${unresolvedOurGenderNames.length
              ? `<p class="lineup-eligibility-warning"><strong>Gender data required:</strong> ${unresolvedOurGenderNames.length} roster player gender${unresolvedOurGenderNames.length === 1 ? " is" : "s are"} unresolved. Refresh Our team before completing a Mixed lineup.</p>`
              : ""}
            ${validation.unavailableNames.length
              ? `<p class="lineup-eligibility-warning"><strong>Eligibility warning:</strong> ${validation.unavailableNames.map(escapeHtml).join(", ")} ${validation.unavailableNames.length === 1 ? "is" : "are"} not eligible for the selected ${eligibilityScopeLabels[card.eligibilityScope] ?? "National"} target.</p>`
              : ""}
            ${validation.invalidGenderCourts.length
              ? `<p class="lineup-eligibility-warning"><strong>Mixed pair warning:</strong> ${validation.unresolvedGenderNames.length
                ? `Refresh gender data for ${validation.unresolvedGenderNames.map(escapeHtml).join(", ")}.`
                : `Each pair must include one man and one woman on ${validation.invalidGenderCourts.map(escapeHtml).join(", ")}.`}</p>`
              : ""}
            ${validation.invalidNtrpCourts.length
              ? `<p class="lineup-eligibility-warning"><strong>Mixed level warning:</strong> The combined NTRP exceeds ${maxCombinedNtrp.toFixed(1)} on ${validation.invalidNtrpCourts.map(escapeHtml).join(", ")}.</p>`
              : validation.unresolvedNtrpNames.length
                ? `<p class="lineup-eligibility-warning"><strong>NTRP data required:</strong> Refresh ${validation.unresolvedNtrpNames.map(escapeHtml).join(", ")} before completing the Mixed lineup.</p>`
                : ""}
          </section>
          <section class="matchup-analysis lineup-test-column" id="prep-courts">
            <div class="lineup-column-heading">
              <h2>Compare</h2>
              <small>Live against the selected opponent option</small>
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
            <div class="matchup-courts decision-matchup-courts">${comparisons.map(matchCardCourtHtml).join("")}</div>
          </section>
          <section class="opponent-prediction-picker no-print" id="prep-opponent-lineups">
            <div class="lineup-column-heading">
              <h2>Opponent options</h2>
              <small>${evidenceForCard(card).length
                ? "Includes reviewed tournament evidence"
                : "Based on gathered match history"}</small>
            </div>
            ${topOpponentPredictionsHtml(card, predictions, context)}
          </section>
        </div>
      </section>
      ${lineupChallengeHtml(card, context, predictions, validation)}
      <section class="decision-evidence" id="prep-evidence">
        <div class="match-card-section-heading">
          <div><span class="step-label">Why this matchup</span><h2>Performance and strategy evidence</h2></div>
          <p>Evidence is limited to players appearing in the top opponent scenarios.</p>
        </div>
        ${playerPerformanceEvidenceHtml(context, predictions)}
        ${pairAndStackingEvidenceHtml(context)}
        ${tournamentEvidenceDisclosureHtml(card, context)}
      </section>
      ${opponentReferenceHtml(context)}
      <footer class="match-card-footnote">
        Opponent projection #${prediction?.rank ?? "—"} · ${prediction?.source === "tournament"
          ? `reviewed tournament result from ${escapeHtml(prediction.evidenceDate || "an unknown date")}`
          : `${prediction?.onsiteConfirmed ?? 0}/${prediction?.onsiteTotal ?? 0} players confirmed onsite; weighted with Step 1 scouting history`}.
        This card is a planning aid, not a prediction of final match results.
      </footer>
      <section class="match-card-notes" id="prep-notes">
        <label for="matchCardNotes"><span class="step-label">Match notes</span>
          <textarea id="matchCardNotes" data-card-field="notes" rows="3"
            placeholder="Add preparation notes, availability, or match-day reminders.">${escapeHtml(card.notes ?? "")}</textarea>
          <p class="print-match-notes">${escapeHtml(card.notes || "No match notes.")}</p>
        </label>
      </section>
    </div>`;
}

async function loadMatchCardContext(card) {
  const eligibilityScope = card.eligibilityScope ?? "national";
  const [ourData, opponentData, ourAnalysis, opponentAnalysis] = await Promise.all([
    api(`/api/team-data?team=${encodeURIComponent(card.ourTeamId)}`),
    api(`/api/team-data?team=${encodeURIComponent(card.opponentTeamId)}`),
    api(`/api/analysis?team=${encodeURIComponent(card.ourTeamId)}&eligibility=${encodeURIComponent(eligibilityScope)}`),
    api(`/api/analysis?team=${encodeURIComponent(card.opponentTeamId)}&eligibility=${encodeURIComponent(eligibilityScope)}`)
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
  const inheritedScope = collectionAnalysisScope(card.collectionId);
  if (card.eligibilityScope !== inheritedScope) {
    card.eligibilityScope = inheritedScope;
    card.updatedAt = new Date().toISOString();
    persistMatchCards();
  }
  state.activeMatchCardId = card.id;
  state.matchCardContext = null;
  state.matchCardError = "";
  renderMatchCardEditor();
  showView("matchCards");
  try {
    state.matchCardContext = await loadMatchCardContext(card);
    let cardChanged = false;
    const leagueFormat = state.matchCardContext.ourData.team?.leagueFormat ??
      state.matchCardContext.opponentData.team?.leagueFormat ??
      "single_gender";
    const migratedFormat = migrateMatchCardLeagueFormat(card, leagueFormat);
    if (migratedFormat.changed) {
      Object.assign(card, migratedFormat.card);
      cardChanged = true;
    }
    const predictions = matchCardPredictions(card, state.matchCardContext);
    if (
      predictions.length &&
      card.opponentPredictionRank !== predictions[0].rank
    ) {
      card.opponentPredictionRank = predictions[0].rank;
      cardChanged = true;
    }
    const initializedDraft = initializeBlankDraft(card);
    if (initializedDraft.changed) {
      Object.assign(card, initializedDraft.card);
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

function schedulePreviewCounts(preview) {
  return (preview.reconciliation ?? []).reduce((counts, row) => {
    counts[row.change] = (counts[row.change] ?? 0) + 1;
    return counts;
  }, {});
}

function renderSchedulePreview() {
  const preview = state.schedulePreview;
  if (!preview) return;
  $("#scheduleEventType").value = preview.eventType;
  $("#scheduleEligibilityScope").value = preview.eligibilityScope;
  $("#scheduleEligibilityScopeLabel").textContent =
    eligibilityScopeLabels[preview.eligibilityScope];
  $("#scheduleTimezone").value = preview.timezone ?? "";
  const mapping = $("#scheduleColumnMapping");
  if (preview.headers) {
    const fields = {
      matchId: "Match ID",
      opponent: "Opponent",
      date: "Date",
      time: "Time",
      location: "Location",
      round: "Round",
      designation: "Home / away",
      status: "Status",
      opponentUrl: "Opponent URL"
    };
    mapping.hidden = false;
    mapping.innerHTML = Object.entries(fields).map(([field, label]) => `
      <label>${label}
        <select data-schedule-map="${field}">
          <option value="-1">Not provided</option>
          ${preview.headers.map((header, index) => `
            <option value="${index}" ${preview.mapping[field] === index ? "selected" : ""}>
              ${escapeHtml(header || `Column ${index + 1}`)}
            </option>
          `).join("")}
        </select>
      </label>
    `).join("");
  } else {
    mapping.hidden = true;
    mapping.innerHTML = "";
  }
  const counts = schedulePreviewCounts(preview);
  const invalid = preview.matches.filter(match => match.errors?.length).length;
  $("#schedulePreviewSummary").innerHTML = `
    <span>${preview.matches.length} row${preview.matches.length === 1 ? "" : "s"}</span>
    ${["added", "changed", "unchanged", "removed"].map(change =>
      counts[change]
        ? `<span class="${change}">${counts[change]} ${change}</span>`
        : ""
    ).join("")}
    ${invalid ? `<span class="invalid">${invalid} invalid</span>` : ""}
  `;
  $("#schedulePreviewTable").innerHTML = `
    <table>
      <thead><tr>
        <th>Use</th><th>Opponent</th><th>Date</th><th>Time</th>
        <th>Location</th><th>Round</th><th>Side</th><th>Status</th><th>Issues</th>
      </tr></thead>
      <tbody>
        ${preview.matches.map((match, index) => `
          <tr class="${match.errors?.length ? "invalid" : ""}">
            <td><input type="checkbox" data-schedule-index="${index}" data-schedule-field="included"
              ${match.included !== false ? "checked" : ""} aria-label="Include row ${index + 1}"></td>
            <td><input data-schedule-index="${index}" data-schedule-field="sourceOpponentName"
              value="${escapeHtml(match.sourceOpponentName ?? "")}" aria-label="Opponent row ${index + 1}"></td>
            <td><input type="date" data-schedule-index="${index}" data-schedule-field="date"
              value="${escapeHtml(match.date ?? "")}" aria-label="Date row ${index + 1}"></td>
            <td><input data-schedule-index="${index}" data-schedule-field="time"
              value="${escapeHtml(match.time ?? "")}" aria-label="Time row ${index + 1}"></td>
            <td><input data-schedule-index="${index}" data-schedule-field="site"
              value="${escapeHtml(match.site ?? "")}" aria-label="Location row ${index + 1}"></td>
            <td><input data-schedule-index="${index}" data-schedule-field="round"
              value="${escapeHtml(match.round ?? "")}" aria-label="Round row ${index + 1}"></td>
            <td><select data-schedule-index="${index}" data-schedule-field="designation">
              ${["unknown", "home", "away", "neutral"].map(value =>
                `<option value="${value}" ${match.designation === value ? "selected" : ""}>${value}</option>`
              ).join("")}
            </select></td>
            <td><select data-schedule-index="${index}" data-schedule-field="status">
              ${["scheduled", "postponed", "completed", "cancelled"].map(value =>
                `<option value="${value}" ${match.status === value ? "selected" : ""}>${value}</option>`
              ).join("")}
            </select></td>
            <td>${escapeHtml(match.errors?.join(" ") || "Ready")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${(preview.reconciliation ?? []).some(row =>
      ["changed", "removed"].includes(row.change)
    ) ? `
      <div class="schedule-change-details">
        <strong>Existing schedule changes</strong>
        <ul>${preview.reconciliation.filter(row =>
          ["changed", "removed"].includes(row.change)
        ).map(row => `
          <li>
            <b>${escapeHtml(row.change)}</b>
            ${escapeHtml(row.current?.sourceOpponentName ?? row.proposed?.sourceOpponentName ?? "Match")}
            · ${escapeHtml(row.current?.date ?? "Date TBD")}
            ${row.change === "changed"
              ? ` → ${escapeHtml(row.proposed?.date ?? "Date TBD")}`
              : " · will remain as cancelled"}
          </li>
        `).join("")}</ul>
      </div>` : ""}`;
}

function openSchedulePreview(preview) {
  state.schedulePreview = {
    eventType: preview.eventType ?? state.eventSchedule?.eventType ?? "local",
    eligibilityScope: activeCollectionAnalysisScope(),
    timezone: preview.timezone ?? state.eventSchedule?.timezone ?? "",
    source: preview.source ?? { type: "manual" },
    matches: preview.matches.map((match, index) => ({
      rowNumber: match.rowNumber ?? index + 1,
      included: match.included !== false,
      designation: match.designation ?? "unknown",
      status: match.status ?? "scheduled",
      errors: match.errors ?? [],
      ...match
    })),
    reconciliation: preview.reconciliation ?? [],
    headers: preview.headers ?? null,
    rawRows: preview.rawRows ?? null,
    mapping: preview.mapping ?? null
  };
  $("#scheduleError").textContent = "";
  renderSchedulePreview();
  $("#scheduleDialog").showModal();
}

async function previewScheduleMatches(matches) {
  return api(
    `/api/event-schedules/${encodeURIComponent(state.activeCollectionId)}/preview`,
    {
      method: "POST",
      body: JSON.stringify({ matches })
    }
  );
}

async function refreshSchedulePreviewReconciliation() {
  if (!state.schedulePreview) return;
  const valid = state.schedulePreview.matches.filter(
    match => match.included !== false && !match.errors?.length
  );
  try {
    const result = await previewScheduleMatches(valid);
    if (!state.schedulePreview) return;
    state.schedulePreview.reconciliation = result.reconciliation;
    $("#scheduleError").textContent = "";
    renderSchedulePreview();
  } catch (error) {
    $("#scheduleError").textContent = error.message;
  }
}

async function refreshLocalSchedulePreview() {
  if (!state.activeCollectionId || !state.teamWorkspace.ourTeamId) return;
  try {
    const preview = await api(
      `/api/event-schedules/${encodeURIComponent(state.activeCollectionId)}/local-preview`,
      {
        method: "POST",
        body: JSON.stringify({ ourTeamId: state.teamWorkspace.ourTeamId })
      }
    );
    openSchedulePreview(preview);
  } catch (error) {
    state.matchScheduleError =
      `Couldn’t refresh the TennisRecord schedule. ${error.message}`;
    renderReportsSchedule();
    if (!views.matchCards.hidden) renderMatchCardsHome();
  }
}

async function openCsvSchedulePreview(file) {
  try {
    const rawRows = parseCsv(await file.text());
    const mapping = suggestScheduleColumns(rawRows[0]);
    const matches = scheduleRowsFromCsv(rawRows, mapping);
    const validMatches = matches.filter(match => !match.errors.length);
    const normalized = await previewScheduleMatches(validMatches);
    openSchedulePreview({
      eventType: state.eventSchedule?.eventType === "local"
        ? "other"
        : state.eventSchedule?.eventType ?? "other",
      eligibilityScope: activeCollectionAnalysisScope(),
      timezone: state.eventSchedule?.timezone ?? "",
      source: {
        type: "csv",
        fileName: file.name,
        importedAt: new Date().toISOString()
      },
      matches,
      reconciliation: normalized.reconciliation,
      headers: rawRows[0],
      rawRows,
      mapping
    });
  } catch (error) {
    state.matchScheduleError = `Couldn’t preview ${file.name}. ${error.message}`;
    renderReportsSchedule();
    if (!views.matchCards.hidden) renderMatchCardsHome();
  }
}

function openManualSchedulePreview() {
  openSchedulePreview({
    eventType: state.eventSchedule?.eventType ?? "other",
    eligibilityScope: activeCollectionAnalysisScope(),
    timezone: state.eventSchedule?.timezone ?? "",
    source: { type: "manual", importedAt: new Date().toISOString() },
    matches: [...(state.matchSchedule ?? []).map(match => ({
      ...match,
      included: true,
      errors: []
    })), {
      included: true,
      sourceOpponentName: "",
      sourceOpponentUrl: null,
      date: null,
      time: null,
      round: null,
      site: null,
      designation: "unknown",
      status: "scheduled",
      sourceType: "manual",
      errors: ["Opponent is required."]
    }]
  });
  void refreshSchedulePreviewReconciliation();
}

function validateSchedulePreviewRow(match) {
  const errors = [];
  if (!match.sourceOpponentName?.trim()) errors.push("Opponent is required.");
  if (match.date && !/^\d{4}-\d{2}-\d{2}$/.test(match.date)) {
    errors.push("Date must use YYYY-MM-DD.");
  }
  match.errors = errors;
  return match;
}

function handleScheduleAction(action) {
  if (action === "refresh-local") {
    void refreshLocalSchedulePreview();
  } else if (action === "add-manual") {
    openManualSchedulePreview();
  }
}

async function loadMatchSchedule() {
  const workspaceOurTeamId = state.teamWorkspace.ourTeamId;
  state.matchSchedule = null;
  state.matchScheduleError = null;
  state.matchScheduleTeamId = workspaceOurTeamId;
  state.eventSchedule = null;
  if (!state.activeCollectionId) return;
  try {
    const stored = await api(
      `/api/event-schedules/${encodeURIComponent(state.activeCollectionId)}`
    );
    const ourTeamId = stored.schedule?.ourTeamId ?? workspaceOurTeamId;
    if (!ourTeamId) {
      state.matchSchedule = [];
      return;
    }
    state.matchScheduleTeamId = ourTeamId;
    if (stored.schedule && workspaceOurTeamId !== ourTeamId) {
      state.teamWorkspace = assignTeamRole(
        state.teamWorkspace,
        ourTeamId,
        "our"
      );
      persistTeamWorkspace();
      renderTeamList();
      updateTeamWorkspaceActions();
    }
    const data = await api(
      `/api/team-data?team=${encodeURIComponent(ourTeamId)}`
    );
    if (state.matchScheduleTeamId !== ourTeamId) return;
    const collection = state.teamCollections.find(
      item => item.id === state.activeCollectionId
    );
    const collectionMatches = collectionMatchSchedule(collection, state.teams)
      .map((match, index) => ({
        ...match,
        id: `collection:${state.activeCollectionId}:${index}`,
        sourceOpponentName: matchCardTeamName(match.opponentTeamId),
        linkedOpponentTeamId: match.opponentTeamId,
        designation: "neutral",
        status: "scheduled"
      }));
    state.eventSchedule = stored.schedule ?? {
      collectionId: state.activeCollectionId,
      ourTeamId,
      eventType: "local",
      eligibilityScope: activeCollectionAnalysisScope(),
      timezone: null,
      source: {
        type: "tennisrecord",
        reference: data.sources?.find(source =>
          source.type === "tennisrecord"
        )?.url ?? null
      },
      matches: data.leagueSchedule?.length
        ? data.leagueSchedule
        : collectionMatches,
      lastSuccessfulSyncAt: data.leagueSchedule?.[0]?.sourceRetrievedAt ?? null
    };
    state.eventSchedule.persisted = Boolean(stored.schedule);
    state.matchSchedule = state.eventSchedule.matches;
    const migration = migrateLegacyMatchCards({
      cards: state.matchCards,
      matches: state.matchSchedule,
      teams: activeCollectionTeams(),
      ourTeamId,
      collectionId: state.activeCollectionId
    });
    state.matchCards = migration.cards;
    state.legacyCardMigration = migration;
    if (migration.migrated) persistMatchCards();
  } catch (error) {
    state.matchSchedule = [];
    state.matchScheduleError = `Couldn’t load Our team schedule. ${error.message}`;
  }
}

async function openMatchCardsWorkspace(opponentId = null) {
  state.matchCardPrefillOpponentId =
    typeof opponentId === "string" ? opponentId : null;
  renderMatchCardsHome();
  showView("matchCards");
  await loadMatchSchedule();
  if (!views.matchCards.hidden && !state.activeMatchCardId) {
    renderMatchCardsHome();
  }
}

async function openMatchPreparation(matchId) {
  await openMatchCardsWorkspace();
  await openScheduledMatch(matchId);
}

async function openScheduledMatch(matchId) {
  const match = state.matchSchedule?.find(item => item.id === matchId);
  if (!match) return;
  const opponentTeam = resolveScheduledOpponent(match, activeCollectionTeams());
  if (!opponentTeam) {
    state.matchScheduleError =
      `“${match.sourceOpponentName}” is not linked to one gathered team yet. Scout or resolve the opponent first.`;
    renderMatchCardsHome();
    return;
  }
  let card = scheduledMatchCard(match, opponentTeam);
  if (!card) {
    card = createMatchCard({
      id: newMatchCardId(),
      scheduledMatchId: match.id,
      title: `vs ${match.sourceOpponentName}`,
      date: match.date,
      location: match.designation === "unknown"
        ? match.site ?? "TBD"
        : match.designation,
      collectionId: state.activeCollectionId,
      ourTeamId: state.teamWorkspace.ourTeamId,
      opponentTeamId: opponentTeam.id,
      leagueFormat: matchCardTeam(state.teamWorkspace.ourTeamId)
        ?.team?.leagueFormat,
      eligibilityScope: activeCollectionAnalysisScope()
    });
    state.matchCards.push(card);
  } else if (!card.scheduledMatchId) {
    card.scheduledMatchId = match.id;
  }
  if (!persistMatchCards()) return;
  await openMatchCard(card.id);
}

async function ensureEventScheduleStored() {
  if (state.eventSchedule?.persisted) return state.eventSchedule;
  const response = await api(
    `/api/event-schedules/${encodeURIComponent(state.activeCollectionId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ourTeamId: state.teamWorkspace.ourTeamId,
        eventType: state.eventSchedule?.eventType ?? "local",
        eligibilityScope: activeCollectionAnalysisScope(),
        timezone: state.eventSchedule?.timezone ?? null,
        source: state.eventSchedule?.source ?? { type: "tennisrecord" },
        matches: state.matchSchedule ?? []
      })
    }
  );
  state.eventSchedule = { ...response.schedule, persisted: true };
  state.matchSchedule = response.schedule.matches;
  return state.eventSchedule;
}

async function linkScheduleOpponent(matchId, teamId) {
  try {
    await ensureEventScheduleStored();
    const response = await api(
      `/api/event-schedules/${encodeURIComponent(state.activeCollectionId)}/link`,
      {
        method: "PUT",
        body: JSON.stringify({ matchId, teamId })
      }
    );
    state.eventSchedule = { ...response.schedule, persisted: true };
    state.matchSchedule = response.schedule.matches;
    state.matchScheduleError = null;
    renderReportsSchedule();
    if (!views.matchCards.hidden && !state.activeMatchCardId) {
      renderMatchCardsHome();
    }
  } catch (error) {
    state.matchScheduleError = `Couldn’t link the opponent. ${error.message}`;
    renderReportsSchedule();
    if (!views.matchCards.hidden) renderMatchCardsHome();
  }
}

function scoutScheduledOpponent(matchId) {
  const match = state.matchSchedule?.find(item => item.id === matchId);
  if (!match) return;
  scoutTeamForCollection(state.activeCollectionId);
  $("#teamUrl").value = match.sourceOpponentUrl ?? "";
  $("#formError").textContent = match.sourceOpponentUrl
    ? `Scout ${match.sourceOpponentName}, then return to the collection schedule.`
    : `Paste the TennisRecord team URL for ${match.sourceOpponentName}.`;
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
    eligibilityScope: collectionAnalysisScope(collectionId)
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
      lines: extractLineupFromText(
        ocr.text,
        rosterNames,
        card.leagueFormat
      ),
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
  const lines = Object.fromEntries(matchCardCourtDefinitions(card.leagueFormat).map(({ court, players }) => [
    court,
    Array.from({ length: players }, (_, index) =>
      values.get(`${court}-${index}`) ?? ""
    )
  ]));
  if (
    !observedPlayers.length &&
    !validateDraft(lines, null, card.leagueFormat).selectedPlayers
  ) {
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
    leagueFormat: card.leagueFormat,
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
  syncScoutCompetitionLevel();
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
function openCollectionWorkspaceView(view) {
  if (view === "cards") {
    void openMatchCardsWorkspace();
    return;
  }
  if (view === "reports") {
    if (state.activeCollectionId) {
      showReportsCollection(state.activeCollectionId);
    } else {
      showReportsHome();
    }
  }
}

$("#reportsTeamsPanel").addEventListener("click", event => {
  const button = event.target.closest("[data-collection-workspace-view]");
  if (button) openCollectionWorkspaceView(button.dataset.collectionWorkspaceView);
});
$("#reportsTeamList").addEventListener("click", event => {
  if (event.target.closest("[data-scout-collection-team]")) {
    scoutTeamForActiveCollection();
    return;
  }
  const prepareButton = event.target.closest("[data-prepare-match-id]");
  if (prepareButton) {
    void openMatchPreparation(prepareButton.dataset.prepareMatchId);
    return;
  }
  const reportButton = event.target.closest("[data-report-team-id]");
  if (reportButton) void openTeamData(reportButton.dataset.reportTeamId);
});
$("#refreshReportsSchedule").addEventListener("click", () => {
  void refreshReportsSchedule();
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
  state.eventSchedule = null;
  state.eventScheduleCollectionId = null;
  state.matchSchedule = null;
  state.matchScheduleError = null;
  state.reportsScheduleError = null;
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
[$("#closeScheduleDialog"), $("#cancelSchedule")].forEach(button => {
  button.addEventListener("click", () => {
    state.schedulePreview = null;
    $("#scheduleDialog").close();
  });
});
$("#addManualScheduleRow").addEventListener("click", () => {
  if (!state.schedulePreview) return;
  state.schedulePreview.matches.push({
    included: true,
    sourceOpponentName: "",
    sourceOpponentUrl: null,
    date: null,
    time: null,
    round: null,
    site: null,
    designation: "unknown",
    status: "scheduled",
    sourceType: state.schedulePreview.source.type,
    errors: ["Opponent is required."]
  });
  renderSchedulePreview();
  void refreshSchedulePreviewReconciliation();
});
$("#scheduleEventType").addEventListener("change", event => {
  if (!state.schedulePreview) return;
  state.schedulePreview.eventType = event.target.value;
  renderSchedulePreview();
});
$("#scheduleTimezone").addEventListener("input", event => {
  if (state.schedulePreview) state.schedulePreview.timezone = event.target.value;
});
$("#scheduleColumnMapping").addEventListener("change", async event => {
  const field = event.target.dataset.scheduleMap;
  if (!field || !state.schedulePreview?.rawRows) return;
  state.schedulePreview.mapping[field] = Number(event.target.value);
  state.schedulePreview.matches = scheduleRowsFromCsv(
    state.schedulePreview.rawRows,
    state.schedulePreview.mapping
  );
  try {
    const valid = state.schedulePreview.matches.filter(
      match => !match.errors.length
    );
    const result = await previewScheduleMatches(valid);
    state.schedulePreview.reconciliation = result.reconciliation;
  } catch (error) {
    $("#scheduleError").textContent = error.message;
  }
  renderSchedulePreview();
});
$("#schedulePreviewTable").addEventListener("change", event => {
  const index = Number(event.target.dataset.scheduleIndex);
  const field = event.target.dataset.scheduleField;
  const match = state.schedulePreview?.matches[index];
  if (!match || !field) return;
  match[field] = event.target.type === "checkbox"
    ? event.target.checked
    : event.target.value || null;
  validateSchedulePreviewRow(match);
  renderSchedulePreview();
  void refreshSchedulePreviewReconciliation();
});
$("#scheduleConfirmForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.schedulePreview) return;
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  $("#scheduleError").textContent = "";
  const included = state.schedulePreview.matches
    .filter(match => match.included !== false)
    .map(validateSchedulePreviewRow);
  if (included.some(match => match.errors.length)) {
    $("#scheduleError").textContent =
      "Fix or exclude every invalid schedule row before confirming.";
    submit.disabled = false;
    renderSchedulePreview();
    return;
  }
  try {
    const preview = await previewScheduleMatches(included);
    const response = await api(
      `/api/event-schedules/${encodeURIComponent(state.activeCollectionId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          ourTeamId: state.teamWorkspace.ourTeamId,
          eventType: state.schedulePreview.eventType,
          eligibilityScope: state.schedulePreview.eligibilityScope,
          timezone: state.schedulePreview.timezone,
          source: state.schedulePreview.source,
          matches: preview.matches
        })
      }
    );
    state.eventSchedule = response.schedule;
    state.eventScheduleCollectionId = state.activeCollectionId;
    state.matchSchedule = response.schedule.matches;
    state.schedulePreview = null;
    $("#scheduleDialog").close();
    renderReportsSchedule();
    if (!views.matchCards.hidden && !state.activeMatchCardId) {
      renderMatchCardsHome();
    }
  } catch (error) {
    $("#scheduleError").textContent = error.message;
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
  if (target.matches("[data-schedule-link-match]")) {
    if (target.value) {
      void linkScheduleOpponent(
        target.dataset.scheduleLinkMatch,
        target.value
      );
    }
    return;
  }
  if (target.matches("[data-schedule-csv]")) {
    const file = target.files?.[0];
    if (file) void openCsvSchedulePreview(file);
    target.value = "";
    return;
  }
  if (target.matches("[data-result-screenshot]")) {
    const file = target.files?.[0];
    if (file) void reviewResultScreenshot(file);
    return;
  }
  if (target.matches("[data-match-collection]")) {
    setActiveCollection(target.value);
    void openMatchCardsWorkspace().then(() => {
      $("[data-match-collection]")?.focus({ preventScroll: true });
    });
    return;
  }
  if (target.matches("[data-card-field=status]")) {
    const card = state.matchCards.find(
      item => item.id === state.activeMatchCardId
    );
    if (target.value === "final" && card) {
      const eligibleNames = new Set(
        state.matchCardContext?.ourAnalysis?.eligibility?.players
          ?.filter(player => player.status === "eligible")
          .map(player => player.name) ?? []
      );
      const genderByName = new Map(
        activeNationalRoster(state.matchCardContext?.ourData ?? {}).map(
          player => [player.name, player.gender]
        )
      );
      const ntrpByName = new Map(
        activeNationalRoster(state.matchCardContext?.ourData ?? {}).map(
          player => [player.name, player.ntrp?.level]
        )
      );
      const maxCombinedNtrp = Number(
        state.matchCardContext?.ourData?.team?.level
      );
      const validation = validateCardFinalization(
        card,
        eligibleNames,
        genderByName,
        ntrpByName,
        maxCombinedNtrp
      );
      if (!validation.allowed) {
        state.matchCardError = `Finalization blocked. ${validation.message}`;
        renderMatchCardEditor();
        return;
      }
    }
    updateActiveMatchCard(card => {
      card.status = target.value;
      state.matchCardError = "";
    }, "[data-card-field=status]");
    return;
  }
  if (target.matches("[data-card-field=notes]")) {
    updateActiveMatchCard(card => {
      card.notes = target.value;
      if (card.status === "not_started") card.status = "draft";
    }, "[data-card-field=notes]");
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
      if (card.status !== "archived") card.status = "draft";
      state.matchCardError = "";
    }, `.lineup-player-select[data-court="${court}"][data-player-index="${index}"]`);
  }
});
$("#matchCardsWorkspace").addEventListener("click", event => {
  const workspaceView = event.target.closest("[data-collection-workspace-view]");
  if (workspaceView) {
    openCollectionWorkspaceView(workspaceView.dataset.collectionWorkspaceView);
    return;
  }
  const button = event.target.closest("[data-card-action]");
  const scheduleAction = event.target.closest("[data-schedule-action]");
  if (scheduleAction) {
    handleScheduleAction(scheduleAction.dataset.scheduleAction);
    return;
  }
  if (!button) return;
  const action = button.dataset.cardAction;
  if (action === "open") {
    void openMatchCard(button.dataset.cardId);
    return;
  }
  if (action === "open-scheduled-match") {
    void openScheduledMatch(button.dataset.scheduledMatchId);
    return;
  }
  if (action === "scout-scheduled-opponent") {
    scoutScheduledOpponent(button.dataset.scheduledMatchId);
    return;
  }
  if (action === "refresh-opponent") {
    const card = state.matchCards.find(
      item => item.id === state.activeMatchCardId
    );
    if (!card || !state.matchCardContext) return;
    state.pendingMatchCardRefreshId = card.id;
    state.selectedTeamId = card.opponentTeamId;
    state.dataset = state.matchCardContext.opponentData;
    $("#openRefreshData").click();
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
    showReportsHome();
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
  .then(() => loadServerMatchCards())
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
