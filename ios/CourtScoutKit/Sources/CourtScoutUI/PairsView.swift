import CourtScoutCore
import SwiftUI

struct PairsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let teamId: String
    let roster: [RosterPlayer]
    @State private var value: TeamPairs?
    @State private var loading = true
    @State private var saving = false
    @State private var message: String?
    @State private var editor: PairEditor?
    /// The pairs as last loaded or saved, to tell when there are edits to save.
    @State private var loadedPairs: [TeamPairs.Pair] = []
    @State private var confirmingDiscard = false

    private var hasChanges: Bool { value.map { $0.pairs != loadedPairs } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if loading {
                Card { ProgressView("Loading pairs…").frame(maxWidth: .infinity) }
            } else if let value {
                savedPairs(value)
                suggestions(value)
                Button {
                    editor = PairEditor(players: [], tag: "go-to", preferredCourt: nil, editingId: nil)
                } label: {
                    Label("Add pair", systemImage: "person.2.badge.plus")
                }
                .buttonStyle(.bordered)
            } else if let message {
                LoadFailedView(message: message) { Task { await load() } }
            }
            if let message, value != nil {
                Text(message).font(.footnote).foregroundStyle(Palette.warning)
            }
        }
        .task(id: teamId) { await load() }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") {
                    if hasChanges { confirmingDiscard = true } else { dismiss() }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView()
                } else {
                    Button("Save") {
                        Task { if let value, await save(value) { dismiss() } }
                    }
                    .disabled(!hasChanges)
                }
            }
        }
        .interactiveDismissDisabled(hasChanges)
        .confirmationDialog("Discard unsaved pair changes?", isPresented: $confirmingDiscard) {
            Button("Discard changes", role: .destructive) { dismiss() }
        }
        .sheet(item: $editor) { draft in
            PairEditorView(draft: draft, roster: roster.map(\.name)) { edited in
                apply(edited)
            }
        }
    }

    @ViewBuilder
    private func savedPairs(_ current: TeamPairs) -> some View {
        if current.pairs.isEmpty {
            Card {
                SectionLabel(text: "Saved pairs")
                Text("Confirm a suggestion or add the pairings you want lineup proposals to use.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } else {
            SectionLabel(text: "Saved pairs")
            ForEach(current.pairs) { pair in
                pairCard(pair, editable: true)
            }
        }
    }

    @ViewBuilder
    private func suggestions(_ current: TeamPairs) -> some View {
        if !current.suggestions.isEmpty {
            SectionLabel(text: "From match history")
            ForEach(current.suggestions) { pair in
                pairCard(pair, editable: false)
            }
        }
    }

    private func pairCard(_ pair: TeamPairs.Pair, editable: Bool) -> some View {
        Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(pair.players.joined(separator: " + ")).font(.headline)
                    Text("\(pair.appearances) appearance\(pair.appearances == 1 ? "" : "s") · \(pair.wins)–\(pair.losses)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Badge(
                            text: editable ? (pair.tag == "go-to" ? "Go-to" : "Backup") : "Suggested",
                            color: editable && pair.tag == "go-to" ? Palette.success : Palette.accent
                        )
                        if let court = pair.preferredCourt {
                            Text("Prefers \(court)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer()
                if editable {
                    Menu {
                        Button("Edit") {
                            editor = PairEditor(
                                players: pair.players,
                                tag: pair.tag,
                                preferredCourt: pair.preferredCourt,
                                editingId: pair.id
                            )
                        }
                        Button("Remove", role: .destructive) { remove(pair) }
                    } label: {
                        Image(systemName: "ellipsis.circle").font(.title3)
                    }
                } else {
                    Button("Use pair") { confirm(pair) }.buttonStyle(.bordered)
                }
            }
        }
    }

    private func load() async {
        guard let repository = app.repository else { return }
        loading = true
        defer { loading = false }
        do {
            let loaded = try await repository.teamPairs(teamId).value
            value = loaded
            loadedPairs = loaded.pairs
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    /// Returns whether the pairs were saved.
    private func save(_ current: TeamPairs) async -> Bool {
        guard let repository = app.repository else { return false }
        saving = true
        defer { saving = false }
        do {
            let saved = try await repository.saveTeamPairs(current)
            value = saved
            loadedPairs = saved.pairs
            return true
        } catch APIError.http(let status, _) where status == 409 {
            // Keep the captain's edits on top of the newer revision so a
            // second save replaces it deliberately.
            do {
                let latest = try await repository.teamPairs(teamId).value
                value?.revision = latest.revision
                loadedPairs = latest.pairs
                message = "Pairs were changed on another device. Your edits are kept; save again to replace them."
            } catch {
                message = error.localizedDescription
            }
        } catch {
            message = error.localizedDescription
        }
        return false
    }

    private func confirm(_ suggestion: TeamPairs.Pair) {
        guard var current = value else { return }
        current.pairs.append(TeamPairs.Pair(
            players: suggestion.players,
            tag: "go-to",
            preferredCourt: suggestion.preferredCourt,
            appearances: suggestion.appearances,
            wins: suggestion.wins,
            losses: suggestion.losses
        ))
        current.suggestions.removeAll { $0.id == suggestion.id }
        value = current
    }

    private func remove(_ pair: TeamPairs.Pair) {
        guard var current = value else { return }
        current.pairs.removeAll { $0.id == pair.id }
        value = current
    }

    private func apply(_ draft: PairEditor) {
        guard var current = value, draft.players.count == 2 else { return }
        let id = TeamPairs.Pair(players: draft.players, tag: draft.tag).id
        let history = (current.pairs + current.suggestions).first { $0.id == id }
        let pair = TeamPairs.Pair(
            players: draft.players,
            tag: draft.tag,
            preferredCourt: draft.preferredCourt,
            appearances: history?.appearances ?? 0,
            wins: history?.wins ?? 0,
            losses: history?.losses ?? 0
        )
        // Editing into a pair that is already saved replaces that one too.
        current.pairs.removeAll { $0.id == pair.id && $0.id != draft.editingId }
        if let editingId = draft.editingId,
           let index = current.pairs.firstIndex(where: { $0.id == editingId }) {
            current.pairs[index] = pair
        } else {
            current.pairs.append(pair)
        }
        current.suggestions.removeAll { $0.id == pair.id }
        value = current
    }
}

private struct PairEditor: Identifiable {
    let id = UUID()
    var players: [String]
    var tag: String
    var preferredCourt: String?
    var editingId: String?
}

private struct PairEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State var draft: PairEditor
    let roster: [String]
    let onSave: (PairEditor) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Picker("Player 1", selection: first) {
                    Text("Choose player").tag("")
                    ForEach(roster, id: \.self) { Text($0).tag($0) }
                }
                Picker("Player 2", selection: second) {
                    Text("Choose player").tag("")
                    ForEach(roster.filter { $0 != draft.players.first }, id: \.self) { Text($0).tag($0) }
                }
                Picker("Role", selection: $draft.tag) {
                    Text("Go-to").tag("go-to")
                    Text("Backup").tag("backup")
                }
                Picker("Preferred court", selection: preferredCourt) {
                    Text("No preference").tag("")
                    ForEach((1...5).map { "D\($0)" }, id: \.self) { Text($0).tag($0) }
                }
            }
            .navigationTitle(draft.editingId == nil ? "Add pair" : "Edit pair")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onSave(draft); dismiss() }
                        .disabled(draft.players.count != 2 || draft.players.contains("") || draft.players[0] == draft.players[1])
                }
            }
        }
    }

    private var first: Binding<String> {
        Binding(
            get: { draft.players.first ?? "" },
            set: { value in
                if draft.players.isEmpty { draft.players = [value] }
                else { draft.players[0] = value }
                // Player 2 cannot repeat Player 1, so clear it rather than
                // leave the picker on an option it no longer shows.
                if draft.players.count > 1 && draft.players[1] == value { draft.players[1] = "" }
            }
        )
    }

    private var second: Binding<String> {
        Binding(
            get: { draft.players.count > 1 ? draft.players[1] : "" },
            set: { value in
                if draft.players.isEmpty { draft.players = ["", value] }
                else if draft.players.count == 1 { draft.players.append(value) }
                else { draft.players[1] = value }
            }
        )
    }

    private var preferredCourt: Binding<String> {
        Binding(
            get: { draft.preferredCourt ?? "" },
            set: { draft.preferredCourt = $0.isEmpty ? nil : $0 }
        )
    }
}
