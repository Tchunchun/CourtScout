import Foundation

public struct TeamSection: Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var teams: [TeamSummary]
}

/// Groups catalog teams by event collection, the way the web app's team
/// reports page does. Teams in no collection go to a final "Unfiled" section.
public func groupTeams(
    _ teams: [TeamSummary],
    collections: [TeamCollection],
    matching search: String = ""
) -> [TeamSection] {
    let query = search.trimmingCharacters(in: .whitespaces).lowercased()
    let visible = query.isEmpty ? teams : teams.filter {
        $0.team.name.lowercased().contains(query) ||
            $0.team.section.lowercased().contains(query) ||
            $0.datasetId.contains(query)
    }
    let byDataset = Dictionary(visible.map { ($0.datasetId, $0) }, uniquingKeysWith: { first, _ in first })
    var filed = Set<String>()
    var sections: [TeamSection] = collections.compactMap { collection in
        let members = collection.teamDatasetIds.compactMap { byDataset[$0] }
            .sorted { $0.team.name.localizedCaseInsensitiveCompare($1.team.name) == .orderedAscending }
        filed.formUnion(members.map(\.datasetId))
        return members.isEmpty ? nil : TeamSection(id: collection.id, title: collection.name, teams: members)
    }
    let unfiled = visible.filter { !filed.contains($0.datasetId) }
        .sorted { $0.team.name.localizedCaseInsensitiveCompare($1.team.name) == .orderedAscending }
    if !unfiled.isEmpty {
        sections.append(TeamSection(id: "unfiled", title: "Unfiled", teams: unfiled))
    }
    return sections
}

extension Match {
    /// Courts in lineup order: singles, then doubles, then anything else.
    public var orderedCourts: [(label: String, court: Court)] {
        courts.sorted { left, right in
            func rank(_ label: String) -> (Int, Int, String) {
                let kind = label.first.map { $0 == "S" ? 0 : $0 == "D" ? 1 : 2 } ?? 2
                return (kind, Int(label.dropFirst()) ?? 99, label)
            }
            return rank(left.key) < rank(right.key)
        }.map { ($0.key, $0.value) }
    }
}
