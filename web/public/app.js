import {
  escapeHtml,
  matchCourtRows,
  matchStackingDetails,
  rankIneligiblePlayers,
  ratingCell,
  ratingDisplay,
  singlesPlayersTable,
  topDoublesPairsTable
} from "./render.mjs";
import {
  MATCH_CARD_COURTS,
  cloneMatchCard,
  compareCourtLine,
  createMatchCard,
  draftFromPrediction,
  parseStoredMatchCards,
  summarizeMatchup,
  validateDraft
} from "./match-card.mjs";
import {
  TEAM_WORKSPACE_SCHEDULE_LIMIT,
  assignTeamRole,
  emptyTeamWorkspace,
  parseTeamWorkspace,
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
const TEAM_WORKSPACE_STORAGE_KEY = "courtScoutTeamWorkspace";
const ACTIVE_COLLECTION_STORAGE_KEY = "courtScoutActiveTeamCollection";
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
  matchCardStorageError: null,
  activeMatchCardId: null,
  matchCardContext: null,
  matchCardError: "",
  teamWorkspace: emptyTeamWorkspace(),
  teamWorkspaceStorageError: null,
  matchCardPrefillOpponentId: null
};
const analysisScopes = new Set(["national", "sectional", "local"]);

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
      name: emptyName ?? "Unfiled"
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
  $("#reportsCollection").innerHTML = collectionOptions(true);
  $("#reportsCollection").value = state.activeCollectionId ?? "";
  $("#gatherEventCollection").innerHTML = collectionOptions(
    false,
    "No collection (standalone report)"
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
    state.teamWorkspace = parseTeamWorkspace(
      scopedWorkspace ?? legacyWorkspace
    );
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
    `${team.matchCount ?? 0} matches`
  ].filter(Boolean).join(" · ");
}

function teamHeadingHtml(name) {
  const match = String(name).match(/^(.*\S)\s+(\S*\d\S*)$/);
  if (!match) return escapeHtml(name);
  return `${escapeHtml(match[1])}<span>${escapeHtml(match[2])}</span>`;
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
    <button class="team-link" type="button" data-team-id="${escapeHtml(team.id)}"
      aria-pressed="${team.id === state.selectedTeamId}">
      <span>${escapeHtml(team.team?.name ?? team.datasetId)}</span>
      <small title="${escapeHtml(teamDescription(team))}">
        <span>${escapeHtml(team.team?.section ?? "Section unavailable")}</span>
        <span>${team.matchCount ?? 0} matches</span>
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
  list.innerHTML = group(
    state.activeCollectionId ? "Teams in this collection" : "All gathered teams",
    String(visibleTeams.length),
    visibleTeams,
    "No gathered teams yet."
  );
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
  const teams = activeCollectionTeams();
  $("#reportsTeamList").innerHTML = teams.length
    ? teams.map(team => `
      <button class="report-team-card" type="button" data-report-team-id="${escapeHtml(team.id)}">
        <span>Scouted team</span>
        <span>
          <strong>${escapeHtml(team.team?.name ?? team.datasetId)}</strong>
          <small>${escapeHtml(team.team?.section ?? "Section unavailable")} · ${team.matchCount ?? 0} matches · ${team.rosterSize ?? 0} players</small>
        </span>
        <span>View report & analysis →</span>
      </button>
    `).join("")
    : '<p class="empty-state">No scouted teams in this collection yet.</p>';
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
    renderCollectionControls();
    updateTeamWorkspaceActions();
    if (!views.matchCards.hidden && !state.activeMatchCardId) {
      renderMatchCardsHome();
    }
  } catch (error) {
    $("#teamList").innerHTML =
      `<p class="team-list-status error">${escapeHtml(error.message)}</p>`;
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

  try {
    const job = await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        teamUrl,
        utrMode,
        includeWtn
      })
    });
    state.jobId = job.id;
    state.jobKind = job.kind;
    localStorage.setItem("courtScoutJob", job.id);
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
        refreshWtn
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
    showView("intake");
  }
}

