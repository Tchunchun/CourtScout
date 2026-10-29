import CourtScoutCore
import SwiftUI

/// Dates and times as schedules store them: "2026-08-14" and "7:45 PM".
enum ScheduleFormat {
    static func day(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(timeZone: .current).year().month().day())
    }

    /// A plain space before AM/PM, as imported schedules have it; the system
    /// style inserts a narrow no-break space.
    static func time(_ date: Date) -> String {
        timeFormatter.string(from: date)
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "h:mm a"
        return formatter
    }()
}

/// Adds one match as it is announced: a round-robin match or a knockout
/// round once the bracket names the opponent. Opponents come from the
/// season's teams; only a team shared from Safari (`initialLink`) can be one
/// the season does not have yet, and is gathered.
struct AddMatchView: View {
    /// A team from the season, or the team shared from Safari.
    private enum OpponentSource { case season, link }

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var seasons: SeasonsModel
    /// The season to add to; nil lets the user pick one (the share sheet).
    var collection: TeamCollection?
    var initialLink: String?
    var onAdded: (TeamCollection) -> Void = { _ in }
    var onClose: (() -> Void)?

    @State private var seasonId: String?
    @State private var round = ""
    @State private var source = OpponentSource.season
    @State private var opponentId: String?
    @State private var link = OpponentLinkModel()
    @State private var date = Date.now
    @State private var time = Date.now
    @State private var site = ""
    @State private var working = false
    @State private var error: String?

    private var chosenCollection: TeamCollection? {
        collection ?? seasons.seasons.first { $0.id == seasonId } ?? seasons.seasons.first
    }

    private var season: Season? { chosenCollection.flatMap(seasons.summary(for:)) }

    private var seasonOpponents: [TeamSummary] {
        (season?.teams ?? [])
            .filter { $0.id != season?.ourTeam?.id }
            .sorted { $0.team.name.localizedCaseInsensitiveCompare($1.team.name) == .orderedAscending }
    }

    private var ready: Bool {
        guard chosenCollection != nil, !round.isEmpty else { return false }
        return source == .season ? opponentId != nil : link.preview != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                if collection == nil {
                    Section("Season") {
                        Picker("Season", selection: Binding(get: { chosenCollection?.id }, set: { seasonId = $0 })) {
                            ForEach(seasons.seasons) { Text($0.name).tag(Optional($0.id)) }
                        }
                    }
                }
                Section {
                    Picker("Round", selection: $round) {
                        ForEach(matchRounds(level: chosenCollection?.competitionLevel), id: \.self) { Text($0).tag($0) }
                    }
                }
                opponentSection
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                    TextField("Location", text: $site)
                } header: {
                    Text("When and where")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Palette.error) }
                }
            }
            .navigationTitle("Add match")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { close() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if working || link.working {
                        ProgressView()
                    } else {
                        Button("Add") { add() }.disabled(!ready)
                    }
                }
            }
            .onAppear(perform: setUp)
            .onChange(of: chosenCollection?.id) { setUp() }
            .task {
                guard let initialLink, link.link.isEmpty else { return }
                link.link = initialLink
                if link.validLink != nil { await link.loadPreview(app.repository) }
                selectSharedTeamIfInSeason()
            }
        }
    }

    @ViewBuilder
    private var opponentSection: some View {
        Section {
            if source == .season {
                Picker("Opponent", selection: $opponentId) {
                    Text("Choose").tag(String?.none)
                    ForEach(seasonOpponents) { Text($0.team.name).tag(Optional($0.id)) }
                }
            } else {
                if let preview = link.preview {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(preview.team.name).font(.headline)
                        Text(preview.team.section).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let message = link.error {
                    Text(message).font(.caption).foregroundStyle(Palette.error)
                }
            }
        } header: {
            Text("Opponent")
        } footer: {
            if source == .link {
                Text("The shared team. If this season does not have it yet, it is gathered with public UTR, usually in a minute or two; if it does, its latest matches are refreshed.")
            } else {
                Text("Opponents are the teams gathered into this season.")
            }
        }
    }

    private func setUp() {
        let rounds = matchRounds(level: chosenCollection?.competitionLevel)
        if !rounds.contains(round) { round = rounds.first ?? "" }
        if initialLink != nil {
            source = .link
            selectSharedTeamIfInSeason()
        }
        // An event is usually one venue: start from the last match's site.
        if site.isEmpty, let last = season?.matches.last(where: { $0.match.site != nil })?.match.site {
            site = last
        }
    }

    /// A shared team the season already has is simply chosen from it.
    private func selectSharedTeamIfInSeason() {
        guard let key = teamProfileKey(link.preview?.teamUrl ?? initialLink),
              let team = seasonOpponents.first(where: { teamProfileKey($0.sourceUrl) == key })
        else { return }
        source = .season
        opponentId = team.id
    }

    private func add() {
        guard let collection = chosenCollection else { return }
        let opponent = seasonOpponents.first { $0.id == opponentId }
        let match = NewScheduledMatch(
            ourTeamId: season?.ourTeam?.id,
            opponentTeamId: source == .season ? opponent?.id : nil,
            opponentUrl: source == .link ? link.preview?.teamUrl : nil,
            opponentName: source == .link ? link.preview?.team.name : opponent?.team.name,
            round: round,
            date: ScheduleFormat.day(date),
            time: ScheduleFormat.time(time),
            site: site.trimmingCharacters(in: .whitespaces).isEmpty ? nil : site.trimmingCharacters(in: .whitespaces)
        )
        Task {
            working = true
            defer { working = false }
            do {
                try await seasons.addMatch(match, to: collection, repository: app.repository)
                onAdded(collection)
                close()
            } catch {
                self.error = NewSeasonModel.message(for: error)
            }
        }
    }

    private func close() {
        if let onClose { onClose() } else { dismiss() }
    }
}
