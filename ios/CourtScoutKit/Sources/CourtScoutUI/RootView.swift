import CourtScoutCore
import SwiftUI

public struct CourtScoutRootView: View {
    @State private var app = AppModel()

    public init() {}

    public var body: some View {
        TeamsView()
            .environment(app)
            .tint(Palette.brand)
    }
}

struct TeamsView: View {
    @Environment(AppModel.self) private var app
    @State private var model = TeamsModel()
    @State private var search = ""
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Court Scout")
                .navigationDestination(for: TeamSummary.self) { summary in
                    TeamDetailView(summary: summary, scopes: model.catalog?.eligibilityScopes ?? [:])
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
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
        } else if let catalog = model.catalog {
            List {
                if let offlineSince = model.offlineSince {
                    OfflineBanner(savedAt: offlineSince)
                        .listRowSeparator(.hidden)
                }
                ForEach(groupTeams(catalog.teams, collections: model.collections, matching: search)) { section in
                    Section(section.title) {
                        ForEach(section.teams) { summary in
                            NavigationLink(value: summary) {
                                TeamRow(summary: summary)
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Team or section")
            .refreshable { await model.load(app.repository) }
            .overlay {
                if !search.isEmpty && groupTeams(catalog.teams, collections: model.collections, matching: search).isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
        } else {
            ProgressView("Loading teams…")
        }
    }
}

struct TeamRow: View {
    var summary: TeamSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(summary.team.name).font(.headline).lineLimit(2)
            Text("\(summary.team.section) · \(summary.team.level) \(summary.team.gender)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 6) {
                Badge(text: Format.count(summary.rosterSize, "player"), color: Palette.brand)
                Badge(text: Format.count(summary.matchCount, "match", plural: "matches"), color: Palette.accent)
                if summary.team.nationalsRepresentative == true {
                    Badge(text: "Nationals", color: Palette.warning)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var clearedCache = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server address", text: $address)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                } header: {
                    Text("Court Scout server")
                } footer: {
                    Text("The app reads teams from a Court Scout server started with `npm start`. The iOS Simulator reaches this Mac at \(AppModel.defaultServerAddress).")
                }
                Section {
                    Button(clearedCache ? "Saved reports cleared" : "Clear saved reports", role: .destructive) {
                        app.clearOfflineCache()
                        clearedCache = true
                    }
                    .disabled(clearedCache)
                } footer: {
                    Text("Reports you open are saved on this device so they stay readable offline.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        app.setServerAddress(address)
                        dismiss()
                    }
                    .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .onAppear { address = app.serverAddress }
    }
}
