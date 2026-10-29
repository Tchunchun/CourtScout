import CourtScoutCore
import Foundation
import Observation

@MainActor
@Observable
final class MatchupModel {
    let ourTeam: TeamSummary
    let opponent: TeamSummary
    let scope: String?
    var matchup: Matchup?
    var selectedRank = 1
    var offlineSince: Date?
    var phase: LoadPhase = .idle
    /// A lineup change is being re-checked by the server.
    var updating = false
    var updateError: String?
    private let defaults: UserDefaults

    init(ourTeam: TeamSummary, opponent: TeamSummary, scope: String?, defaults: UserDefaults = .standard) {
        self.ourTeam = ourTeam
        self.opponent = opponent
        self.scope = scope
        self.defaults = defaults
    }

    private var draftKey: String { "draft.\(ourTeam.id).\(opponent.id)" }

    /// The captain's lineup for this matchup, kept on the device.
    private var savedDraft: [String: [String]]? {
        get { defaults.dictionary(forKey: draftKey) as? [String: [String]] }
        set { defaults.set(newValue, forKey: draftKey) }
    }

    var selectedChallenge: Matchup.Challenge? {
        matchup?.challenges.first { $0.rank == selectedRank } ?? matchup?.challenges.first
    }

    var usesSuggestedLineup: Bool { savedDraft == nil }

    func load(_ repository: TeamRepository?) async {
        if matchup == nil { phase = .loading }
        await fetch(repository, draft: savedDraft)
    }

    func assign(_ name: String?, court: String, slot: Int, repository: TeamRepository?) async {
        guard let matchup else { return }
        let draft = assigning(name, to: court, slot: slot, in: matchup.draft)
        savedDraft = draft
        self.matchup?.draft = draft
        await fetch(repository, draft: draft)
    }

    func resetToSuggested(_ repository: TeamRepository?) async {
        savedDraft = nil
        await fetch(repository, draft: nil)
    }

    private func fetch(_ repository: TeamRepository?, draft: [String: [String]]?) async {
        guard let repository else { return }
        updating = true
        defer { updating = false }
        do {
            let loaded = try await repository.matchup(
                ourTeamId: ourTeam.id,
                opponentTeamId: opponent.id,
                eligibility: scope,
                draft: draft
            )
            matchup = loaded.value
            offlineSince = loaded.source == .offline ? loaded.savedAt : nil
            if !loaded.value.challenges.contains(where: { $0.rank == selectedRank }) {
                selectedRank = loaded.value.challenges.first?.rank ?? 1
            }
            updateError = nil
            phase = .loaded
        } catch {
            if matchup == nil {
                phase = .failed(error.localizedDescription)
            } else {
                updateError = error.localizedDescription
            }
        }
    }
}
