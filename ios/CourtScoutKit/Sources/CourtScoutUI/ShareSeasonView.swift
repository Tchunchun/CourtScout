import CourtScoutCore
import SwiftUI

/// The share extension's screen: a TennisRecord team page shared from Safari
/// opens New season with the link previewed. Starting it hands the job to the
/// app, which shows its progress on the Seasons list.
public struct ShareSeasonView: View {
    @State private var app = AppModel()
    @State private var seasons = SeasonsModel()
    @State private var started: CollectionJob?
    private let link: String?
    private let onDone: () -> Void

    /// `sharedText` is the shared URL or text; `onDone` ends the request.
    public init(sharedText: String?, onDone: @escaping () -> Void) {
        link = sharedText.flatMap(Self.teamLink)
        self.onDone = onDone
    }

    public var body: some View {
        Group {
            if let started {
                startedView(started)
            } else if let link {
                NewSeasonView(
                    seasons: seasons,
                    onStarted: { job, teamUrl, level in
                        seasons.track(job, teamUrl: teamUrl, competitionLevel: level)
                        started = job
                    },
                    initialLink: link,
                    // After Start, the confirmation stays up until Done.
                    onClose: { if started == nil { onDone() } }
                )
                .task { await seasons.load(app.repository) }
            } else {
                notATeamView
            }
        }
        .environment(app)
        .tint(Palette.brand)
    }

    /// The first TennisRecord team profile link in the shared text.
    static func teamLink(in text: String) -> String? {
        if let link = normalizedTeamProfileLink(text) { return link }
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        return detector?.matches(in: text, range: range)
            .compactMap { $0.url?.absoluteString }
            .compactMap(normalizedTeamProfileLink)
            .first
    }

    private func startedView(_ job: CollectionJob) -> some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Gathering started", systemImage: "checkmark.circle")
            } description: {
                Text("Court Scout is gathering the team and its league opponents on the server. Open the app to follow progress on the Seasons list.")
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onDone)
                }
            }
        }
    }

    private var notATeamView: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Not a team page", systemImage: "link.badge.plus")
            } description: {
                Text("Share a team page from tennisrecord.com (its address contains teamprofile.aspx) to start a season.")
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onDone)
                }
            }
        }
    }
}
