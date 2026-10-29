import CourtScoutCore
import SwiftUI

enum Route: Hashable {
    case season(TeamCollection)
    case team(TeamSummary)
    case matchup(ourTeam: TeamSummary, opponent: TeamSummary, scope: String?)
    case allTeams
}

/// Home: one card per season (event collection), newest first.
struct SeasonsView: View {
    @Environment(AppModel.self) private var app
    @State private var model = SeasonsModel()
    @State private var showingSettings = false
    @State private var showingNewSeason = false

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
                    case .matchup(let ourTeam, let opponent, let scope):
                        MatchupView(ourTeam: ourTeam, opponent: opponent, scope: scope)
                    case .allTeams:
                        AllTeamsView(catalog: model.catalog, collections: model.collections)
                    }
                }
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button {
                            showingNewSeason = true
                        } label: {
                            Label("New season", systemImage: "plus")
                        }
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
                .sheet(isPresented: $showingNewSeason) {
                    NewSeasonView(seasons: model) { job, teamUrl, level in
                        model.track(job, teamUrl: teamUrl, competitionLevel: level)
                        Task { await model.load(app.repository) }
                    }
                }
        }
        .task(id: app.generation) {
            await model.load(app.repository)
        }
        .task(id: PollKey(generation: app.generation, running: model.hasRunningJobs)) {
            await followJobs()
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
                        SeasonRow(
                            collection: collection,
                            season: model.summary(for: collection),
                            job: model.jobs[collection.id]
                        )
                    }
                    .swipeActions {
                        if model.jobs[collection.id]?.isFinished == true {
                            Button("Dismiss") { model.dismissJob(for: collection.id) }
                        }
                    }
                }
            }
            .refreshable { await model.load(app.repository) }
            .overlay {
                if model.seasons.isEmpty {
                    ContentUnavailableView {
                        Label("No seasons yet", systemImage: "calendar.badge.plus")
                    } description: {
                        Text("Start with your team’s TennisRecord link. Court Scout gathers your team and every league opponent into one season.")
                    } actions: {
                        Button("New season") { showingNewSeason = true }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
        } else {
            ProgressView("Loading seasons…")
        }
    }
}

private struct PollKey: Hashable {
    var generation: Int
    var running: Bool
}

extension SeasonsView {
    /// Follows seasons the server is gathering, reloading as teams arrive.
    fileprivate func followJobs() async {
        // A job that ends restarts this task; the reload it asked for runs
        // on its own so that restart does not cancel it.
        let reload = { [model, app] in Task { await model.load(app.repository) } }
        if await model.refreshJobs(app.repository) { reload() }
        while model.hasRunningJobs, !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            if await model.refreshJobs(app.repository) { reload() }
        }
    }
}

struct SeasonRow: View {
    var collection: TeamCollection
    var season: Season?
    var job: CollectionJob?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            LevelBadge(level: collection.competitionLevel)
            Text(collection.name).font(.headline)
            if let ourTeam = season?.ourTeam {
                Label(ourTeam.team.name, systemImage: "person.3.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.brand)
                    .lineLimit(1)
            } else if let job, !job.isFinished {
                // Our team is set once the home team has been gathered.
                Label("Gathering teams", systemImage: "arrow.down.circle")
                    .font(.subheadline)
                    .foregroundStyle(Palette.brand)
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
            if let job {
                SeasonJobStatus(job: job).padding(.top, 2)
            }
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

            if let job = seasons.jobs[season.collection.id] {
                gatheringSection(job)
            }

            ourTeamSection(season)

            if let next = season.nextMatch {
                Section("Next match") {
                    NextMatchCard(entry: next, destination: prepare(next, in: season))
                    if let opponent = next.opponent {
                        NavigationLink(value: Route.team(opponent)) {
                            Label("Scout \(opponent.team.name)", systemImage: "doc.text.magnifyingglass")
                                .font(.subheadline)
                        }
                    }
                }
            }
            if season.upcoming.count > 1 {
                Section("Upcoming") {
                    ForEach(season.upcoming.dropFirst()) { MatchRow(entry: $0, destination: prepare($0, in: season)) }
                }
            }
            if !season.awaitingResult.isEmpty {
                Section {
                    ForEach(season.awaitingResult) { MatchRow(entry: $0, destination: prepare($0, in: season)) }
                } header: {
                    Text("Result not collected yet")
                } footer: {
                    Text("These dates have passed but no score has been gathered. Refresh the team in the web app to pull results.")
                }
            }
            if !season.completed.isEmpty {
                Section("Completed") {
                    ForEach(season.completed.reversed()) { entry in
                        MatchRow(entry: entry, destination: entry.opponent.map { Route.team($0) })
                    }
                }
            }
            scheduleNote(season)

            if !season.scoutingPool.isEmpty {
                // Without a schedule, any team in the event may be next, so
                // each one opens lineup preparation once Our team is known.
                let prepareAny = season.matches.isEmpty && season.ourTeam != nil
                Section {
                    ForEach(season.scoutingPool) { summary in
                        NavigationLink(value: prepareAny
                            ? Route.matchup(ourTeam: season.ourTeam!, opponent: summary, scope: season.collection.competitionLevel)
                            : Route.team(summary)) {
                            TeamRow(summary: summary)
                        }
                    }
                } header: {
                    Text(season.matches.isEmpty
                         ? "Teams in this event (\(season.scoutingPool.count))"
                         : "Scouting pool (\(season.scoutingPool.count))")
                } footer: {
                    if prepareAny {
                        Text("Tap a team to prepare your lineup against it.")
                    }
                }
            }
        }
    }

    private func gatheringSection(_ job: CollectionJob) -> some View {
        Section {
            SeasonJobStatus(job: job)
            if job.status == "failed" {
                Button("Start again") {
                    Task {
                        try? await seasons.restartJob(for: model.collection.id, repository: app.repository)
                    }
                }
            }
            if job.isFinished {
                Button("Dismiss", role: .cancel) { seasons.dismissJob(for: model.collection.id) }
            }
        } header: {
            Text(job.isFinished ? "Gathering" : "Gathering teams")
        } footer: {
            if !job.isFinished {
                Text("Our team and the schedule appear once the home team is gathered. Opponents follow one by one.")
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

    /// Upcoming matches open lineup preparation when both teams are known.
    private func prepare(_ entry: SeasonMatch, in season: Season) -> Route? {
        guard let ourTeam = season.ourTeam, let opponent = entry.opponent else {
            return entry.opponent.map { Route.team($0) }
        }
        return .matchup(ourTeam: ourTeam, opponent: opponent, scope: season.collection.competitionLevel)
    }

    private func choose(_ teamId: String?) {
        seasons.setDeviceOurTeam(teamId, for: model.collection.id)
        Task { await model.load(app.repository, seasons: seasons) }
    }
}

struct NextMatchCard: View {
    var entry: SeasonMatch
    var destination: Route?

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
            } else if case .matchup = destination {
                Label("Prepare lineup", systemImage: "rectangle.split.2x1")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.brand)
                    .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
        if let destination {
            NavigationLink(value: destination) { content }
        } else {
            content
        }
    }
}

struct MatchRow: View {
    var entry: SeasonMatch
    var destination: Route?

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
        if let destination {
            NavigationLink(value: destination) { content }
        } else {
            content
        }
    }
}
