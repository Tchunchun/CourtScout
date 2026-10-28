import CourtScoutCore
import Foundation
import Observation

@MainActor
@Observable
final class SeasonsModel {
    var catalog: TeamCatalog?
    var collections: [TeamCollection] = []
    /// Confirmed schedule per collection id; nil when none was confirmed.
    var schedules: [String: EventSchedule] = [:]
    var offlineSince: Date?
    var phase: LoadPhase = .idle
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var seasons: [TeamCollection] { orderedSeasons(collections) }

    func load(_ repository: TeamRepository?) async {
        guard let repository else { return }
        if catalog == nil { phase = .loading }
        do {
            let catalog = try await repository.catalog()
            let collections = try await repository.collections()
            var schedules: [String: EventSchedule] = [:]
            for collection in collections.value.collections {
                if let schedule = try? await repository.eventSchedule(collection.id).value.schedule {
                    schedules[collection.id] = schedule
                }
            }
            self.catalog = catalog.value
            self.collections = collections.value.collections
            self.schedules = schedules
            offlineSince = catalog.source == .offline || collections.source == .offline
                ? min(catalog.savedAt, collections.savedAt) : nil
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // Our team chosen on this device, used only when the server has none.
    func deviceOurTeam(for collectionId: String) -> String? {
        defaults.string(forKey: "ourTeam.\(collectionId)")
    }

    func setDeviceOurTeam(_ teamId: String?, for collectionId: String) {
        defaults.set(teamId, forKey: "ourTeam.\(collectionId)")
    }

    /// Season summary for the home list, from the confirmed schedule only.
    func summary(for collection: TeamCollection) -> Season? {
        guard let catalog else { return nil }
        return buildSeason(
            collection: collection,
            teams: catalog.teams,
            schedule: schedules[collection.id],
            ourTeamData: nil,
            deviceChoice: deviceOurTeam(for: collection.id),
            today: Format.today()
        )
    }
}

@MainActor
@Observable
final class SeasonModel {
    let collection: TeamCollection
    var season: Season?
    var phase: LoadPhase = .idle

    init(collection: TeamCollection) {
        self.collection = collection
    }

    func load(_ repository: TeamRepository?, seasons: SeasonsModel) async {
        guard let repository, let catalog = seasons.catalog else { return }
        let schedule = seasons.schedules[collection.id]
        let deviceChoice = seasons.deviceOurTeam(for: collection.id)
        var ourTeamData: TeamData?
        // Without a confirmed schedule, fall back to Our team's own
        // TennisRecord schedule.
        if schedule == nil,
           let ourTeam = resolveOurTeam(collection: collection, teams: catalog.teams, schedule: nil, deviceChoice: deviceChoice) {
            if season == nil { phase = .loading }
            ourTeamData = try? await repository.teamData(ourTeam.team.id).value
        }
        season = buildSeason(
            collection: collection,
            teams: catalog.teams,
            schedule: schedule,
            ourTeamData: ourTeamData,
            deviceChoice: deviceChoice,
            today: Format.today()
        )
        phase = .loaded
    }
}
