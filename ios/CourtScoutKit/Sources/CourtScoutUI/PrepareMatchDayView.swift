import CourtScoutCore
import SwiftUI

/// Picks the opponents to save for the coming match day. The next match
/// date's opponents (a few days, to cover an event weekend) and any playoff
/// opponents are chosen to start with. When the round robin is published, a
/// chosen team without a scheduled match can be added to the schedule here
/// with its date, time, and location.
struct PrepareMatchDayView: View {
    /// A round-robin match to add for a chosen team. Off until switched on:
    /// a team chosen only to save offline is not necessarily one we play.
    private struct Entry {
        var add = false
        var start: Date
        var site: String
    }

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var season: Season
    var seasons: SeasonsModel
    @State private var chosen: Set<String> = []
    @State private var entries: [String: Entry] = [:]
    /// The last entry edited, which new entries start from.
    @State private var lastEntry: Entry?
    @State private var working = false
    @State private var error: String?

    private var opponents: [TeamSummary] {
        season.teams
            .filter { $0.id != season.ourTeam?.id }
            .sorted { $0.team.name.localizedCaseInsensitiveCompare($1.team.name) == .orderedAscending }
    }

    /// Teams with a match still to play already have a date.
    private func scheduledMatch(_ team: TeamSummary) -> SeasonMatch? {
        season.upcoming.first { $0.opponent?.id == team.id }
    }

    private var matchesToAdd: [(TeamSummary, Entry)] {
        opponents.compactMap { team in
            guard chosen.contains(team.id), scheduledMatch(team) == nil,
                  let entry = entries[team.id], entry.add else { return nil }
            return (team, entry)
        }
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
                        opponentRow(team)
                    }
                } header: {
                    HStack {
                        Text("Opponents")
                        Spacer()
                        Button(chosen.count == opponents.count ? "None" : "All") {
                            if chosen.count == opponents.count {
                                chosen = []
                            } else {
                                opponents.forEach(choose)
                            }
                        }
                        .font(.caption)
                    }
                } footer: {
                    Text("A chosen team with no match yet can be added to the schedule as a round-robin match. Saved copies stay on this phone until you prepare again or clear saved reports in Settings.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Palette.error) }
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
                    if working {
                        ProgressView()
                    } else {
                        Button("Save") { save() }
                            .disabled(chosen.isEmpty && season.ourTeam == nil)
                    }
                }
            }
            .onAppear {
                matchDayTeams(season, today: Format.today()).forEach(choose)
            }
        }
    }

    @ViewBuilder
    private func opponentRow(_ team: TeamSummary) -> some View {
        let isChosen = chosen.contains(team.id)
        Button {
            if isChosen { chosen.remove(team.id) } else { choose(team) }
        } label: {
            HStack {
                Image(systemName: isChosen ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isChosen ? Palette.brand : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(team.team.name).foregroundStyle(.primary)
                    if let note = note(for: team) {
                        Text(note).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        if isChosen, scheduledMatch(team) == nil, let entry = entries[team.id] {
            Toggle("Add to schedule", isOn: addBinding(team.id))
                .font(.subheadline)
            if entry.add {
                DatePicker("Starts", selection: binding(team.id, \.start))
                    .font(.subheadline)
                TextField("Location", text: binding(team.id, \.site))
                    .font(.subheadline)
            }
        }
    }

    /// Switching a team on starts it from the entry edited last, since an
    /// event is usually one venue over a few days: only the time changes.
    private func addBinding(_ teamId: String) -> Binding<Bool> {
        Binding(
            get: { entries[teamId]!.add },
            set: { on in
                if on, let last = lastEntry {
                    entries[teamId]!.start = last.start
                    if entries[teamId]!.site.isEmpty { entries[teamId]!.site = last.site }
                }
                entries[teamId]!.add = on
                if on { lastEntry = entries[teamId] }
            }
        )
    }

    private func binding<Value>(_ teamId: String, _ path: WritableKeyPath<Entry, Value>) -> Binding<Value> {
        Binding(
            get: { entries[teamId]![keyPath: path] },
            set: {
                entries[teamId]![keyPath: path] = $0
                lastEntry = entries[teamId]
            }
        )
    }

    /// Chooses a team; one with no match yet starts an entry from the last
    /// one edited, since an event is usually one venue over a few days.
    private func choose(_ team: TeamSummary) {
        chosen.insert(team.id)
        guard scheduledMatch(team) == nil, entries[team.id] == nil else { return }
        let site = lastEntry?.site ?? season.matches.last(where: { $0.match.site != nil })?.match.site ?? ""
        let start = lastEntry?.start ?? Calendar.current.date(
            bySettingHour: 8, minute: 0, second: 0, of: .now.addingTimeInterval(86_400)
        ) ?? .now
        entries[team.id] = Entry(start: start, site: site)
    }

    /// When the team is next played, or that it is a playoff opponent.
    private func note(for team: TeamSummary) -> String? {
        if let match = scheduledMatch(team) {
            return [match.match.round, Format.day(match.match.date), match.match.time, match.match.site]
                .compactMap { $0 }.joined(separator: " · ")
        }
        if season.playoffOpponents.contains(where: { $0.team?.id == team.id }) { return "Playoff opponent" }
        return nil
    }

    /// Adds the new round-robin matches, then saves everything offline in the
    /// background while the season shows progress.
    private func save() {
        let ids = opponents.map(\.id).filter(chosen.contains)
        let adds = matchesToAdd
        Task {
            working = true
            defer { working = false }
            for (team, entry) in adds {
                do {
                    try await seasons.addMatch(NewScheduledMatch(
                        ourTeamId: season.ourTeam?.id,
                        opponentTeamId: team.id,
                        opponentUrl: nil,
                        opponentName: team.team.name,
                        round: "Round robin",
                        date: ScheduleFormat.day(entry.start),
                        time: ScheduleFormat.time(entry.start),
                        site: entry.site.trimmingCharacters(in: .whitespaces).isEmpty
                            ? nil : entry.site.trimmingCharacters(in: .whitespaces)
                    ), to: season.collection, repository: app.repository)
                    entries[team.id]?.add = false
                } catch {
                    self.error = "\(team.team.name): \(NewSeasonModel.message(for: error))"
                    return
                }
            }
            Task { await seasons.prepare(season, teamIds: ids, repository: app.repository) }
            dismiss()
        }
    }
}
