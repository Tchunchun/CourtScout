import CourtScoutCore
import Observation
import SwiftUI

@MainActor
@Observable
final class NewSeasonModel {
    var link = ""
    var competitionLevel = "local"
    var name = ""
    var preview: TeamPreview?
    /// The season this team already belongs to, if any.
    var existing: TeamCollection?
    var working = false
    var error: String?

    var validLink: String? { normalizedTeamProfileLink(link) }

    func linkChanged() {
        preview = nil
        existing = nil
        error = nil
    }

    func loadPreview(_ repository: TeamRepository?, seasons: SeasonsModel) async {
        guard let repository, let teamUrl = validLink else {
            error = "Paste a TennisRecord team profile link (teamprofile.aspx)."
            return
        }
        working = true
        defer { working = false }
        do {
            let loaded = try await repository.previewHomeTeam(teamUrl)
            preview = loaded
            existing = existingSeason(
                for: teamUrl,
                teams: seasons.catalog?.teams ?? [],
                collections: seasons.collections
            )
            competitionLevel = existing?.competitionLevel ?? competitionLevel
            name = suggestedSeasonName(loaded.team)
            error = nil
        } catch {
            self.error = Self.message(for: error)
        }
    }

    /// Starts gathering on the server. Returns the job so the home screen can
    /// follow its progress.
    func start(_ repository: TeamRepository?) async -> CollectionJob? {
        guard let repository, let preview else { return nil }
        working = true
        defer { working = false }
        do {
            let job = try await repository.startSeason(
                teamUrl: preview.teamUrl,
                competitionLevel: competitionLevel
            )
            // A new season starts with a temporary name on the server.
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if existing == nil, let collectionId = job.eventCollectionId, !trimmed.isEmpty {
                try? await repository.renameSeason(collectionId, to: trimmed)
            }
            return job
        } catch {
            self.error = Self.message(for: error)
            return nil
        }
    }

    static func message(for error: Error) -> String {
        if error is URLError {
            return "Can’t reach the Court Scout server. Starting a season needs a connection."
        }
        return error.localizedDescription
    }
}

/// Starts a season from Our team's TennisRecord link: preview the team,
/// confirm, and the server gathers it and every league opponent.
struct NewSeasonView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model = NewSeasonModel()
    var seasons: SeasonsModel
    /// The started job, its team link, and level, so it can be restarted.
    var onStarted: (CollectionJob, String, String) -> Void

    var body: some View {
        NavigationStack {
            Form {
                if seasons.offlineSince != nil {
                    Section {
                        Label("You’re offline. Starting a season needs the Court Scout server.", systemImage: "wifi.slash")
                            .foregroundStyle(Palette.warning)
                    }
                }
                linkSection
                if let preview = model.preview {
                    previewSection(preview)
                    settingsSection
                }
                if let error = model.error {
                    Section {
                        Text(error).foregroundStyle(Palette.error)
                    }
                }
            }
            .navigationTitle("New season")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.working {
                        ProgressView()
                    } else if model.preview == nil {
                        Button("Preview") { Task { await model.loadPreview(app.repository, seasons: seasons) } }
                            .disabled(model.validLink == nil || seasons.offlineSince != nil)
                    } else {
                        Button(model.existing == nil ? "Start" : "Update") { start() }
                            .disabled(seasons.offlineSince != nil)
                    }
                }
            }
            .onChange(of: model.link) { model.linkChanged() }
        }
    }

    private var linkSection: some View {
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
                    if model.validLink != nil {
                        await model.loadPreview(app.repository, seasons: seasons)
                    }
                }
            }
            .disabled(seasons.offlineSince != nil)
        } header: {
            Text("Our team’s TennisRecord link")
        } footer: {
            Text("Open your team on tennisrecord.com and copy the page link. Court Scout gathers your team and every league opponent into one season.")
        }
    }

    private func previewSection(_ preview: TeamPreview) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(preview.team.name).font(.title3.weight(.bold))
                Text(preview.team.league).font(.subheadline)
                Text(preview.team.section.contains(preview.team.level)
                     ? preview.team.section
                     : "\(preview.team.section) · \(preview.team.level)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    Badge(text: Format.count(preview.rosterSize, "player"), color: Palette.brand)
                    Badge(text: Format.count(preview.opponentCount, "opponent"), color: Palette.accent)
                    Badge(text: Format.count(preview.leagueSchedule.count, "match", plural: "matches"), color: .secondary)
                }
                .padding(.top, 2)
            }
            .padding(.vertical, 4)
        } header: {
            Text("Team found")
        } footer: {
            if let existing = model.existing {
                Text("This team is already in “\(existing.name)”. Updating gathers the opponents that season is missing and keeps the teams it has. To refresh a gathered team, use Refresh data in the web app.")
            } else {
                Text("Gathering \(Format.count(preview.opponentCount + 1, "team")) with public UTR ratings takes a few minutes. It runs on the server, so you can close the app.")
            }
        }
    }

    @ViewBuilder
    private var settingsSection: some View {
        if model.existing == nil {
            Section {
                TextField("Season name", text: $model.name)
                Picker("Level", selection: $model.competitionLevel) {
                    Text("Local league").tag("local")
                    Text("Sectionals").tag("sectional")
                    Text("Nationals").tag("national")
                }
            } header: {
                Text("Season")
            } footer: {
                Text("The level sets which players count as eligible. Exact UTR decimals can be added later from the web app.")
            }
        }
    }

    private func start() {
        Task {
            if let job = await model.start(app.repository), let preview = model.preview {
                onStarted(job, preview.teamUrl, model.competitionLevel)
                dismiss()
            }
        }
    }
}

/// Progress for a season the server is still gathering.
struct SeasonJobStatus: View {
    var job: CollectionJob

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if job.status == "failed" {
                Label(job.error ?? job.detail, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Palette.error)
            } else if job.status == "complete" {
                Label(job.warning ?? job.detail, systemImage: "exclamationmark.circle")
                    .foregroundStyle(Palette.warning)
            } else {
                ProgressView(value: fraction)
                Text(gatheredText).foregroundStyle(.secondary)
            }
        }
        .font(.caption)
    }

    /// The home team is most of the server's own percentage; once opponents
    /// are known, teams gathered is the better measure.
    private var fraction: Double {
        job.discoveredOpponentCount > 0
            ? Double(job.collectedTeamCount) / Double(job.discoveredOpponentCount + 1)
            : Double(job.progress) / 100 / 4
    }

    private var gatheredText: String {
        job.discoveredOpponentCount > 0
            ? "Gathered \(job.collectedTeamCount) of \(job.discoveredOpponentCount + 1) teams"
            : job.detail
    }
}
