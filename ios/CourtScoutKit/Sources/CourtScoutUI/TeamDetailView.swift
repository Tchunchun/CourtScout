import CourtScoutCore
import SwiftUI

struct TeamDetailView: View {
    enum Tab: String, CaseIterable, Identifiable {
        case overview = "Overview"
        case roster = "Roster"
        case lineups = "Lineups"
        case matches = "Matches"
        var id: Self { self }
    }

    @Environment(AppModel.self) private var app
    @State private var model: TeamDetailModel
    @State private var tab = Tab.overview
    private let scopes: [String: EligibilityScopeInfo]

    init(summary: TeamSummary, scopes: [String: EligibilityScopeInfo]) {
        _model = State(initialValue: TeamDetailModel(summary: summary))
        self.scopes = scopes
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let offlineSince = model.offlineSince {
                    OfflineBanner(savedAt: offlineSince)
                }
                Picker("Section", selection: $tab) {
                    ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                tabContent
                    .environment(model)
            }
            .padding(16)
        }
        .background(Color.secondary.opacity(0.06))
        .navigationTitle(model.summary.team.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: "\(app.generation)-\(model.scope ?? "team-default")") {
            await model.load(app.repository)
        }
        .refreshable { await model.load(app.repository) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: "\(model.summary.team.season) · \(model.summary.team.level) \(model.summary.team.gender)")
            Text(model.summary.team.name)
                .font(.title2.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Text(model.summary.team.section)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                scopeMenu
            }
        }
    }

    private var scopeMenu: some View {
        Menu {
            Picker("Eligibility", selection: Binding(
                get: { model.activeScope ?? "" },
                set: { model.scope = $0 }
            )) {
                ForEach(["national", "sectional", "local"].filter { scopes[$0] != nil }, id: \.self) { scope in
                    Text(scopes[scope]?.label ?? scope.capitalized).tag(scope)
                }
            }
        } label: {
            Label(
                model.activeScope.map { "\(scopes[$0]?.label ?? $0.capitalized) eligibility" } ?? "Eligibility",
                systemImage: "checkmark.seal"
            )
                .font(.footnote.weight(.semibold))
        }
        .menuStyle(.button)
        .buttonStyle(.bordered)
        .fixedSize()
    }

    @ViewBuilder
    private var tabContent: some View {
        switch model.phase {
        case .idle, .loading:
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        case .failed(let message):
            LoadFailedView(message: message) { Task { await model.load(app.repository) } }
        case .loaded:
            switch tab {
            case .overview: OverviewTab(model: model)
            case .roster: RosterTab(model: model)
            case .lineups: LineupsTab(model: model)
            case .matches: MatchesTab(matches: model.teamData?.matches ?? [])
            }
        }
    }
}

private struct AnalysisUnavailable: View {
    @Environment(TeamDetailModel.self) private var model
    var message: String?

    var body: some View {
        if model.analysisLoading {
            Card {
                ProgressView("Loading analysis…").frame(maxWidth: .infinity)
            }
        } else {
            unavailable
        }
    }

