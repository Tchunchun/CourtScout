import CourtScoutCore
import Observation
import SwiftUI

@MainActor
@Observable
final class PlayoffOpponentModel {
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

/// Adds the next playoff opponent to a season once the bracket names it:
/// the server gathers that one team, or refreshes it if the season has it.
struct PlayoffOpponentView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model = PlayoffOpponentModel()
    @State private var seasonId: String?
    var seasons: SeasonsModel
    /// The season to add to; nil lets the user pick one (the share sheet).
    var collection: TeamCollection?
    var initialLink: String?
    var onAdded: (PlayoffOpponentAdded) -> Void = { _ in }
    var onClose: (() -> Void)?

    private var season: TeamCollection? {
        collection ?? seasons.seasons.first { $0.id == seasonId } ?? seasons.seasons.first
    }

    /// The season's gathered team for this link, if it has one.
    private var existing: TeamSummary? {
        guard let season, let key = teamProfileKey(model.preview?.teamUrl ?? model.validLink) else { return nil }
        return seasons.catalog?.teams.first {
            season.teamDatasetIds.contains($0.datasetId) && teamProfileKey($0.sourceUrl) == key
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if collection == nil {
                    Section("Season") {
                        Picker("Season", selection: Binding(
                            get: { season?.id },
                            set: { seasonId = $0 }
                        )) {
                            ForEach(seasons.seasons) { Text($0.name).tag(Optional($0.id)) }
                        }
                    }
                }
                Section {
                    TextField("tennisrecord.com team page link", text: $model.link, axis: .vertical)
                        .lineLimit(1...3)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                    PasteButton(payloadType: String.self) { strings in
                        guard let text = strings.first else { return }
                        Task { @MainActor in
                            model.link = text
                            if model.validLink != nil { await model.loadPreview(app.repository) }
                        }
                    }
                } header: {
                    Text("Opponent’s TennisRecord link")
                } footer: {
                    Text("Add each opponent as the bracket names it, once the matches before yours are finished.")
                }
                if let preview = model.preview {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(preview.team.name).font(.title3.weight(.bold))
                            Text(preview.team.section).font(.subheadline).foregroundStyle(.secondary)
                            Badge(text: Format.count(preview.rosterSize, "player"), color: Palette.brand)
                                .padding(.top, 2)
                        }
                        .padding(.vertical, 4)
                    } header: {
                        Text("Team found")
                    } footer: {
                        Text(existing == nil
                             ? "Gathers this team with public UTR, usually in a minute or two. It runs on the server, so you can close this."
                             : "Already in this season: its latest matches are refreshed from TennisRecord and its ratings are kept.")
                    }
                }
                if let error = model.error {
                    Section { Text(error).foregroundStyle(Palette.error) }
                }
            }
            .navigationTitle("Playoff opponent")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { close() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.working {
                        ProgressView()
                    } else if model.preview == nil {
                        Button("Preview") { Task { await model.loadPreview(app.repository) } }
                            .disabled(model.validLink == nil)
                    } else {
                        Button("Add") { add() }
                            .disabled(season == nil)
                    }
                }
            }
            .onChange(of: model.link) { model.linkChanged() }
            .task {
                guard let initialLink, model.link.isEmpty else { return }
                model.link = initialLink
                if model.validLink != nil { await model.loadPreview(app.repository) }
            }
        }
    }

    private func add() {
        guard let season, let preview = model.preview else { return }
        Task {
            model.working = true
            defer { model.working = false }
            do {
                if let added = try await seasons.addPlayoffOpponent(
                    preview.teamUrl, name: preview.team.name, to: season, repository: app.repository
                ) {
                    onAdded(added)
                    close()
                }
            } catch {
                model.error = NewSeasonModel.message(for: error)
            }
        }
    }

    private func close() {
        if let onClose { onClose() } else { dismiss() }
    }
}
