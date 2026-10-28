import CourtScoutCore
import SwiftUI

enum Route: Hashable {
    case season(TeamCollection)
    case team(TeamSummary)
    case allTeams
}

/// Home: one card per season (event collection), newest first.
struct SeasonsView: View {
    @Environment(AppModel.self) private var app
    @State private var model = SeasonsModel()
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Seasons")
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .season(let collection):
                        SeasonView(collection: collection, seasons: model)
                    case .team(let summary):
                        TeamDetailView(summary: summary, scopes: model.catalog?.eligibilityScopes ?? [:])
                    case .allTeams:
                        AllTeamsView(catalog: model.catalog, collections: model.collections)
                    }
                }
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        NavigationLink(value: Route.allTeams) {
                            Label("Find a team", systemImage: "magnifyingglass")
                        }
                        Button {
                            showingSettings = true
                        } label: {
                            Label("Settings", systemImage: "gearshape")
                        }
                    }
                }
                .sheet(isPresented: $showingSettings) {
                    SettingsView()
                }
        }
        .task(id: app.generation) {
            await model.load(app.repository)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let error = app.configurationError {
            LoadFailedView(message: error) { showingSettings = true }
        } else if case .failed(let message) = model.phase, model.catalog == nil {
            LoadFailedView(message: message) { Task { await model.load(app.repository) } }
        } else if model.catalog != nil {
            List {
                if let offlineSince = model.offlineSince {
                    OfflineBanner(savedAt: offlineSince)
                        .listRowSeparator(.hidden)
                }
                ForEach(model.seasons) { collection in
                    NavigationLink(value: Route.season(collection)) {
                        SeasonRow(collection: collection, season: model.summary(for: collection))
                    }
                }
            }
            .refreshable { await model.load(app.repository) }
            .overlay {
                if model.seasons.isEmpty {
                    ContentUnavailableView(
                        "No seasons yet",
                        systemImage: "calendar.badge.plus",
                        description: Text("Start a season in the web app by looking up your team’s TennisRecord profile. Its league opponents are gathered into one season.")
                    )
                }
            }
        } else {
            ProgressView("Loading seasons…")
        }
    }
}

