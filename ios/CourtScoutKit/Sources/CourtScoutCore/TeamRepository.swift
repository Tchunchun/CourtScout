import Foundation

/// Raw JSON responses saved on the device so reports stay readable offline.
public struct OfflineCache: Sendable {
    public var directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// Application Support, not Caches: iOS may empty Caches under storage
    /// pressure, which could lose a report right before a match. Copies saved
    /// in Caches by earlier builds move over once.
    public static func appDefault() -> OfflineCache {
        let files = FileManager.default
        let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "CourtScout/api", directoryHint: .isDirectory)
        let legacy = files.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "CourtScout/api", directoryHint: .isDirectory)
        if !files.fileExists(atPath: support.path), files.fileExists(atPath: legacy.path) {
            try? files.createDirectory(at: support.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? files.moveItem(at: legacy, to: support)
        }
        return OfflineCache(directory: support)
    }

    private func fileURL(_ key: String) -> URL {
        let name = key.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." ? $0 : "_" }
        return directory.appending(path: String(name) + ".json")
    }

    public func store(_ data: Data, for key: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: fileURL(key), options: .atomic)
    }

    public func load(_ key: String) -> (data: Data, savedAt: Date)? {
        let url = fileURL(key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let savedAt = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
            .contentModificationDate ?? .distantPast
        return (data, savedAt)
    }

    public func removeAll() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }
}

public struct Loaded<Value: Sendable>: Sendable {
    public enum Source: Sendable { case live, offline }

    public var value: Value
    public var source: Source
    public var savedAt: Date
}

/// Network first; when the server cannot be reached, falls back to the last
/// saved copy and says so. Canonical datasets are read-only here.
public struct TeamRepository: Sendable {
    public var transport: any HTTPTransport
    public var cache: OfflineCache

    public init(transport: any HTTPTransport, cache: OfflineCache) {
        self.transport = transport
        self.cache = cache
    }

    public func catalog() async throws -> Loaded<TeamCatalog> {
        try await load(TeamCatalog.self, key: "teams", path: "api/teams")
    }

    public func collections() async throws -> Loaded<TeamCollectionList> {
        try await load(TeamCollectionList.self, key: "team-collections", path: "api/team-collections")
    }

    public func eventSchedule(_ collectionId: String) async throws -> Loaded<EventScheduleResponse> {
        try await load(
            EventScheduleResponse.self,
            key: "event-schedule-\(collectionId)",
            path: "api/event-schedules/\(collectionId)"
        )
    }

    public func teamData(_ teamId: String) async throws -> Loaded<TeamData> {
        try await load(
            TeamData.self,
            key: "team-data-\(teamId)",
            path: "api/team-data",
            query: [URLQueryItem(name: "team", value: teamId)]
        )
    }

    /// With no scope, the server uses the team's own eligibility level (from
    /// its event collection), the same default the web app shows.
    public func analysis(_ teamId: String, scope: String? = nil) async throws -> Loaded<TeamAnalysis> {
        try await load(
            TeamAnalysis.self,
            key: "analysis-\(teamId)-\(scope ?? "team-default")",
            path: "api/analysis",
            query: [URLQueryItem(name: "team", value: teamId)] +
                (scope.map { [URLQueryItem(name: "eligibility", value: $0)] } ?? [])
        )
    }

    /// Our lineup against the opponent's predicted lineups. Without a draft,
    /// the server starts from Our team's most likely lineup. Offline, the
    /// last comparison for this pair is shown.
    public func matchup(
        ourTeamId: String,
        opponentTeamId: String,
        eligibility: String? = nil,
        draft: [String: [String]]? = nil
    ) async throws -> Loaded<Matchup> {
        let body = try JSONEncoder().encode(MatchupRequest(
            ourTeamId: ourTeamId,
            opponentTeamId: opponentTeamId,
            eligibility: eligibility,
            draft: draft
        ))
        return try await load(Matchup.self, key: "matchup-\(ourTeamId)-\(opponentTeamId)") {
            try await transport.post("api/matchup", body: body)
        }
    }

    func load<Value: Decodable & Sendable>(
        _ type: Value.Type,
        key: String,
        path: String,
        query: [URLQueryItem] = []
    ) async throws -> Loaded<Value> {
        try await load(type, key: key) {
            try await transport.get(path, query: query)
        }
    }

    func load<Value: Decodable & Sendable>(
        _ type: Value.Type,
        key: String,
        fetch: () async throws -> Data
    ) async throws -> Loaded<Value> {
        let data: Data
        do {
            data = try await fetch()
        } catch {
            // Server errors (such as an unknown team) are real answers; only
            // unreachable servers fall back to the saved copy.
            if case APIError.http = error { throw error }
            // A cancelled request says nothing about the server.
            if error is CancellationError || (error as? URLError)?.code == .cancelled { throw error }
            guard let saved = cache.load(key) else { throw error }
            return Loaded(
                value: try JSONDecoder().decode(type, from: saved.data),
                source: .offline,
                savedAt: saved.savedAt
            )
        }
        let value = try JSONDecoder().decode(type, from: data)
        try? cache.store(data, for: key)
        return Loaded(value: value, source: .live, savedAt: .now)
    }
}
