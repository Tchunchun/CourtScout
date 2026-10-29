import CourtScoutCore
import SwiftUI

/// The share extension's screen: a TennisRecord team page shared from Safari
/// either starts (or updates) a season, or becomes the opponent of a match
/// added to a season, such as the next knockout round. Either way the job is
/// handed to the app, which shows its progress.
public struct ShareSeasonView: View {
    private enum Mode { case season, match }

    @State private var app = AppModel()
    @State private var seasons = SeasonsModel()
    @State private var mode: Mode?
    /// What to say once a job has started.
    @State private var started: String?
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
                switch mode {
                case nil:
                    chooser(link)
                case .season:
                    NewSeasonView(
                        seasons: seasons,
                        onStarted: { job, teamUrl, level in
                            seasons.track(job, teamUrl: teamUrl, competitionLevel: level)
                            started = "Court Scout is gathering the team and its league opponents on the server. Open the app to follow progress on the Seasons list."
                        },
                        initialLink: link,
                        // After Start, the confirmation stays up until Done.
                        onClose: { if started == nil { onDone() } }
                    )
                case .match:
                    AddMatchView(
                        seasons: seasons,
                        initialLink: link,
                        onAdded: { collection in
                            started = "The match is on “\(collection.name)”, and Court Scout is getting this team’s latest data. Open the app to follow progress in the season’s Matches section."
                        },
                        onClose: { if started == nil { onDone() } }
                    )
                }
            } else {
                notATeamView
            }
        }
        .environment(app)
        .tint(Palette.brand)
        .task { await seasons.load(app.repository) }
    }

    private func chooser(_ link: String) -> some View {
        NavigationStack {
            List {
                Section {
                    Button { mode = .season } label: {
                        Label("Start or update a season", systemImage: "calendar.badge.plus")
                    }
                    Button { mode = .match } label: {
                        Label("Add a match against this team", systemImage: "trophy")
                    }
                    .disabled(seasons.collections.isEmpty)
                } header: {
                    Text("This team")
                } footer: {
                    Text(seasons.collections.isEmpty
                         ? "Use “Start or update a season” for your own team. Matches are added to a season you already have."
                         : "Use “Start or update a season” for your own team, and “Add a match” when a schedule or knockout bracket names your next opponent.")
                }
            }
            .navigationTitle("Court Scout")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onDone)
                }
            }
        }
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

    private func startedView(_ message: String) -> some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Done", systemImage: "checkmark.circle")
            } description: {
                Text(message)
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
