import Foundation

// `POST /api/matchup`: Our lineup against the opponent's predicted lineups,
// court by court. The server reuses web/public/match-card.mjs, so these
// mirror its output.

struct MatchupRequest: Encodable {
    var ourTeamId: String
    var opponentTeamId: String
    var eligibility: String?
    var draft: [String: [String]]?
}

public struct Matchup: Codable, Hashable, Sendable {
    public var leagueFormat: String
    public var eligibilityScope: String?
    public var ourTeam: TeamRef
    public var opponentTeam: TeamRef
    public var courts: [CourtSlot]
    public var maxCombinedNtrp: Double?
    /// Court label → player names; an empty string is an open slot.
    public var draft: [String: [String]]
    public var suggestedDraft: [String: [String]]
    public var suggestedDraftSource: String
    public var validation: Validation
    public var ourPlayers: [OurPlayer]
    public var scenarios: [Scenario]
    public var challenges: [Challenge]
    public var scenarioCoverage: ScenarioCoverage
    public var overall: Overall?

    public struct TeamRef: Codable, Hashable, Sendable {
        public var datasetId: String
        public var name: String
    }

    public struct CourtSlot: Codable, Hashable, Identifiable, Sendable {
        public var court: String
        public var discipline: String
        public var players: Int
        public var id: String { court }
    }

    public struct Validation: Codable, Hashable, Sendable {
        public var complete: Bool
        public var selectedPlayers: Int
        public var requiredPlayers: Int
        public var duplicateNames: [String]
        public var unavailableNames: [String]
        public var invalidGenderCourts: [String]
        public var invalidNtrpCourts: [String]
        public var unresolvedNtrpCourts: [String]
        public var unresolvedGenderNames: [String]
        public var unresolvedNtrpNames: [String]
        public var valid: Bool
    }

    public struct OurPlayer: Codable, Hashable, Identifiable, Sendable {
        public var name: String
        public var status: String
        public var role: String?
        public var dr: Double?
        public var utrSingles: String
        public var utrDoubles: String
        public var gender: String?
        public var ntrpLevel: String?
        public var id: String { name }
    }

    public struct Scenario: Codable, Hashable, Identifiable, Sendable {
        public var rank: Int
        public var scenarioType: String?
        /// Rank on the team report's Likely lineups tab. Nil for ratings and
        /// reviewed tournament scenarios.
        public var historicalRank: Int?
        public var confidence: String?
        public var historicalSupport: Int
        public var observedTogether: Int
        public var unplayedPlayers: [String]
        public var lines: [Line]
        public var id: Int { rank }

        public struct Line: Codable, Hashable, Sendable {
            public var court: String
            public var players: [String]
            public var appearances: Int
        }
    }

    public struct Challenge: Codable, Hashable, Identifiable, Sendable {
        public var rank: Int
        public var scenarioType: String?
        public var comparisons: [Comparison]
        public var summary: Summary
        public var score: Double
        public var maxScore: Double
        public var scorePercent: Int
        public var pros: [String]
        public var risks: [String]
        /// What changes from the first scenario; nil for the first one.
        public var differences: Differences?
        public var id: Int { rank }

        public struct Differences: Codable, Hashable, Sendable {
            public var baseRank: Int
            public var changedCourts: [String]
            public var courts: [ChangedCourt]
            public var playersIn: [String]
            public var playersOut: [String]
            public var scoreDelta: Int
            public var read: String
        }

        public struct ChangedCourt: Codable, Hashable, Identifiable, Sendable {
            public var court: String
            public var opponentPlayers: [String]
            public var baseOpponentPlayers: [String]
            public var edge: String
            public var baseEdge: String?
            public var id: String { court }
        }

        public struct Summary: Codable, Hashable, Sendable {
            public var favorable: Int
            public var swing: Int
            public var challenging: Int
            public var limited: Int
            public var read: String
        }
    }

    public struct Comparison: Codable, Hashable, Identifiable, Sendable {
        public var court: String
        public var discipline: String
        public var ourPlayers: [String]
        public var opponentPlayers: [String]
        public var ours: Side
        public var opponent: Side
        public var margins: Margins
        /// favorable, swing, challenging, or limited.
        public var edge: String
        public var confidence: String
        public var id: String { court }

        public struct Side: Codable, Hashable, Sendable {
            public var dr: Double?
            public var utr: Double?
            public var players: [SidePlayer]
        }

        public struct SidePlayer: Codable, Hashable, Sendable {
            public var name: String
            public var dr: Double?
            public var utr: Double?
            public var utrDisplay: String
        }

        public struct Margins: Codable, Hashable, Sendable {
            public var dr: Double?
            public var utr: Double?
        }
    }

    public struct ScenarioCoverage: Codable, Hashable, Sendable {
        public var historicalPredictions: Int
        public var historicalScenarios: Int
        public var ratingCeiling: Bool
        public var opponentPlayersWithoutGender: Int
        public var opponentRosterSize: Int
    }

    public struct Overall: Codable, Hashable, Sendable {
        public var worstScorePercent: Int
        public var averageScorePercent: Int
    }
}

extension Matchup {
    /// Our player on a court slot, or nil for an open slot.
    public func player(court: String, slot: Int) -> String? {
        guard let players = draft[court], players.indices.contains(slot), !players[slot].isEmpty else {
            return nil
        }
        return players[slot]
    }

    /// The court a player is already on in this draft.
    public func court(of name: String) -> String? {
        courts.first { draft[$0.court]?.contains(name) == true }?.court
    }
}

/// Puts `name` on a court slot. A player already on another slot swaps with
/// whoever held the target slot, so nobody is listed twice.
public func assigning(
    _ name: String?,
    to court: String,
    slot: Int,
    in draft: [String: [String]]
) -> [String: [String]] {
    var draft = draft
    let previous = draft[court]?.indices.contains(slot) == true ? draft[court]![slot] : ""
    if let name, !name.isEmpty {
        for (otherCourt, players) in draft {
            if let index = players.firstIndex(of: name), !(otherCourt == court && index == slot) {
                draft[otherCourt]![index] = previous
            }
        }
    }
    if draft[court]?.indices.contains(slot) == true {
        draft[court]![slot] = name ?? ""
    }
    return draft
}