function getRows() {
  const data = state.dataset;
  const selections = getRatingSelections(data);
  if (state.tab === "roster") {
    return data.roster.map(player => ({
      search: `${player.name} ${player.location ?? ""}`,
      cells: [
        escapeHtml(player.name),
        player.location ? escapeHtml(player.location) : '<span class="missing-value" title="Not available">—</span>',
        player.ntrp?.level ? escapeHtml(player.ntrp.level) : '<span class="missing-value" title="Not available">—</span>',
        player.dr != null ? `<span class="rating">${Number(player.dr).toFixed(4)}</span>` : '<span class="missing-value" title="Not available">—</span>',
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
        player.dr != null ? `<span class="rating">${Number(player.dr).toFixed(4)}</span>` : '<span class="missing-value" title="Not available">—</span>',
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
    return [
      "Player",
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
        : [])
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
});

$("#tableSearch").addEventListener("input", event => {
  state.search = event.target.value;
  renderTable();
});

async function loadResults(job) {
  const data = await api(`/api/jobs/${state.jobId}/data`);
  const teamId = job?.teamId ??
    (job?.collectionName ? `collections/${job.collectionName}` : null);
  if (teamId) {
    state.selectedTeamId = teamId;
  }
  if (job.kind === "refresh" && teamId) {
    markAnalysisStale(teamId);
  }
  renderDataset(data);
  if (teamId) await loadTeams(teamId);
  if (job.warning) {
    $("#teamRoleError").textContent = job.warning;
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
    requestedProfiles.push(...data.roster.map(player => player.wtn));
  }
  const resolved = requestedProfiles.filter(profile =>
    ["singles", "doubles"].some(type => {
      const rating = profile?.[type];
      return rating?.value != null ||
        (rating?.display && rating.display !== "NR");
    })
  ).length;
  $("#teamName").innerHTML = teamHeadingHtml(data.team.name);
  $("#teamMeta").textContent = [
    data.team.season,
    data.team.section,
    data.team.gender
  ].filter(Boolean).join(" · ");
  $("#rosterCount").textContent = data.roster.length;
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
          <td class="eligibility-number">${Number.isFinite(player.dr) ? Number(player.dr).toFixed(4) : "—"}</td>
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
  $("#reportTeamMeta").textContent = [
    report.team.season,
    report.team.section,
    report.team.league,
    `${report.eligibility.label} eligibility`
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
  state.analysisTab = "eligibility";
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
  const teams = state.teams;
  return teams.length
    ? [
      '<option value="">Choose a scouted team</option>',
      ...teams.map(team => matchCardTeamOption(team, selectedId))
    ].join("")
    : '<option value="">Scout a team in Step 1</option>';
}

function matchCardOpponentOptions(selectedId, ourTeamId = null) {
  const teams = state.teams.filter(team => team.id !== ourTeamId);
  return teams.length
    ? [
      '<option value="">Choose a scouted opponent</option>',
      ...teams.map(team => matchCardTeamOption(team, selectedId))
    ].join("")
    : '<option value="">Scout another team in Step 1</option>';
}

function newMatchCardId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return [...values].map(value => value.toString(16).padStart(8, "0")).join("-");
}

function matchCardListHtml() {
  if (!state.matchCards.length) {
    return `
      <div class="match-card-empty">
        <strong>No Match Day Cards yet</strong>
        <span>Create the first card after scouting both teams in Step 1.</span>
      </div>`;
  }
  const groups = new Map();
  for (const card of [...state.matchCards].sort((a, b) =>
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
  const availableTeams = state.teams;
  const defaultOurTeam = availableTeams[0]?.id ?? "";
  const defaultOpponent = availableTeams.find(
    team => team.id === state.matchCardPrefillOpponentId && team.id !== defaultOurTeam
  )?.id ?? availableTeams.find(team => team.id !== defaultOurTeam)?.id ?? "";
  const canCreateCard = availableTeams.length >= 2;
  const today = new Date().toISOString().slice(0, 10);
  $("#matchCardsWorkspace").innerHTML = `
    <div class="match-cards-topbar">
      <div>
        <p class="eyebrow">Step 3 · Match day planning</p>
        <h1 class="view-heading" tabindex="-1">Match Day Cards</h1>
        <p>Draft our lineup against a scouted opponent, compare every court, and print a shareable card.</p>
      </div>
    </div>
    ${state.matchCardStorageError
      ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardStorageError)}</p>`
      : ""}
    <section class="match-readiness" aria-label="Match preparation readiness">
      <div>
        <span class="step-label">Scouted teams</span>
        <h2>${canCreateCard ? "Ready to build a matchup" : "Scout at least two teams"}</h2>
      </div>
      <div class="match-readiness-items">
        <article class="${defaultOurTeam ? "ready" : ""}">
          <span>${defaultOurTeam ? "✓" : "1"}</span>
          <div><strong>First team</strong><small>${defaultOurTeam
            ? escapeHtml(matchCardTeamName(defaultOurTeam))
            : "Scout the team you are preparing."}</small></div>
        </article>
        <article class="${defaultOpponent ? "ready" : ""}">
          <span>${defaultOpponent ? "✓" : "2"}</span>
          <div><strong>Second team</strong><small>${defaultOpponent
            ? escapeHtml(matchCardTeamName(defaultOpponent))
            : "Scout an opponent team."}</small></div>
        </article>
      </div>
      ${canCreateCard ? "" : '<button class="button-secondary compact" type="button" data-card-action="scout-opponent">Scout another team</button>'}
    </section>
    <div class="match-card-create-panel">
      <div>
        <span class="step-label">New card</span>
        <h2>Set the matchup</h2>
        <p>Choose any two teams gathered in Step 1.</p>
      </div>
      <form id="matchCardCreateForm" class="match-card-create-form">
        <label>Team
         <select name="ourTeamId" required>${matchCardOurTeamOptions(defaultOurTeam)}</select>
        </label>
        <label>Opponent
         <select name="opponentTeamId" required>${matchCardOpponentOptions(defaultOpponent, defaultOurTeam)}</select>
        </label>
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
        <label class="match-card-title-field">Card name
          <input name="title" maxlength="80" placeholder="e.g. Nationals semifinal">
        </label>
        <button class="button-primary compact" type="submit" ${canCreateCard ? "" : "disabled"}>Create Match Day Card</button>
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

function opponentPrediction(context, rank) {
  return context.opponentAnalysis.lineupPredictions?.predictions
    ?.find(prediction => prediction.rank === rank) ??
    context.opponentAnalysis.lineupPredictions?.predictions?.[0] ??
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
  const roster = [...context.ourData.roster].sort((a, b) =>
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
  const prediction = opponentPrediction(context, card.opponentPredictionRank);
  return MATCH_CARD_COURTS.map(({ court }) => {
    const opponent = predictionLine(prediction, court);
    return compareCourtLine({
      court,
      ourPlayers: (card.draft[court] ?? []).filter(Boolean),
      opponentPlayers: opponent.players,
      ourRoster: context.ourData.roster,
      opponentRoster: context.opponentData.roster
    });
  });
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
        <p class="eyebrow">Loading Stage 2</p>
        <h1 class="view-heading" tabindex="-1">Building the Match Day Card…</h1>
        <p>Loading both rosters, eligibility, and opponent predictions.</p>
      </div>`;
    return;
  }
  const prediction = opponentPrediction(context, card.opponentPredictionRank);
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
          <p class="eyebrow">Stage 2 · Match Day Card</p>
          <h1 class="view-heading" tabindex="-1">${escapeHtml(card.title)}</h1>
          <div class="match-card-meta" aria-label="Match details">
            <span>${escapeHtml(card.date)}</span>
            <span>${escapeHtml(card.location)}</span>
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
        <span class="print-status">${escapeHtml(card.status)}</span>
      </header>
      ${state.matchCardStorageError
        ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardStorageError)}</p>`
        : ""}
      ${state.matchCardError
        ? `<p class="match-card-alert" role="alert">${escapeHtml(state.matchCardError)}</p>`
        : ""}
      <section class="opponent-prediction-picker no-print">
        <div>
          <span class="step-label">Opponent</span>
          <h2>Likely lineup</h2>
          <p>Choose the scenario to plan against.</p>
        </div>
        <label class="prediction-select">Opponent scenario
          <select data-card-field="prediction">
            ${(context.opponentAnalysis.lineupPredictions?.predictions ?? []).map(item => `
              <option value="${item.rank}" ${item.rank === card.opponentPredictionRank ? "selected" : ""}>
                Option ${item.rank} · ${item.historicalSupport}% support${item.observedTogether ? ` · seen together ${item.observedTogether}×` : ""}
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
            : "Nationally eligible roster"}</p>
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
          ? `<p class="lineup-eligibility-warning"><strong>Eligibility warning:</strong> ${validation.unavailableNames.map(escapeHtml).join(", ")} ${validation.unavailableNames.length === 1 ? "is" : "are"} not eligible for the selected National target.</p>`
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
        Opponent projection #${prediction?.rank ?? "—"} · generated from scouting history.
        This card is a planning aid, not a prediction of final match results.
      </footer>
    </div>`;
}

async function loadMatchCardContext(card) {
  const [ourData, opponentData, ourAnalysis, opponentAnalysis] = await Promise.all([
    api(`/api/team-data?team=${encodeURIComponent(card.ourTeamId)}`),
    api(`/api/team-data?team=${encodeURIComponent(card.opponentTeamId)}`),
    api(`/api/analysis?team=${encodeURIComponent(card.ourTeamId)}&eligibility=national`),
    api(`/api/analysis?team=${encodeURIComponent(card.opponentTeamId)}&eligibility=national`)
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
  state.activeMatchCardId = card.id;
  state.matchCardContext = null;
  state.matchCardError = "";
  renderMatchCardEditor();
  showView("matchCards");
  try {
    state.matchCardContext = await loadMatchCardContext(card);
    let cardChanged = false;
    const predictions =
      state.matchCardContext.opponentAnalysis.lineupPredictions?.predictions ?? [];
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
        <p class="eyebrow">Stage 2 needs attention</p>
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
  const ourTeamId = values.get("ourTeamId");
  const opponentTeamId = values.get("opponentTeamId");
  if (!ourTeamId || !opponentTeamId) {
    $("#matchCardCreateError").textContent = "Choose both teams.";
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
    ourTeamId,
    opponentTeamId
  });
  state.matchCards.push(card);
  if (!persistMatchCards()) {
    state.matchCards = state.matchCards.filter(item => item.id !== card.id);
    renderMatchCardsHome();
    return;
  }
  await openMatchCard(card.id);
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
  state.jobId = null;
  state.jobKind = null;
  state.dataset = null;
  $("#formError").textContent = "";
  $("#tryAgain").hidden = true;
  $(".progress-copy .eyebrow").textContent = "Collection in progress";
  $(".progress-copy h1").textContent = "Building your scouting dataset.";
  showView("intake");
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
  reset();
});
$("#newScout").addEventListener("click", () => reset());
$("#gatherTeam").addEventListener("click", () => reset());
$("#landingViewTeams").addEventListener("click", () => {
  renderReportsTeamList();
  showView("reports");
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
  const button = event.target.closest("[data-report-team-id]");
  if (button) void openTeamData(button.dataset.reportTeamId);
});
$$("[data-back-to-reports]").forEach(button => {
  button.addEventListener("click", () => {
    renderReportsTeamList();
    showView("reports");
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
  loadStoredTeamWorkspace();
  $("#teamCollection").value = state.activeCollectionId ?? "";
  $("#reportsCollection").value = state.activeCollectionId ?? "";
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
$("#reportsCollection").addEventListener("change", event => {
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
  $("#collectionDialog").showModal();
  $("#collectionName").focus();
}

$("#createTeamCollection").addEventListener("click", () => {
  openCollectionDialog();
});
$("#createReportCollection").addEventListener("click", () => {
  openCollectionDialog(selectedTeam()?.datasetId ?? null);
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
        datasetId: collectionCreateDatasetId
      })
    });
    state.teamCollections = response.collections;
    state.activeCollectionId = response.collection.id;
    localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, state.activeCollectionId);
    loadStoredTeamWorkspace();
    renderCollectionControls();
    renderTeamList();
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
});
$("#scoutStage").addEventListener("click", () => {
  showView("intake");
});
$("#reportsStage").addEventListener("click", () => {
  renderReportsTeamList();
  showView("reports");
});
$("#matchCardsStage").addEventListener("click", () => {
  openMatchCardsWorkspace();
});
$("#matchCardsWorkspace").addEventListener("submit", event => {
  if (event.target.id !== "matchCardCreateForm") return;
  event.preventDefault();
  void createMatchCardFromForm(event.target);
});
$("#matchCardsWorkspace").addEventListener("change", event => {
  const target = event.target;
  if (target.matches('#matchCardCreateForm [name="ourTeamId"]')) {
    const opponentSelect = $("#matchCardCreateForm [name=opponentTeamId]");
    opponentSelect.innerHTML = matchCardOpponentOptions("", target.value);
    $("#matchCardCreateForm button[type=submit]").disabled =
      !target.value || !opponentSelect.value;
    return;
  }
  if (target.matches('#matchCardCreateForm [name="opponentTeamId"]')) {
    const ourTeamId = $("#matchCardCreateForm [name=ourTeamId]").value;
    $("#matchCardCreateForm button[type=submit]").disabled =
      !ourTeamId || !target.value || ourTeamId === target.value;
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
    renderMatchCardsHome();
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
void loadTeamCollections()
  .then(() => {
    loadStoredTeamWorkspace();
    return loadTeams();
  })
  .catch(error => {
    $("#teamList").innerHTML =
      `<p class="team-list-status error">${escapeHtml(error.message)}</p>`;
  });

if (state.jobId) {
  showView("progress");
  pollJob();
} else {
  showView("intake");
}
