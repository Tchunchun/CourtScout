import CourtScoutCore
import Foundation
import Observation

@MainActor
@Observable
public final class AppModel {
    public static let defaultServerAddress = "http://localhost:4173"
    private static let serverKey = "serverAddress"

    public private(set) var serverAddress: String
    public private(set) var repository: TeamRepository?
    public private(set) var configurationError: String?
    /// Bumped when the server changes so screens reload.
    public private(set) var generation = 0
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        serverAddress = defaults.string(forKey: Self.serverKey) ?? Self.defaultServerAddress
        configure()
    }

    public func setServerAddress(_ address: String) {
        serverAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        defaults.set(serverAddress, forKey: Self.serverKey)
        configure()
    }

    public func clearOfflineCache() {
        try? OfflineCache.appDefault().removeAll()
    }

    private func configure() {
        do {
            repository = TeamRepository(
                transport: try URLSessionTransport(serverAddress: serverAddress),
                cache: .appDefault()
            )
            configurationError = nil
        } catch {
            repository = nil
            configurationError = error.localizedDescription
        }
        generation += 1
    }
}

enum LoadPhase: Equatable {
    case idle, loading, loaded
    case failed(String)
}

@MainActor
@Observable
final class TeamDetailModel {
    let summary: TeamSummary
    /// nil until the user picks one: the server then uses the team's own level.
    var scope: String?
    var teamData: TeamData?
    var analysis: TeamAnalysis?
    var offlineSince: Date?
    var analysisError: String?
    var analysisLoading = false
    var phase: LoadPhase = .idle

    init(summary: TeamSummary) {
        self.summary = summary
    }

    /// The scope the shown analysis was computed for.
    var activeScope: String? { analysis?.eligibility.scope ?? scope }

    func load(_ repository: TeamRepository?) async {
        guard let repository else { return }
        if teamData == nil { phase = .loading }
        analysisLoading = true
        defer { analysisLoading = false }
        async let dataResult = repository.teamData(summary.id)
        async let analysisResult = repository.analysis(summary.id, scope: scope)
        do {
            let data = try await dataResult
            teamData = data.value
            offlineSince = data.source == .offline ? data.savedAt : nil
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
        do {
            analysis = try await analysisResult.value
            analysisError = nil
        } catch {
            analysis = nil
            analysisError = error.localizedDescription
        }
    }
}
