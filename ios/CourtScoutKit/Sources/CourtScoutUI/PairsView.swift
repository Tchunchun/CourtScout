import CourtScoutCore
import SwiftUI

struct PairsView: View {
    @Environment(AppModel.self) private var app
    let teamId: String
    let roster: [RosterPlayer]
    @State private var value: TeamPairs?
    @State private var loading = true
    @State private var saving = false
    @State private var message: String?
    @State private var editor: PairEditor?

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

                Button {
                    Task { await save(value) }
                } label: {
                    if saving { ProgressView().frame(maxWidth: .infinity) }
                    else { Text("Save pairs").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(saving)
            } else if let message {
                LoadFailedView(message: message) { Task { await load() } }
            }
            if let message, value != nil {
                Text(message).font(.footnote).foregroundStyle(Palette.warning)
            }
        }
        .task(id: teamId) { await load() }
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
            value = try await repository.teamPairs(teamId).value
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    private func save(_ current: TeamPairs) async {
        guard let repository = app.repository else { return }
        saving = true
        defer { saving = false }
        do {
            value = try await repository.saveTeamPairs(current)
            message = "Saved."
        } catch APIError.http(let status, let text) where status == 409 {
            await load()
            message = text.isEmpty ? "Pairs changed elsewhere; the latest copy is shown." : text
        } catch {
            message = error.localizedDescription
        }
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
        let history = (current.pairs + current.suggestions).first { $0.id == draft.editingId }
        let pair = TeamPairs.Pair(
            players: draft.players,
            tag: draft.tag,
            preferredCourt: draft.preferredCourt,
            appearances: history?.appearances ?? 0,
            wins: history?.wins ?? 0,
            losses: history?.losses ?? 0
        )
        if let editingId = draft.editingId,
           let index = current.pairs.firstIndex(where: { $0.id == editingId }) {
            current.pairs[index] = pair
        } else {
            current.pairs.removeAll { $0.id == pair.id }
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
