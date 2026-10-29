import CourtScoutCore
import SwiftUI

public struct CourtScoutRootView: View {
    @State private var app = AppModel()

    public init() {}

    public var body: some View {
        SeasonsView()
            .environment(app)
            .tint(Palette.brand)
    }
}

/// Every gathered team across seasons, for the occasional "where is that
/// team?" lookup. Reached from the search button on the Seasons screen.
struct AllTeamsView: View {
    var catalog: TeamCatalog?
    var collections: [TeamCollection]
    @State private var search = ""

    var body: some View {
        let sections = groupTeams(catalog?.teams ?? [], collections: collections, matching: search)
        List {
            ForEach(sections) { section in
                Section(section.title) {
                    ForEach(section.teams) { summary in
                        NavigationLink(value: Route.team(summary, isOurTeam: false)) {
                            TeamRow(summary: summary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Find a team")
        .searchable(text: $search, prompt: "Team or section")
        .overlay {
            if !search.isEmpty && sections.isEmpty {
                ContentUnavailableView.search(text: search)
            }
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
