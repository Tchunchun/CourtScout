import CourtScoutCore
import SwiftUI

/// Picks the opponents to save for the coming match day: the next match
/// date's opponents (a few days, to cover an event weekend) and any playoff
/// opponents are chosen to start with.
struct PrepareMatchDayView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var season: Season
    var seasons: SeasonsModel
    @State private var chosen: Set<String> = []

    private var opponents: [TeamSummary] {
        season.teams
            .filter { $0.id != season.ourTeam?.id }
            .sorted { $0.team.name.localizedCaseInsensitiveCompare($1.team.name) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                if let ourTeam = season.ourTeam {
                    Section {
                        Label(ourTeam.team.name, systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.secondary)
                    } header: {
                        Text("Our team")
                    } footer: {
                        Text("Always saved, for its schedule and lineup.")
                    }
                }
                Section {
                    ForEach(opponents) { team in
                        Button {
                            if chosen.contains(team.id) { chosen.remove(team.id) } else { chosen.insert(team.id) }
                        } label: {
                            HStack {
                                Image(systemName: chosen.contains(team.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(chosen.contains(team.id) ? Palette.brand : .secondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(team.team.name).foregroundStyle(.primary)
                                    if let note = note(for: team) {
                                        Text(note).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("Opponents")
                        Spacer()
                        Button(chosen.count == opponents.count ? "None" : "All") {
                            chosen = chosen.count == opponents.count ? [] : Set(opponents.map(\.id))
                        }
                        .font(.caption)
                    }
                } footer: {
                    Text("Each takes a few seconds. Saved copies stay on this phone until you prepare again or clear saved reports in Settings.")
                }
            }
            .navigationTitle("Prepare for match day")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let ids = opponents.map(\.id).filter(chosen.contains)
                        // Runs on after the sheet closes; the season shows progress.
                        Task { await seasons.prepare(season, teamIds: ids, repository: app.repository) }
                        dismiss()
                    }
                    .disabled(chosen.isEmpty && season.ourTeam == nil)
                }
            }
            .onAppear {
                chosen = Set(matchDayTeams(season, today: Format.today()).map(\.id))
            }
        }
    }

    /// When the team is next played, or that it is a playoff opponent.
    private func note(for team: TeamSummary) -> String? {
        if season.playoffOpponents.contains(where: { $0.team?.id == team.id }) { return "Playoff opponent" }
        if let match = season.upcoming.first(where: { $0.opponent?.id == team.id }), let date = match.match.date {
            return "Plays \(Format.day(date))"
        }
        return nil
    }
}