    private var unavailable: some View {
        Card {
            Label("Analysis unavailable", systemImage: "chart.bar.xaxis")
                .font(.headline)
            Text(message ?? "This team has no report yet.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

struct OverviewTab: View {
    var model: TeamDetailModel

    var body: some View {
        VStack(spacing: 12) {
            if let analysis = model.analysis {
                Card {
                    SectionLabel(text: "Record")
                    HStack {
                        Stat(label: "Team matches", value: analysis.summary.teamRecord.display)
                        Stat(label: "Courts", value: analysis.summary.courtRecord.display)
                        Stat(label: "Court win rate", value: Format.percent(analysis.summary.courtRecord.winRate))
                    }
                }
                Card {
                    SectionLabel(text: "\(analysis.eligibility.label) eligibility")
                    HStack {
                        Stat(label: "Eligible", value: "\(analysis.eligibility.summary.eligible)")
                        Stat(label: "Not eligible", value: "\(analysis.eligibility.summary.ineligible)")
                        Stat(label: "Unavailable", value: "\(analysis.eligibility.summary.unavailable)")
                    }
                }
                if !analysis.disclosures.warnings.isEmpty {
                    Card {
                        SectionLabel(text: "Data notes")
                        ForEach(analysis.disclosures.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "info.circle")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                AnalysisUnavailable(message: model.analysisError)
            }
            if let data = model.teamData {
                Card {
                    SectionLabel(text: "Sources")
                    ForEach(Array(data.sources.enumerated()), id: \.offset) { _, source in
                        HStack {
                            Text(Format.source(source.type)).font(.subheadline)
                            Spacer()
                            Text(Format.day(source.retrievedAt))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}

struct RosterTab: View {
    var model: TeamDetailModel

    var body: some View {
        if let players = model.analysis?.eligibility.players {
            LazyVStack(spacing: 8) {
                ForEach(players.sorted { ($0.dr ?? 0) > ($1.dr ?? 0) }) { player in
                    PlayerCard(player: player)
                }
            }
        } else if let roster = model.teamData?.roster {
            // No analysis (e.g. offline before it was saved): show the raw roster.
            LazyVStack(spacing: 8) {
                ForEach(roster, id: \.name) { player in
                    Card {
                        HStack {
                            Text(player.name).font(.headline)
                            Spacer()
                            Text("DR \(Format.rating(player.dr))").monospacedDigit()
                        }
                    }
                }
            }
        }
    }
}

struct PlayerCard: View {
    var player: TeamAnalysis.EligibilityPlayer

    var body: some View {
        Card {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(player.name).font(.headline)
                    if let role = player.role {
                        Text(role).font(.subheadline).foregroundStyle(Palette.brand)
                    }
                }
                Spacer()
                EligibilityBadge(status: player.status)
            }
            HStack(spacing: 16) {
                rating("DR", Format.rating(player.dr))
                rating("UTR S", player.utr?.singles?.display ?? "—")
                rating("UTR D", player.utr?.doubles?.display ?? "—")
                rating("NTRP", [player.ntrpLevel, player.ntrpType].compactMap { $0 }.joined(separator: " "))
            }
            if let note = player.standoutNote {
                Text(note).font(.footnote).foregroundStyle(.secondary)
            }
            // The server's note usually explains eligibility already.
            if player.standoutNote == nil, let needed = player.matchesNeeded, needed > 0 {
                Text("Needs \(needed) more match\(needed == 1 ? "" : "es") to qualify")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Palette.warning)
            }
        }
    }

    private func rating(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

struct LineupsTab: View {
    var model: TeamDetailModel

    var body: some View {
        if let lineups = model.analysis?.lineupPredictions, !lineups.predictions.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(lineups.predictions) { prediction in
                    Card {
                        HStack {
                            SectionLabel(text: "Likely lineup \(prediction.rank)")
                            Spacer()
                            Badge(text: "\(prediction.confidence.capitalized) confidence", color: Palette.accent)
                        }
                        ForEach(prediction.lines) { line in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(line.court)
                                    .font(.caption.weight(.bold))
                                    .frame(width: 28)
                                    .padding(.vertical, 3)
                                    .foregroundStyle(.white)
                                    .background(Palette.brandStrong, in: RoundedRectangle(cornerRadius: 5))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.players.joined(separator: " / ")).font(.subheadline.weight(.medium))
                                    Text("\(line.appearances)× here · \(line.record.display)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        Text(prediction.observedTogether > 0
                             ? "Seen together in \(prediction.observedTogether) match\(prediction.observedTogether == 1 ? "" : "es")"
                             : "Never fielded together as a full lineup")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if let methodology = lineups.methodology {
                    Text(methodology).font(.caption).foregroundStyle(.secondary)
                }
            }
        } else {
            AnalysisUnavailable(message: model.analysisError ?? "Not enough match history to predict lineups.")
        }
    }
}

struct MatchesTab: View {
    var matches: [Match]

    var body: some View {
        LazyVStack(spacing: 8) {
            ForEach(matches.sorted { $0.date > $1.date }, id: \.id) { match in
                MatchCard(match: match)
            }
        }
    }
}

struct MatchCard: View {
    var match: Match
    @State private var expanded = false

    var body: some View {
        Card {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    ResultBadge(result: match.teamResult.result.rawValue)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("vs \(match.opponent)").font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text("\(Format.day(match.date)) · \(Format.phase(match.phase.rawValue))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(match.teamResult.wins)–\(match.teamResult.losses)")
                        .font(.headline)
                        .monospacedDigit()
                    Image(systemName: "chevron.down")
                        .font(.caption)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded {
                Divider()
                ForEach(match.orderedCourts, id: \.label) { entry in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(entry.label).font(.caption.weight(.bold)).frame(width: 26, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.court.targetPlayers.joined(separator: " / ")).font(.footnote.weight(.medium))
                            Text("vs " + entry.court.opponentPlayers.joined(separator: " / "))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(entry.court.result.rawValue)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(entry.court.result == .w ? Palette.success : entry.court.result == .l ? Palette.error : .secondary)
                            if let score = entry.court.score {
                                Text(score).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }
}
