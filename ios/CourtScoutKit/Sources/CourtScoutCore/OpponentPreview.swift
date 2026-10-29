import Foundation

/// `POST /api/team-preview` for one team, without its league.
public struct OpponentPreview: Codable, Hashable, Sendable {
    public var teamUrl: String
    public var team: Team
    public var rosterSize: Int
}

extension TeamRepository {
    /// Needs the server; never falls back to a saved copy.
    public func previewOpponent(_ teamUrl: String) async throws -> OpponentPreview {
        let body = try JSONEncoder().encode(["teamUrl": teamUrl, "teamType": "opponent"])
        return try await JSONDecoder().decode(OpponentPreview.self, from: transport.post("api/team-preview", body: body))
    }
}
