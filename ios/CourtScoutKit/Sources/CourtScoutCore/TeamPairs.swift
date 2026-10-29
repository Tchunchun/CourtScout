import Foundation

/// A captain's saved doubles pairs plus pairings suggested from match history.
public struct TeamPairs: Codable, Hashable, Sendable {
    public var teamId: String
    public var saved: Bool
    public var pairs: [Pair]
    public var suggestions: [Pair]
    public var revision: Int
    public var updatedAt: String?

    public struct Pair: Codable, Hashable, Identifiable, Sendable {
        public var players: [String]
        public var tag: String
        public var preferredCourt: String?
        public var appearances: Int
        public var wins: Int
        public var losses: Int
        public var suggested: Bool

        public var id: String { players.sorted().joined(separator: "\u{0}") }

        public init(
            players: [String],
            tag: String,
            preferredCourt: String? = nil,
            appearances: Int = 0,
            wins: Int = 0,
            losses: Int = 0,
            suggested: Bool = false
        ) {
            self.players = players
            self.tag = tag
            self.preferredCourt = preferredCourt
            self.appearances = appearances
            self.wins = wins
            self.losses = losses
            self.suggested = suggested
        }
    }
}

private struct TeamPairsUpdate: Encodable {
    struct Pair: Encodable {
        var players: [String]
        var tag: String
        var preferredCourt: String?
    }

    var pairs: [Pair]
    var baseRevision: Int
}

extension TeamRepository {
    /// Pairs always come from the server; offline use comes with feature 012.
    public func teamPairs(_ teamId: String) async throws -> Loaded<TeamPairs> {
        let data = try await transport.get("api/team-pairs/\(teamId)", query: [])
        return Loaded(value: try JSONDecoder().decode(TeamPairs.self, from: data), source: .live, savedAt: .now)
    }

    /// Saving needs the server; it never falls back to an offline copy.
    public func saveTeamPairs(_ value: TeamPairs) async throws -> TeamPairs {
        let body = try JSONEncoder().encode(TeamPairsUpdate(
            pairs: value.pairs.map {
                TeamPairsUpdate.Pair(
                    players: $0.players,
                    tag: $0.tag,
                    preferredCourt: $0.preferredCourt
                )
            },
            baseRevision: value.revision
        ))
        return try await JSONDecoder().decode(
            TeamPairs.self,
            from: transport.put("api/team-pairs/\(value.teamId)", body: body)
        )
    }
}
