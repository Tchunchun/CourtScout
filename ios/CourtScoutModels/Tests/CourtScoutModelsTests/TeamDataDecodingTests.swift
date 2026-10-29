import Foundation
import Testing
@testable import CourtScoutModels

private let repositoryRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

private func checkedInDatasets() -> [URL] {
    let collections = repositoryRoot.appendingPathComponent("data/collections")
    let enumerator = FileManager.default.enumerator(at: collections, includingPropertiesForKeys: nil)
    return (enumerator?.allObjects as? [URL] ?? [])
        .filter { $0.lastPathComponent == "team-data.json" }
        .sorted { $0.path < $1.path }
}

@Test func checkedInDatasetsExist() {
    #expect(!checkedInDatasets().isEmpty)
}

@Test(arguments: checkedInDatasets())
func checkedInDatasetDecodesAndRoundTrips(url: URL) throws {
    let data = try Data(contentsOf: url)
    let dataset = try JSONDecoder().decode(TeamData.self, from: data)
    #expect(dataset.schemaVersion == TeamData.contractVersion)
    #expect(!dataset.roster.isEmpty)

    let original = try JSONDecoder().decode(JSONValue.self, from: data)
    let reencoded = try JSONDecoder().decode(JSONValue.self, from: try JSONEncoder().encode(dataset))
    #expect(reencoded == original)
}

@Test func ratingsKeepNullsAndMaskedDisplays() throws {
    let json = #"""
    {"value": null, "exactValue": null, "display": "3.xx", "status": "public_masked", "reliability": null, "source": "utr"}
    """#
    let rating = try JSONDecoder().decode(Rating.self, from: Data(json.utf8))
    #expect(rating.value == nil)
    #expect(rating.display == "3.xx")
    #expect(rating.additionalProperties["source"] == .string("utr"))

    let encoded = try JSONDecoder().decode(JSONValue.self, from: try JSONEncoder().encode(rating))
    guard case .object(let object) = encoded else {
        Issue.record("Expected an object")
        return
    }
    // Required nullable keys must encode null, not disappear.
    #expect(object["value"] == .null)
}

@Test func unknownEnumValuesDecodeWithoutFailing() throws {
    let phase = try JSONDecoder().decode(Match.Phase.self, from: Data(#""regional""#.utf8))
    #expect(phase.rawValue == "regional")
    #expect(!Match.Phase.knownValues.contains(phase))
    #expect(Match.Phase.knownValues.contains(.sectionalsFinal))
}
