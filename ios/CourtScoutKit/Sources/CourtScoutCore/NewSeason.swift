import Foundation

/// `POST /api/team-preview` for a home team: who the team is and how many
/// league opponents a new season would gather.
public struct TeamPreview: Codable, Hashable, Sendable {
    public var teamUrl: String
    public var team: Team
    public var rosterSize: Int
    public var leagueTeams: [LeagueTeam]
    public var leagueSchedule: [ScheduledMatch]

    /// Opponents other than the team itself, as the server gathers them.
    public var opponentCount: Int {
        let own = teamProfileKey(teamUrl)
        return Set(leagueTeams.compactMap { teamProfileKey($0.url) }.filter { $0 != own }).count
    }
}

/// `POST /api/jobs` and `GET /api/jobs/:id`. Jobs live in the server's
/// memory, so a restarted server no longer knows them.
public struct CollectionJob: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var kind: String
    public var status: String
    public var phase: String
    public var progress: Int
    public var detail: String
    public var error: String?
    public var warning: String?
    public var eventCollectionId: String?
    public var discoveredOpponentCount: Int
    public var collectedTeamCount: Int

    public var isFinished: Bool { status == "complete" || status == "failed" }

    /// A job the server no longer knows (it restarted), shown as stopped.
    public static func lost(id: String, collectionId: String, last: CollectionJob?) -> CollectionJob {
        CollectionJob(
            id: id, kind: "league-collection", status: "failed", phase: "failed",
            progress: last?.progress ?? 0,
            detail: "Gathering stopped",
            error: "The server restarted before gathering finished. Start the season again to gather the remaining teams.",
            warning: nil, eventCollectionId: collectionId,
            discoveredOpponentCount: last?.discoveredOpponentCount ?? 0,
            collectedTeamCount: last?.collectedTeamCount ?? 0
        )
    }
}

struct NewSeasonRequest: Encodable {
    var teamUrl: String
    var teamType = "home"
    /// Exact UTR needs the server's signed-in browser, so the phone asks for
    /// public ratings only.
    var utrMode = "public"
    var competitionLevel: String
    /// Gather into this season; nil lets the server find or create it.
    var eventCollectionId: String?
}

/// TennisRecord team profile links only; mirrors the server's own check so
/// mistakes show before a request.
public func normalizedTeamProfileLink(_ text: String) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
        let url = URL(string: trimmed),
        ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
        ["tennisrecord.com", "www.tennisrecord.com"].contains(url.host()?.lowercased() ?? ""),
        url.path().lowercased().hasSuffix("/teamprofile.aspx"),
        teamProfileKey(trimmed) != nil
    else { return nil }
    return trimmed
}

/// The season a home-team link already belongs to; starting it again
/// gathers into that season instead of creating another.
public func existingSeason(
    for teamUrl: String,
    teams: [TeamSummary],
    collections: [TeamCollection]
) -> TeamCollection? {
    guard let key = teamProfileKey(teamUrl) else { return nil }
    let datasetIds = Set(teams.filter { teamProfileKey($0.sourceUrl) == key }.map(\.datasetId))
    return collections.first { $0.teamDatasetIds.contains(where: datasetIds.contains) }
}

/// Default name for a new season, e.g. "2027 Mixed 18 & Over 7.0 — AYTC-LevelUp-Tong".
public func suggestedSeasonName(_ team: Team) -> String {
    let league = team.league.contains(String(team.season)) ? team.league : "\(team.season) \(team.league)"
    let withLevel = league.contains(team.level) ? league : "\(league) \(team.level)"
    return String("\(withLevel) — \(team.name)".prefix(80))
}

extension TeamRepository {
    // Starting a season changes data on the server, so these never fall back
    // to saved copies.

    public func previewHomeTeam(_ teamUrl: String) async throws -> TeamPreview {
        let body = try JSONEncoder().encode(["teamUrl": teamUrl, "teamType": "home"])
        return try await JSONDecoder().decode(TeamPreview.self, from: transport.post("api/team-preview", body: body))
    }

    public func startSeason(
        teamUrl: String,
        competitionLevel: String,
        into collectionId: String? = nil
    ) async throws -> CollectionJob {
        let body = try JSONEncoder().encode(NewSeasonRequest(
            teamUrl: teamUrl,
            competitionLevel: competitionLevel,
            eventCollectionId: collectionId
        ))
        return try await JSONDecoder().decode(CollectionJob.self, from: transport.post("api/jobs", body: body))
    }

    public func job(_ id: String) async throws -> CollectionJob {
        try await JSONDecoder().decode(CollectionJob.self, from: transport.get("api/jobs/\(id)", query: []))
    }

    public func renameSeason(_ collectionId: String, to name: String) async throws {
        let body = try JSONEncoder().encode(["name": name])
        _ = try await transport.patch("api/team-collections/\(collectionId)", body: body)
    }
}
