const REPORT_TABS = new Set(["roster", "opponents", "matches", "sources"]);
const ANALYSIS_TABS = new Set(["eligibility", "singles", "doubles", "lineups"]);

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseCourtScoutRoute(hash) {
  const segments = String(hash ?? "")
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
  const [view, encodedId, requestedTab] = segments;
  const id = encodedId ? decodeSegment(encodedId) : null;

  if (!view || view === "scout") return { view: "scout" };
  if (view === "reports") return { view: "reports" };
  if (view === "cards") return { view: "cards" };
  if (view === "team" && id) {
    return {
      view: "team",
      teamId: id,
      tab: REPORT_TABS.has(requestedTab) ? requestedTab : "roster"
    };
  }
  if (view === "analysis-setup" && id) {
    return { view: "analysis-setup", teamId: id };
  }
  if (view === "analysis" && id) {
    return {
      view: "analysis",
      teamId: id,
      tab: ANALYSIS_TABS.has(requestedTab) ? requestedTab : "eligibility"
    };
  }
  if (view === "card" && id) return { view: "card", cardId: id };
  return { view: "scout" };
}

export function courtScoutRouteHash(route) {
  if (route.view === "reports") return "#/reports";
  if (route.view === "cards") return "#/cards";
  if (route.view === "team" && route.teamId) {
    const tab = REPORT_TABS.has(route.tab) ? route.tab : "roster";
    return `#/team/${encodeURIComponent(route.teamId)}/${tab}`;
  }
  if (route.view === "analysis-setup" && route.teamId) {
    return `#/analysis-setup/${encodeURIComponent(route.teamId)}`;
  }
  if (route.view === "analysis" && route.teamId) {
    const tab = ANALYSIS_TABS.has(route.tab) ? route.tab : "eligibility";
    return `#/analysis/${encodeURIComponent(route.teamId)}/${tab}`;
  }
  if (route.view === "card" && route.cardId) {
    return `#/card/${encodeURIComponent(route.cardId)}`;
  }
  return "#/scout";
}
