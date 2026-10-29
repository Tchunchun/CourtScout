import Foundation

/// One event collection seen from Our team's side: who we are, who we play
/// and when, and which other teams were gathered for scouting.
public struct Season: Sendable {
    public enum OurTeamSource: Sendable { case confirmedSchedule, teamRoles, collectionDefault, thisDevice }
    public enum ScheduleSource: Sendable { case confirmed, tennisRecord, none }

    public var collection: TeamCollection
    public var teams: [TeamSummary]
    public var ourTeam: TeamSummary?
    public var ourTeamSource: OurTeamSource?
    public var scheduleSource: ScheduleSource
    public var matches: [SeasonMatch]
    /// Teams in the collection that are neither Our team, on the schedule,
    /// nor a playoff opponent.
    public var scoutingPool: [TeamSummary]
    /// Playoff opponents in the order they were added, with the gathered
    /// team once it is in the season.
    public var playoffOpponents: [PlayoffEntry]

    public var upcoming: [SeasonMatch] { matches.filter { $0.state == .upcoming } }
    /// Opponents on the schedule that were not gathered into the season.
    public var missingOpponentNames: [String] {
        Array(Set(matches.filter { $0.opponent == nil && $0.state != .cancelled }.map(\.opponentName))).sorted()
    }
    public var awaitingResult: [SeasonMatch] { matches.filter { $0.state == .awaitingResult } }
    public var completed: [SeasonMatch] { matches.filter { $0.state == .completed } }
    public var isCompleted: Bool {
        matches.contains { $0.state == .completed } &&
            matches.allSatisfy { $0.state == .completed || $0.state == .cancelled }
    }
    public var nextMatch: SeasonMatch? { upcoming.first }
}

public struct PlayoffEntry: Identifiable, Hashable, Sendable {
    public var opponent: TeamCollection.PlayoffOpponent
    public var team: TeamSummary?
    public var id: String { opponent.teamKey }
    public var name: String { team?.team.name ?? opponent.name ?? opponent.teamKey }
}

public struct SeasonMatch: Identifiable, Hashable, Sendable {
    public enum State: Sendable { case upcoming, awaitingResult, completed, cancelled }

    public var match: ScheduledMatch
    /// The opponent's gathered report, when the opponent was gathered.
    public var opponent: TeamSummary?
    public var state: State

    public var id: String { match.id }
    public var opponentName: String { opponent?.team.name ?? match.sourceOpponentName }
}

/// Our team's catalog id: the confirmed schedule wins, then a choice made on
/// this device that is not shared yet, then the team roles shared with the web
/// app, then the collection's saved Match Day default.
public func resolveOurTeam(
    collection: TeamCollection,
    teams: [TeamSummary],
    schedule: EventSchedule?,
    roles: TeamRoles? = nil,
    deviceChoice: String?
) -> (team: TeamSummary, source: Season.OurTeamSource)? {
    let members = teams.filter { collection.teamDatasetIds.contains($0.datasetId) }
    if let id = schedule?.ourTeamId, let team = members.first(where: { $0.id == id }) {
        return (team, .confirmedSchedule)
    }
    if let id = deviceChoice, let team = members.first(where: { $0.id == id }) {
        return (team, .thisDevice)
    }
    if let roles, roles.saved {
        // A saved choice of no Our team is still a choice.
        return roles.ourTeamId
            .flatMap { id in members.first { $0.id == id } }
            .map { ($0, .teamRoles) }
    }
    if let datasetId = collection.matchDayDefaults?.ourTeamDatasetId,
       let team = members.first(where: { $0.datasetId == datasetId }) {
        return (team, .collectionDefault)
    }
    return nil
}

/// TennisRecord team URLs differ in query order and encoding; compare by
/// team name and year.
public func teamProfileKey(_ url: String?) -> String? {
    guard let url, let items = URLComponents(string: url)?.queryItems else { return nil }
    // Same key as the server's teamProfileKey: trimmed, lowercased name.
    let name = items.first { $0.name.lowercased() == "teamname" }?.value?
        .trimmingCharacters(in: .whitespaces).lowercased()
    let year = items.first { $0.name.lowercased() == "year" }?.value
    guard let name else { return nil }
    return "\(name)|\(year ?? "")"
}

public func buildSeason(
    collection: TeamCollection,
    teams: [TeamSummary],
    schedule: EventSchedule?,
    ourTeamData: TeamData?,
    roles: TeamRoles? = nil,
    deviceChoice: String?,
    today: String
) -> Season {
    let members = teams.filter { collection.teamDatasetIds.contains($0.datasetId) }
    let ourTeam = resolveOurTeam(
        collection: collection, teams: teams, schedule: schedule, roles: roles, deviceChoice: deviceChoice
    )

    let rows: [ScheduledMatch]
    let source: Season.ScheduleSource
    if let schedule {
        (rows, source) = (schedule.matches, .confirmed)
    } else if let league = ourTeamData?.leagueSchedule, !league.isEmpty {
        (rows, source) = (league, .tennisRecord)
    } else {
        (rows, source) = ([], .none)
    }

    let byId = Dictionary(members.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let byProfile = Dictionary(
        members.compactMap { team in teamProfileKey(team.sourceUrl).map { ($0, team) } },
        uniquingKeysWith: { first, _ in first }
    )
    func opponent(for row: ScheduledMatch) -> TeamSummary? {
        if let id = row.linkedOpponentTeamId, let team = byId[id] { return team }
        if let key = teamProfileKey(row.sourceOpponentUrl), let team = byProfile[key] { return team }
        // An exact name is used only when it is unambiguous.
        let named = members.filter { $0.team.name.caseInsensitiveCompare(row.sourceOpponentName) == .orderedSame }
        return named.count == 1 ? named[0] : nil
    }

    let matches = rows.map { row -> SeasonMatch in
        let state: SeasonMatch.State
        switch row.status {
        case .completed: state = .completed
        case .cancelled: state = .cancelled
        default:
            // A past date still marked scheduled means the result was not collected yet.
            state = (row.date ?? today) < today ? .awaitingResult : .upcoming
        }
        return SeasonMatch(match: row, opponent: opponent(for: row), state: state)
    }
    .sorted { ($0.match.date ?? "9999") < ($1.match.date ?? "9999") }

    let playoffs = (collection.playoffOpponents ?? []).map { opponent in
        PlayoffEntry(opponent: opponent, team: members.first { teamProfileKey($0.sourceUrl) == opponent.teamKey })
    }
    let scheduledIds = Set(matches.compactMap { $0.opponent?.id })
        .union(playoffs.compactMap { $0.team?.id })
    let pool = members
        .filter { $0.id != ourTeam?.team.id && !scheduledIds.contains($0.id) }
        .sorted { $0.team.name.localizedCaseInsensitiveCompare($1.team.name) == .orderedAscending }

    return Season(
        collection: collection,
        teams: members,
        ourTeam: ourTeam?.team,
        ourTeamSource: ourTeam?.source,
        scheduleSource: source,
        matches: matches,
        scoutingPool: pool,
        playoffOpponents: playoffs
    )
}

/// Seasons newest first.
public func orderedSeasons(_ collections: [TeamCollection]) -> [TeamCollection] {
    collections.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
}
