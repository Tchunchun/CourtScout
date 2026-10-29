import Foundation

/// `POST /api/team-collections/:id/playoff-opponents`: the season with the
/// new playoff opponent, and the job gathering it (or refreshing it, when
/// the season already had the team).
public struct PlayoffOpponentAdded: Codable, Hashable, Sendable {
    public var collection: TeamCollection
    public var job: CollectionJob
    public var existingTeamId: String?
}

/// `POST /api/team-preview` for one team, without its league.
public struct OpponentPreview: Codable, Hashable, Sendable {
    public var teamUrl: String
    public var team: Team
    public var rosterSize: Int
}

extension TeamRepository {
    // Changes data on the server, so these never fall back to saved copies.

    public func previewOpponent(_ teamUrl: String) async throws -> OpponentPreview {
        let body = try JSONEncoder().encode(["teamUrl": teamUrl, "teamType": "opponent"])
        return try await JSONDecoder().decode(OpponentPreview.self, from: transport.post("api/team-preview", body: body))
    }

    public func addPlayoffOpponent(_ teamUrl: String, name: String?, to collectionId: String) async throws -> PlayoffOpponentAdded {
        var fields = ["teamUrl": teamUrl]
        fields["name"] = name
        let body = try JSONEncoder().encode(fields)
        return try await JSONDecoder().decode(
            PlayoffOpponentAdded.self,
            from: transport.post("api/team-collections/\(collectionId)/playoff-opponents", body: body)
        )
    }

    public func removePlayoffOpponent(_ teamKey: String, from collectionId: String) async throws {
        _ = try await transport.delete(
            "api/team-collections/\(collectionId)/playoff-opponents",
            query: [URLQueryItem(name: "team", value: teamKey)]
        )
    }
}
