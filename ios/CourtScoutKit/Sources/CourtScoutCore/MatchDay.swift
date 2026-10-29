import Foundation

/// Opponents to save for the coming match day: every scheduled opponent from
/// the next match date through `windowDays` after it (a Sectionals or
/// Nationals weekend plays several), plus the playoff opponents. A season
/// with no schedule could meet any of its teams, so all of them.
public func matchDayTeams(_ season: Season, today: String, windowDays: Int = 3) -> [TeamSummary] {
    var teams: [TeamSummary] = []
    if season.matches.isEmpty {
        teams = season.teams.filter { $0.id != season.ourTeam?.id }
    } else {
        let upcoming = season.matches.filter { $0.state == .upcoming && ($0.match.date ?? "") >= today }
        if let first = upcoming.compactMap(\.match.date).min() {
            let last = addingDays(windowDays, to: first) ?? first
            teams = upcoming
                .filter { ($0.match.date ?? first) <= last }
                .compactMap(\.opponent)
        }
    }
    teams += season.playoffOpponents.compactMap(\.team)
    var seen = Set<String>()
    return teams.filter { seen.insert($0.id).inserted }
}

private func addingDays(_ days: Int, to day: String) -> String? {
    let format = Date.ISO8601FormatStyle().year().month().day()
    guard let date = try? Date(String(day.prefix(10)), strategy: format) else { return nil }
    return date.addingTimeInterval(Double(days) * 86_400).formatted(format)
}

extension TeamRepository {
    /// Saves everything a team's screens read offline: its dataset, report,
    /// and threat board at the team's own level, and, for an opponent, the
    /// matchup against Our team. Fails unless every piece came from the
    /// server, so a stale saved copy never counts as prepared.
    public func prepareTeam(_ teamId: String, ourTeamId: String?, eligibility: String?) async throws {
        try Self.requireLive(await teamData(teamId))
        try Self.requireLive(await analysis(teamId))
        try Self.requireLive(await threatBoard(teamId))
        if let ourTeamId, ourTeamId != teamId {
            try Self.requireLive(await matchup(ourTeamId: ourTeamId, opponentTeamId: teamId, eligibility: eligibility))
        }
    }

    private static func requireLive<Value>(_ loaded: Loaded<Value>) throws {
        if loaded.source == .offline { throw URLError(.notConnectedToInternet) }
    }
}
