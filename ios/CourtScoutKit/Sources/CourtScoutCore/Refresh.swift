import Foundation

extension TeamRepository {
    /// `POST /api/refresh-jobs`: pulls the team's latest TennisRecord roster,
    /// matches, and scorecards into its dataset in place. UTR ratings are
    /// kept. Needs the server; never falls back to a saved copy.
    public func refreshFromTennisRecord(_ teamId: String) async throws -> CollectionJob {
        let body = try JSONSerialization.data(withJSONObject: [
            "teamId": teamId,
            "refreshTennisRecord": true,
            "refreshUtr": false
        ])
        return try await JSONDecoder().decode(CollectionJob.self, from: transport.post("api/refresh-jobs", body: body))
    }
}
