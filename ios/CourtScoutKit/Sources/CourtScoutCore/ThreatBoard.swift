import Foundation

/// `GET /api/threat-board`: an opponent's likely players and pairs, whether
/// they stack their courts, and where the predictions rest on thin evidence.
public struct ThreatBoard: Codable, Hashable, Sendable {
    public var teamId: String
    public var team: Team
    public var eligibility: Eligibility
    public var retrievedAt: String?
    /// Available players first, strongest first.
    public var players: [Player]
    public var pairs: [Pair]
    public var stacking: [Stacking]
    public var predictions: [Prediction]
    public var coverage: [String]

    public struct Team: Codable, Hashable, Sendable {
        public var name: String
        public var section: String?
        public var level: String?
        public var leagueFormat: String?
    }

    public struct Eligibility: Codable, Hashable, Sendable {
        public var scope: String?
        public var label: String?
    }

    public struct Player: Codable, Hashable, Identifiable, Sendable {
        public var name: String
        public var gender: String?
        public var status: String
        public var available: Bool
        public var role: String?
        public var note: String?
        public var usualCourts: [String]
        public var appearances: Int
        public var postseasonAppearances: Int
        public var dr: Double?
        public var utr: UTR
        public var partner: Partner?

        public var id: String { name }
    }

    public struct UTR: Codable, Hashable, Sendable {
        public var singles: Rating
        public var doubles: Rating
        /// "exact", "public" (a masked band such as 3.xx), or "none".
        public var source: String
        public var retrievedAt: String?
        public var ageDays: Int?
    }

    public struct Rating: Codable, Hashable, Sendable {
        public var display: String
        public var value: Double?
        public var exact: Bool
    }

    public struct Partner: Codable, Hashable, Sendable {
        public var name: String
        public var appearances: Int
        public var record: WinLoss?
    }

    public struct Pair: Codable, Hashable, Identifiable, Sendable {
        public var players: [String]
        public var appearances: Int
        /// Most-used court first.
        public var courts: [String]
        public var record: WinLoss?
        public var drAverage: Double?

        public var id: String { players.joined(separator: "|") }
    }

    public struct Stacking: Codable, Hashable, Identifiable, Sendable {
        public var discipline: String
        public var matchesCompared: Int
        public var strongestOnTop: Int
        public var stacks: Bool
        public var usualStrongestCourt: String?
        public var note: String

        public var id: String { discipline }
    }

    public struct Prediction: Codable, Hashable, Identifiable, Sendable {
        public var rank: Int
        public var confidence: String
        public var historicalSupport: Int
        public var lines: [Line]

        public var id: Int { rank }
    }

    public struct Line: Codable, Hashable, Identifiable, Sendable {
        public var court: String
        public var players: [String]
        public var appearances: Int
        public var postseasonAppearances: Int
        public var record: WinLoss?
        public var lastUsedDate: String?
        /// Why this line is uncertain, if it is.
        public var gaps: [String]

        public var id: String { court }
    }
}

extension TeamRepository {
    /// With no scope, the server uses the team's own eligibility level.
    public func threatBoard(_ teamId: String, scope: String? = nil) async throws -> Loaded<ThreatBoard> {
        try await load(
            ThreatBoard.self,
            key: "threat-board-\(teamId)-\(scope ?? "team-default")",
            path: "api/threat-board",
            query: [URLQueryItem(name: "team", value: teamId)] +
                (scope.map { [URLQueryItem(name: "eligibility", value: $0)] } ?? [])
        )
    }
}
