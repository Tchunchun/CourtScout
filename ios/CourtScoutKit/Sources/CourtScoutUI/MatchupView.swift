import CourtScoutCore
import SwiftUI

enum Scenario {
    static func name(_ type: String?) -> String {
        switch type {
        case "most_likely": "Most likely"
        case "rating_ceiling": "Strongest by ratings"
        case "alternate": "Alternate"
        default: "Scenario"
        }
    }

    static func shortName(_ type: String?) -> String {
        switch type {
        case "most_likely": "Likely"
        case "rating_ceiling": "Ratings"
        case "alternate": "Alternate"
        default: "Scenario"
        }
    }
}

enum Edge {
    static func label(_ edge: String) -> String {
        switch edge {
        case "favorable": "Favorable"
        case "swing": "Swing"
        case "challenging": "Challenging"
        default: "Limited data"
        }
    }

    static func color(_ edge: String) -> Color {
        switch edge {
        case "favorable": Palette.success
        case "swing": .orange
        case "challenging": Palette.error
        default: .secondary
        }
    }
}

/// Our lineup against the opponent's predicted lineups, court by court.
struct MatchupView: View {
    @Environment(AppModel.self) private var app
    @State private var model: MatchupModel
    @State private var picking: SlotPick?

    struct SlotPick: Identifiable {
        var court: String
        var slot: Int
        var id: String { "\(court)-\(slot)" }
    }

    init(ourTeam: TeamSummary, opponent: TeamSummary, scope: String?) {
        _model = State(initialValue: MatchupModel(ourTeam: ourTeam, opponent: opponent, scope: scope))
    }

