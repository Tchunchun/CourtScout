import CourtScoutCore
import Observation
import SwiftUI

@MainActor
@Observable
/// A TennisRecord team link and its preview, for an opponent the season may
/// not have yet.
final class OpponentLinkModel {
    var link = ""
    var preview: OpponentPreview?
    var working = false
    var error: String?

    var validLink: String? { normalizedTeamProfileLink(link) }

    func linkChanged() {
        preview = nil
        error = nil
    }

    func loadPreview(_ repository: TeamRepository?) async {
        guard let repository, let teamUrl = validLink else {
            error = "Paste a TennisRecord team profile link (teamprofile.aspx)."
            return
        }
        working = true
        defer { working = false }
        do {
            preview = try await repository.previewOpponent(teamUrl)
            error = nil
        } catch {
            self.error = NewSeasonModel.message(for: error)
        }
    }
}
