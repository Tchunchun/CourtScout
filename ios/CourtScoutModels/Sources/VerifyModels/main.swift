import CourtScoutModels
import Foundation

// Usage: swift run --package-path ios/CourtScoutModels verify-models [repository-root]
let repositoryRoot = CommandLine.arguments.dropFirst().first.map { URL(fileURLWithPath: $0) } ??
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()

var failures: [String] = []

func check(_ condition: Bool, _ message: @autoclosure () -> String) {
    if !condition { failures.append(message()) }
}

let collections = repositoryRoot.appendingPathComponent("data/collections")
let datasets = (FileManager.default.enumerator(at: collections, includingPropertiesForKeys: nil)?
    .allObjects as? [URL] ?? [])
    .filter { $0.lastPathComponent == "team-data.json" }
    .sorted { $0.path < $1.path }
check(!datasets.isEmpty, "No team-data.json files under \(collections.path)")

for url in datasets {
    let name = url.deletingLastPathComponent().lastPathComponent
    do {
        let data = try Data(contentsOf: url)
        let dataset = try JSONDecoder().decode(TeamData.self, from: data)
        check(dataset.schemaVersion == TeamData.contractVersion, "\(name): schemaVersion \(dataset.schemaVersion)")
        check(!dataset.roster.isEmpty, "\(name): empty roster")
        let original = try JSONDecoder().decode(JSONValue.self, from: data)
        let reencoded = try JSONDecoder().decode(JSONValue.self, from: try JSONEncoder().encode(dataset))
        check(reencoded == original, "\(name): did not round-trip")
    } catch {
        failures.append("\(name): \(error)")
    }
}

do {
    let json = #"{"value": null, "display": "3.xx", "status": "public_masked", "source": "utr"}"#
    let rating = try JSONDecoder().decode(Rating.self, from: Data(json.utf8))
    check(rating.value == nil && rating.display == "3.xx", "Masked rating changed on decode")
    check(rating.additionalProperties["source"] == .string("utr"), "Undeclared rating key was dropped")
    let encoded = try JSONDecoder().decode(JSONValue.self, from: try JSONEncoder().encode(rating))
    if case .object(let object) = encoded {
        check(object["value"] == .null, "Required nullable key did not encode null")
    } else {
        failures.append("Rating did not encode as an object")
    }

    let phase = try JSONDecoder().decode(Match.Phase.self, from: Data(#""regional""#.utf8))
    check(phase.rawValue == "regional" && !Match.Phase.knownValues.contains(phase), "Unknown enum value not preserved")
} catch {
    failures.append("Unit checks: \(error)")
}

if failures.isEmpty {
    print("verify-models: \(datasets.count) datasets decoded and round-tripped; unit checks passed")
} else {
    failures.forEach { print("FAIL \($0)") }
    print("verify-models: \(failures.count) failure(s)")
    exit(1)
}
