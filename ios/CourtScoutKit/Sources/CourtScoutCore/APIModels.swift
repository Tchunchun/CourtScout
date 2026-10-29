@_exported import CourtScoutModels
import Foundation

// Response types for the existing /api/* routes. They declare only the fields
// the app shows; other keys in the responses are ignored.

/// `GET /api/teams`
public struct TeamCatalog: Codable, Hashable, Sendable {
    public var teams: [TeamSummary]
    public var defaultEligibilityScope: String
    public var eligibilityScopes: [String: EligibilityScopeInfo]

    /// Scopes in the order the web app offers them.
    public var orderedScopes: [String] {
        ["national", "sectional", "local"].filter { eligibilityScopes[$0] != nil }
    }
}

public struct EligibilityScopeInfo: Codable, Hashable, Sendable {
    public var label: String
}

public struct TeamSummary: Codable, Hashable, Identifiable, Sendable {
    /// Catalog id used by the other routes, e.g. `collections/<event>/<dataset>`.
    public var id: String
    public var datasetId: String
    public var team: Team
    public var generatedAt: String
    public var collectionStage: String
    public var rosterSize: Int
    public var matchCount: Int
    public var sourceUrl: String?
    public var finalReportReady: Bool?
    public var reportAvailable: Bool?
}

/// `GET /api/team-collections`
public struct TeamCollectionList: Codable, Hashable, Sendable {
    public var collections: [TeamCollection]
}

public struct TeamCollection: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var competitionLevel: String?
    public var teamDatasetIds: [String]
    public var matchDayDefaults: MatchDayDefaults?
    public var createdAt: String?

    public struct MatchDayDefaults: Codable, Hashable, Sendable {
        public var ourTeamDatasetId: String?
    }
}

/// `GET /api/event-schedules/:collectionId`
public struct EventScheduleResponse: Codable, Hashable, Sendable {
    public var schedule: EventSchedule?
}

/// A season's confirmed schedule, as confirmed in the web app.
public struct EventSchedule: Codable, Hashable, Sendable {
    public var collectionId: String
    /// Catalog id of Our team.
    public var ourTeamId: String
    public var eventType: String?
    public var eligibilityScope: String?
    public var matches: [ScheduledMatch]
}

/// `GET /api/analysis?team=&eligibility=`
public struct TeamAnalysis: Codable, Hashable, Sendable {
    public var analysisVersion: String
    public var generatedAt: String
    public var summary: Summary
    public var eligibility: Eligibility
    public var lineupPredictions: LineupPredictions
    public var disclosures: Disclosures

    public struct Summary: Codable, Hashable, Sendable {
        public var rosterSize: Int
        public var matches: Int
        public var teamRecord: WinLoss
        public var courtRecord: WinLoss
    }

    public struct Eligibility: Codable, Hashable, Sendable {
        public var scope: String
        public var label: String
        public var summary: EligibilitySummary
        public var players: [EligibilityPlayer]
    }

    public struct EligibilitySummary: Codable, Hashable, Sendable {
        public var rosterSize: Int
        public var eligible: Int
        public var ineligible: Int
        public var unavailable: Int
        public var unknown: Int
    }

    public struct EligibilityPlayer: Codable, Hashable, Identifiable, Sendable {
        public var name: String
        public var ntrpLevel: String?
        public var ntrpType: String?
        public var status: String
        public var countedMatches: Int?
        public var matchesRequired: Int?
        public var matchesNeeded: Int?
        public var dr: Double?
        public var utr: PlayerUTR?
        public var role: String?
        public var standoutNote: String?
        public var primaryPartner: Partner?

        public var id: String { name }
    }

    public struct PlayerUTR: Codable, Hashable, Sendable {
        public var singles: Rating?
        public var doubles: Rating?
    }

    public struct Partner: Codable, Hashable, Sendable {
        public var name: String
        public var appearances: Int
    }

    public struct LineupPredictions: Codable, Hashable, Sendable {
        public var summary: LineupSummary
        public var methodology: String?
        public var predictions: [LineupPrediction]
    }

    public struct LineupSummary: Codable, Hashable, Sendable {
        public var predictionsGenerated: Int
        public var matchesAnalyzed: Int
        public var courts: [String]
        public var eligiblePlayers: Int?
        public var excludedPlayers: Int?
    }

    public struct LineupPrediction: Codable, Hashable, Identifiable, Sendable {
        public var rank: Int
        public var confidence: String
        public var historicalSupport: Int
        public var observedTogether: Int
        public var lines: [LineupLine]

        public var id: Int { rank }
    }

    public struct LineupLine: Codable, Hashable, Identifiable, Sendable {
        public var court: String
        public var players: [String]
        public var appearances: Int
        public var record: WinLoss
        public var usageShare: Double?
        public var lastUsedDate: String?

        public var id: String { court }
    }

    public struct Disclosures: Codable, Hashable, Sendable {
        public var warnings: [String]
    }
}

public struct WinLoss: Codable, Hashable, Sendable {
    public var wins: Int
    public var losses: Int
    public var ties: Int?
    public var unknown: Int?
    public var decisions: Int?
    public var winRate: Double?

    public var display: String {
        (ties ?? 0) > 0 ? "\(wins)–\(losses)–\(ties ?? 0)" : "\(wins)–\(losses)"
    }
}