struct SeasonRow: View {
    var collection: TeamCollection
    var season: Season?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            LevelBadge(level: collection.competitionLevel)
            Text(collection.name).font(.headline)
            if let ourTeam = season?.ourTeam {
                Label(ourTeam.team.name, systemImage: "person.3.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.brand)
                    .lineLimit(1)
            } else {
                Label("Our team not set", systemImage: "person.crop.circle.badge.questionmark")
                    .font(.subheadline)
                    .foregroundStyle(Palette.warning)
            }
            Group {
                if let next = season?.nextMatch {
                    Text("Next: vs \(next.opponentName) · \(Format.day(next.match.date))")
                } else {
                    Text(Format.count(collection.teamDatasetIds.count, "team"))
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .padding(.vertical, 3)
    }
}

struct LevelBadge: View {
    var level: String?

    var body: some View {
        switch level {
        case "national": Badge(text: "NATIONALS", color: Palette.warning)
        case "sectional": Badge(text: "SECTIONALS", color: Palette.accent)
        case "local": Badge(text: "LOCAL", color: Palette.brand)
        default: Badge(text: (level ?? "Event").uppercased(), color: .secondary)
        }
    }
}

/// One season: Our team, the schedule, and the rest of the gathered teams.
struct SeasonView: View {
    @Environment(AppModel.self) private var app
    @State private var model: SeasonModel
    private var seasons: SeasonsModel

    init(collection: TeamCollection, seasons: SeasonsModel) {
        _model = State(initialValue: SeasonModel(collection: collection))
        self.seasons = seasons
    }

    var body: some View {
        Group {
            if let season = model.season {
                list(season)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(model.collection.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: app.generation) {
            await model.load(app.repository, seasons: seasons)
        }
        .refreshable {
            await seasons.load(app.repository)
            await model.load(app.repository, seasons: seasons)
        }
    }

    private func list(_ season: Season) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    LevelBadge(level: season.collection.competitionLevel)
                    Text(season.collection.name).font(.title2.weight(.bold))
                    Text("\(Format.count(season.teams.count, "team")) gathered")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }

            ourTeamSection(season)

            if let next = season.nextMatch {
                Section("Next match") {
                    NextMatchCard(entry: next)
                }
            }
            if season.upcoming.count > 1 {
                Section("Upcoming") {
                    ForEach(season.upcoming.dropFirst()) { MatchRow(entry: $0) }
                }
            }
            if !season.awaitingResult.isEmpty {
                Section {
                    ForEach(season.awaitingResult) { MatchRow(entry: $0) }
                } header: {
                    Text("Result not collected yet")
                } footer: {
                    Text("These dates have passed but no score has been gathered. Refresh the team in the web app to pull results.")
                }
            }
            if !season.completed.isEmpty {
                Section("Completed") {
                    ForEach(season.completed.reversed()) { MatchRow(entry: $0) }
                }
            }
            scheduleNote(season)

            if !season.scoutingPool.isEmpty {
                Section {
                    ForEach(season.scoutingPool) { summary in
                        NavigationLink(value: Route.team(summary)) { TeamRow(summary: summary) }
                    }
                } header: {
                    Text(season.matches.isEmpty
                         ? "Teams in this event (\(season.scoutingPool.count))"
                         : "Scouting pool (\(season.scoutingPool.count))")
                }
            }
        }
    }

    @ViewBuilder
    private func ourTeamSection(_ season: Season) -> some View {
        Section {
            if let ourTeam = season.ourTeam {
                NavigationLink(value: Route.team(ourTeam)) { TeamRow(summary: ourTeam) }
            }
            if season.ourTeamSource != .confirmedSchedule && season.ourTeamSource != .collectionDefault {
                Menu {
                    ForEach(season.teams.sorted { $0.team.name < $1.team.name }) { team in
                        Button(team.team.name) { choose(team.id) }
                    }
                    if season.ourTeam != nil {
                        Button("Clear", role: .destructive) { choose(nil) }
                    }
                } label: {
                    Label(season.ourTeam == nil ? "Choose Our team" : "Change Our team",
                          systemImage: "person.crop.circle.badge.checkmark")
                }
            }
        } header: {
            Text("Our team")
        } footer: {
            switch season.ourTeamSource {
            case .thisDevice: Text("Saved on this device only.")
            case .collectionDefault: Text("From Match Day setup in the web app.")
            case .confirmedSchedule: Text("From the confirmed schedule.")
            case nil: Text("Choose your team to see your schedule and opponents.")
            }
        }
    }

    @ViewBuilder
    private func scheduleNote(_ season: Season) -> some View {
        switch season.scheduleSource {
        case .confirmed:
            EmptyView()
        case .tennisRecord:
            Section {} footer: {
                Text("Schedule from Our team’s TennisRecord page; it has not been confirmed in the web app.")
            }
        case .none:
            Section {} footer: {
                Text(season.ourTeam == nil
                     ? "No schedule yet."
                     : "No schedule yet. Confirm or import one on the web app’s Match Day page.")
            }
        }
    }

    private func choose(_ teamId: String?) {
        seasons.setDeviceOurTeam(teamId, for: model.collection.id)
        Task { await model.load(app.repository, seasons: seasons) }
    }
}

struct NextMatchCard: View {
    var entry: SeasonMatch

    var body: some View {
        let content = VStack(alignment: .leading, spacing: 6) {
            Text([Format.day(entry.match.date), entry.match.time].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.brand)
            Text("vs \(entry.opponentName)").font(.title3.weight(.bold))
            if let site = entry.match.site {
                Label(site, systemImage: "mappin.and.ellipse")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if entry.opponent == nil {
                Text("Opponent not gathered yet").font(.footnote).foregroundStyle(Palette.warning)
            }
        }
        .padding(.vertical, 4)
        if let opponent = entry.opponent {
            NavigationLink(value: Route.team(opponent)) { content }
        } else {
            content
        }
    }
}

struct MatchRow: View {
    var entry: SeasonMatch

    var body: some View {
        let content = HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("vs \(entry.opponentName)").font(.subheadline.weight(.semibold)).lineLimit(2)
                Text([Format.day(entry.match.date), entry.match.time, entry.match.site]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if entry.state == .completed, let result = entry.match.sourceResult {
                Text(result.replacingOccurrences(of: "-", with: "–"))
                    .font(.headline)
                    .monospacedDigit()
            }
        }
        if let opponent = entry.opponent {
            NavigationLink(value: Route.team(opponent)) { content }
        } else {
            content
        }
    }
}