    var body: some View {
        Group {
            switch model.phase {
            case .idle, .loading:
                ProgressView("Comparing lineups…")
            case .failed(let message):
                LoadFailedView(message: message) { Task { await model.load(app.repository) } }
            case .loaded:
                if let matchup = model.matchup {
                    content(matchup)
                }
            }
        }
        .navigationTitle("Prepare lineup")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink(value: Route.team(model.opponent)) {
                    Label("Opponent report", systemImage: "doc.text.magnifyingglass")
                }
            }
        }
        .task(id: app.generation) {
            await model.load(app.repository)
        }
        .sheet(item: $picking) { pick in
            if let matchup = model.matchup {
                PlayerPicker(matchup: matchup, court: pick.court, slot: pick.slot) { name in
                    picking = nil
                    Task { await model.assign(name, court: pick.court, slot: pick.slot, repository: app.repository) }
                }
            }
        }
    }

    private func content(_ matchup: Matchup) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header(matchup)
                if let offlineSince = model.offlineSince {
                    OfflineBanner(savedAt: offlineSince)
                }
                if let error = model.updateError {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Palette.error)
                }
                coverageNotice(matchup)
                if !matchup.challenges.isEmpty {
                    scenarioPicker(matchup)
                }
                validationNotice(matchup)
                ForEach(matchup.courts) { slot in
                    CourtMatchupCard(
                        slot: slot,
                        matchup: matchup,
                        comparison: model.selectedChallenge?.comparisons.first { $0.court == slot.court },
                        onPick: { picking = SlotPick(court: slot.court, slot: $0) }
                    )
                }
                if let challenge = model.selectedChallenge {
                    readCard(challenge)
                }
                if !model.usesSuggestedLineup && matchup.suggestedDraftSource != "none" {
                    Button {
                        Task { await model.resetToSuggested(app.repository) }
                    } label: {
                        Label("Use our most likely lineup", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(.bordered)
                }
                Text("Edges compare team-rating averages (DR and UTR) court by court. They are planning signals, not a result prediction.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(16)
        }
        .background(Color.secondary.opacity(0.06))
        .overlay(alignment: .top) {
            if model.updating && model.matchup != nil {
                ProgressView().padding(8).background(.regularMaterial, in: Capsule()).padding(.top, 4)
            }
        }
    }

    private func header(_ matchup: Matchup) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: [matchup.eligibilityScope.map { "\($0.capitalized) eligibility" },
                                matchup.leagueFormat == "mixed" ? "Mixed" : nil]
                .compactMap { $0 }.joined(separator: " · "))
            Text(matchup.ourTeam.name).font(.headline)
            Text("vs \(matchup.opponentTeam.name)").font(.title3.weight(.bold))
        }
    }

    @ViewBuilder
    private func coverageNotice(_ matchup: Matchup) -> some View {
        let coverage = matchup.scenarioCoverage
        if matchup.scenarios.isEmpty {
            Card {
                Label("No opponent lineups to test", systemImage: "person.2.slash")
                    .font(.headline)
                    .foregroundStyle(Palette.warning)
                if coverage.opponentPlayersWithoutGender > 0 {
                    Text("\(coverage.opponentPlayersWithoutGender) of \(coverage.opponentRosterSize) \(matchup.opponentTeam.name) players have no recorded gender, so mixed pairs can’t be checked. Refresh the team’s TennisRecord data in the web app.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    Text("There isn’t enough match history or rating coverage to predict a lineup.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text("You can still set your lineup below.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } else if coverage.historicalScenarios == 0 && coverage.historicalPredictions > 0 {
            Label("Only the ratings scenario is available; history-based lineups were dropped.", systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func scenarioPicker(_ matchup: Matchup) -> some View {
        Card {
            HStack {
                SectionLabel(text: "Against their lineups")
                Spacer()
                if let overall = matchup.overall, matchup.challenges.count > 1 {
                    Text("Worst \(overall.worstScorePercent)% · avg \(overall.averageScorePercent)%")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 8) {
                ForEach(matchup.challenges) { challenge in
                    let selected = challenge.rank == model.selectedChallenge?.rank
                    Button {
                        model.selectedRank = challenge.rank
                    } label: {
                        VStack(spacing: 2) {
                            Text("\(challenge.scorePercent)%").font(.title3.weight(.bold)).monospacedDigit()
                            Text(Scenario.shortName(challenge.scenarioType)).font(.caption)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .foregroundStyle(selected ? .white : Palette.brand)
                        .background(selected ? Palette.brand : Palette.brand.opacity(0.08),
                                    in: RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                }
            }
            if let challenge = model.selectedChallenge,
               let scenario = matchup.scenarios.first(where: { $0.rank == challenge.rank }) {
                Text(scenarioDetail(scenario))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func scenarioDetail(_ scenario: Matchup.Scenario) -> String {
        var parts = [Scenario.name(scenario.scenarioType)]
        if scenario.scenarioType == "rating_ceiling" {
            parts.append("unconfirmed: their strongest eligible players by rating")
            if !scenario.unplayedPlayers.isEmpty {
                parts.append("\(scenario.unplayedPlayers.count) not seen in gathered matches")
            }
        } else {
            parts.append(scenario.observedTogether > 0
                ? "fielded together in \(Format.count(scenario.observedTogether, "match", plural: "matches"))"
                : "never fielded together as a full lineup")
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func validationNotice(_ matchup: Matchup) -> some View {
        let validation = matchup.validation
        let issues: [String] = [
            validation.complete ? nil
                : "\(validation.selectedPlayers) of \(validation.requiredPlayers) players chosen.",
            validation.duplicateNames.isEmpty ? nil
                : "Listed twice: \(validation.duplicateNames.joined(separator: ", ")).",
            validation.unavailableNames.isEmpty ? nil
                : "Not eligible: \(validation.unavailableNames.joined(separator: ", ")).",
            validation.invalidGenderCourts.isEmpty ? nil
                : "Mixed pairs need one man and one woman: \(validation.invalidGenderCourts.joined(separator: ", ")).",
            validation.invalidNtrpCourts.isEmpty ? nil
                : "Combined NTRP over \(matchup.maxCombinedNtrp.map { String(format: "%.1f", $0) } ?? "the level"): \(validation.invalidNtrpCourts.joined(separator: ", ")).",
            validation.unresolvedGenderNames.isEmpty ? nil
                : "No recorded gender: \(validation.unresolvedGenderNames.joined(separator: ", "))."
        ].compactMap { $0 }
        if !issues.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(issues, id: \.self) { issue in
                    Label(issue, systemImage: "exclamationmark.circle")
                }
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(Palette.warning)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func readCard(_ challenge: Matchup.Challenge) -> some View {
        Card {
            SectionLabel(text: "Read")
            Text(challenge.summary.read).font(.subheadline.weight(.medium))
            ForEach(challenge.pros, id: \.self) { line in
                Label(line, systemImage: challenge.summary.favorable > 0 ? "checkmark.circle" : "minus.circle")
                    .foregroundStyle(challenge.summary.favorable > 0 ? Palette.success : .secondary)
            }
            ForEach(challenge.risks, id: \.self) { line in
                Label(line, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warning)
            }
        }
        .font(.footnote)
    }
}

struct CourtMatchupCard: View {
    var slot: Matchup.CourtSlot
    var matchup: Matchup
    var comparison: Matchup.Comparison?
    var onPick: (Int) -> Void

    var body: some View {
        Card {
            HStack {
                Text(slot.court)
                    .font(.caption.weight(.bold))
                    .frame(width: 30)
                    .padding(.vertical, 3)
                    .foregroundStyle(.white)
                    .background(Palette.brandStrong, in: RoundedRectangle(cornerRadius: 5))
                Text(slot.discipline.capitalized).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if let comparison {
                    Badge(text: Edge.label(comparison.edge), color: Edge.color(comparison.edge))
                }
            }
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("OURS").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(0..<slot.players, id: \.self) { index in
                        Button {
                            onPick(index)
                        } label: {
                            HStack(spacing: 4) {
                                Text(matchup.player(court: slot.court, slot: index) ?? "Choose player")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(matchup.player(court: slot.court, slot: index) == nil ? Palette.warning : Palette.brand)
                                    .multilineTextAlignment(.leading)
                                Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    if let comparison { ratingLine(comparison.ours) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 6) {
                    Text("THEIRS").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    if let comparison, !comparison.opponentPlayers.isEmpty {
                        ForEach(comparison.opponentPlayers, id: \.self) { name in
                            Text(name).font(.subheadline)
                        }
                        ratingLine(comparison.opponent)
                    } else {
                        Text("No prediction").font(.subheadline).foregroundStyle(.secondary)
                    }
                    // History lines are complete when predicted; a short line
                    // means players were dropped because they are not on the
                    // opponent's current roster.
                    if let comparison, comparison.opponentPlayers.count < slot.players {
                        let missing = slot.players - comparison.opponentPlayers.count
                        Text("\(missing == slot.players ? "Usual player" : "\(missing) usual player") not on their current roster")
                            .font(.caption)
                            .foregroundStyle(Palette.warning)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let comparison, comparison.margins.dr != nil || comparison.margins.utr != nil {
                Text(marginText(comparison.margins))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func ratingLine(_ side: Matchup.Comparison.Side) -> some View {
        Text("DR \(Format.rating(side.dr)) · UTR \(Format.rating(side.utr))")
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)
    }

    private func marginText(_ margins: Matchup.Comparison.Margins) -> String {
        func signed(_ value: Double?) -> String {
            guard let value else { return "—" }
            return (value >= 0 ? "+" : "−") + String(format: "%.2f", abs(value))
        }
        return "Our edge: DR \(signed(margins.dr)) · UTR \(signed(margins.utr))"
    }
}

/// Chooses Our player for one court slot. Eligible players come first; a
/// player already on another court swaps places.
struct PlayerPicker: View {
    var matchup: Matchup
    var court: String
    var slot: Int
    var choose: (String?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let current = matchup.player(court: court, slot: slot)
        let eligible = matchup.ourPlayers.filter { $0.status == "eligible" }
        let others = matchup.ourPlayers.filter { $0.status != "eligible" }
        NavigationStack {
            List {
                if current != nil {
                    Button("Clear \(court)", role: .destructive) { choose(nil) }
                }
                Section("Eligible") {
                    ForEach(eligible) { row($0, current: current) }
                }
                if !others.isEmpty {
                    Section("Not eligible") {
                        ForEach(others) { row($0, current: current) }
                    }
                }
            }
            .navigationTitle("\(court) · player \(slot + 1)")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }

    private func row(_ player: Matchup.OurPlayer, current: String?) -> some View {
        let elsewhere = matchup.court(of: player.name).flatMap { $0 == court ? nil : $0 }
        let singles = court.hasPrefix("S")
        return Button {
            choose(player.name)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(player.name).font(.body.weight(.medium)).foregroundStyle(.primary)
                        if let elsewhere { Badge(text: "On \(elsewhere)", color: Palette.accent) }
                        if player.status != "eligible" { EligibilityBadge(status: player.status) }
                    }
                    if let role = player.role {
                        Text(role).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("DR \(Format.rating(player.dr))").font(.caption.weight(.semibold)).monospacedDigit()
                    Text("UTR \(singles ? player.utrSingles : player.utrDoubles)")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                if player.name == current {
                    Image(systemName: "checkmark").foregroundStyle(Palette.brand)
                }
            }
        }
    }
}
