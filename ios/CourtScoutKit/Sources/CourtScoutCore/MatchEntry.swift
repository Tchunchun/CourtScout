import Foundation

/// Rounds a match can be added for, by season level: a local season's
/// knockout playoffs, a Sectionals round robin and final, or a Nationals
/// round robin, semifinal, and final.
public func matchRounds(level: String?) -> [String] {
    switch level {
    case "sectional": ["Round robin", "Final"]
    case "national": ["Round robin", "Semifinal", "Final"]
    default: ["Playoff", "Playoff final"]
    }
}

/// Matches added one at a time can be removed again; imported ones cannot.
public let matchEntrySource = "manual_entry"

/// `POST /api/event-schedules/:collectionId/matches`
public struct ScheduleMatchAdded: Codable, Hashable, Sendable {
    public var schedule: EventSchedule
    public var match: ScheduledMatch
    /// Gathering or refreshing an opponent named by link.
    public var job: CollectionJob?
}

public struct NewScheduledMatch: Encodable, Sendable {
    public var ourTeamId: String?
    /// A team already in the season, or else a TennisRecord link.
    public var opponentTeamId: String?
    public var opponentUrl: String?
    public var opponentName: String?
    public var round: String
    /// YYYY-MM-DD.
    public var date: String
    /// As schedules show it, such as "7:45 PM".
    public var time: String?
    public var site: String?

    public init(
        ourTeamId: String?, opponentTeamId: String?, opponentUrl: String?, opponentName: String?,
        round: String, date: String, time: String?, site: String?
    ) {
        self.ourTeamId = ourTeamId
        self.opponentTeamId = opponentTeamId
        self.opponentUrl = opponentUrl
        self.opponentName = opponentName
        self.round = round
        self.date = date
        self.time = time
        self.site = site
    }
}

extension TeamRepository {
    // Change the server's schedule, so they never fall back to saved copies.

    public func addMatch(_ match: NewScheduledMatch, to collectionId: String) async throws -> ScheduleMatchAdded {
        try await JSONDecoder().decode(
            ScheduleMatchAdded.self,
            from: transport.post("api/event-schedules/\(collectionId)/matches", body: JSONEncoder().encode(match))
        )
    }

    public func removeMatch(_ matchId: String, from collectionId: String) async throws {
        let id = matchId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? matchId
        _ = try await transport.delete("api/event-schedules/\(collectionId)/matches/\(id)", query: [])
    }
}
