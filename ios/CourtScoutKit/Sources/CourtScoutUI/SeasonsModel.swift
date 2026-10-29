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
    /// Team roles shared with the web app, per collection id.
    var roles: [String: TeamRoles] = [:]
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
            try Task.checkCancellation()
            let catalog = try await repository.catalog()
            let collections = try await repository.collections()
            var schedules: [String: EventSchedule] = [:]
            var roles: [String: TeamRoles] = [:]
            var pending: [TeamRoles] = []
            for collection in collections.value.collections {
                if let schedule = try? await repository.eventSchedule(collection.id).value.schedule {
                    schedules[collection.id] = schedule
                }
                if let loaded = try? await repository.teamRoles(collection.id) {
                    roles[collection.id] = loaded.value
                    if loaded.source == .live, let choice = deviceOurTeam(for: collection.id) {
                        pending.append(loaded.value.choosingOurTeam(choice))
                    }
                }
            }
            self.catalog = catalog.value
            self.collections = collections.value.collections
            self.schedules = schedules
            self.roles = roles
            // Choices made offline are shared once the server answers.
            for choice in pending {
                _ = await save(choice, repository: repository)
            }
            offlineSince = catalog.source == .offline || collections.source == .offline
                ? min(catalog.savedAt, collections.savedAt) : nil
            phase = .loaded
        } catch is CancellationError {
            // Keep what is shown; the next load replaces it.
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // Our team chosen on this device while the server was unreachable; it is
    // shared, and forgotten here, on the next load that reaches the server.
    func deviceOurTeam(for collectionId: String) -> String? {
        defaults.string(forKey: "ourTeam.\(collectionId)")
    }

    private func setDeviceOurTeam(_ teamId: String?, for collectionId: String) {
        defaults.set(teamId, forKey: "ourTeam.\(collectionId)")
    }

    /// Shares a new Our team with the web app. Returns a note when it could
    /// not be shared as chosen.
    func chooseOurTeam(_ teamId: String?, for collectionId: String, repository: TeamRepository?) async -> String? {
        let current = roles[collectionId] ?? .unsaved(collectionId)
        guard let repository else { return nil }
        return await save(current.choosingOurTeam(teamId), repository: repository)
    }

    private func save(_ next: TeamRoles, repository: TeamRepository) async -> String? {
        let collectionId = next.collectionId
        do {
            roles[collectionId] = try await repository.saveTeamRoles(next)
            setDeviceOurTeam(nil, for: collectionId)
            return nil
        } catch APIError.http(status: 409, _) {
            setDeviceOurTeam(nil, for: collectionId)
            roles[collectionId] = try? await repository.teamRoles(collectionId).value
            return "Our team was changed on another device, so that choice is shown."
        } catch APIError.http(_, let message) {
            return message
        } catch {
            if let teamId = next.ourTeamId {
                setDeviceOurTeam(teamId, for: collectionId)
                return "Saved on this phone. It will be shared when the server is reachable."
            }
            return "Can’t reach the Court Scout server, so Our team was not cleared."
        }
    }

    // MARK: Seasons being gathered

    /// Latest state of the season jobs started on this device, by collection id.
    var jobs: [String: CollectionJob] = [:]

    /// What is needed to follow, or restart, a season job after a relaunch.
    struct TrackedJob: Codable {
        var collectionId: String
        var teamUrl: String
        var competitionLevel: String
    }

    /// Tracked jobs by job id.
    private var trackedJobs: [String: TrackedJob] {
        get {
            (defaults.data(forKey: "seasonJobs"))
                .flatMap { try? JSONDecoder().decode([String: TrackedJob].self, from: $0) } ?? [:]
        }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "seasonJobs") }
    }

    var hasRunningJobs: Bool {
        trackedJobs.values.contains { jobs[$0.collectionId]?.isFinished != true }
    }

    func track(_ job: CollectionJob, teamUrl: String, competitionLevel: String) {
        guard let collectionId = job.eventCollectionId else { return }
        trackedJobs = trackedJobs.filter { $0.value.collectionId != collectionId }
        trackedJobs[job.id] = TrackedJob(collectionId: collectionId, teamUrl: teamUrl, competitionLevel: competitionLevel)
        jobs[collectionId] = job
    }

    func dismissJob(for collectionId: String) {
        trackedJobs = trackedJobs.filter { $0.value.collectionId != collectionId }
        jobs[collectionId] = nil
    }

    /// Gathers the scheduled opponents a season does not have yet. The server
    /// reuses the teams already in the season.
    func gatherMissing(in collection: TeamCollection, homeTeamUrl: String, repository: TeamRepository?) async throws {
        guard let repository else { return }
        let level = collection.competitionLevel ?? "local"
        let job = try await repository.startSeason(teamUrl: homeTeamUrl, competitionLevel: level, into: collection.id)
        track(job, teamUrl: homeTeamUrl, competitionLevel: level)
    }

    /// Starts a stopped season's gathering again into the same season.
    func restartJob(for collectionId: String, repository: TeamRepository?) async throws {
        guard let repository, let tracked = trackedJobs.values.first(where: { $0.collectionId == collectionId })
        else { return }
        let job = try await repository.startSeason(
            teamUrl: tracked.teamUrl,
            competitionLevel: tracked.competitionLevel,
            into: collectionId
        )
        track(job, teamUrl: tracked.teamUrl, competitionLevel: tracked.competitionLevel)
    }

    /// Polls each tracked job once. Returns true when the seasons should
    /// reload: teams were added, a job ended, or the server answered again
    /// after the list was loaded offline. A finished job stops being
    /// tracked; a failed one stays on its season until dismissed.
    func refreshJobs(_ repository: TeamRepository?) async -> Bool {
        guard let repository else { return false }
        var reload = false
        for (jobId, tracked) in trackedJobs {
            let collectionId = tracked.collectionId
            let previous = jobs[collectionId]
            if previous?.isFinished == true { continue }
            do {
                let job = try await repository.job(jobId)
                jobs[collectionId] = job
                if job.collectedTeamCount != previous?.collectedTeamCount || job.isFinished || offlineSince != nil {
                    reload = true
                }
                if job.status == "complete" && job.warning == nil {
                    trackedJobs[jobId] = nil
                    jobs[collectionId] = nil
                }
            } catch APIError.http(status: 404, _) {
                // Jobs live in server memory; a restart forgets them.
                jobs[collectionId] = .lost(id: jobId, collectionId: collectionId, last: previous)
                reload = true
            } catch {
                // Unreachable: keep the last state and try again later.
            }
        }
        return reload
    }

    /// Season summary for the home list, from the confirmed schedule only.
    func summary(for collection: TeamCollection) -> Season? {
        guard let catalog else { return nil }
        return buildSeason(
            collection: collection,
            teams: catalog.teams,
            schedule: schedules[collection.id],
            ourTeamData: nil,
            roles: roles[collection.id],
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
        let roles = seasons.roles[collection.id]
        var ourTeamData: TeamData?
        // Without a confirmed schedule, fall back to Our team's own
        // TennisRecord schedule.
        if schedule == nil,
           let ourTeam = resolveOurTeam(
               collection: collection, teams: catalog.teams, schedule: nil, roles: roles, deviceChoice: deviceChoice
           ) {
            if season == nil { phase = .loading }
            ourTeamData = try? await repository.teamData(ourTeam.team.id).value
        }
        season = buildSeason(
            collection: collection,
            teams: catalog.teams,
            schedule: schedule,
            ourTeamData: ourTeamData,
            roles: roles,
            deviceChoice: deviceChoice,
            today: Format.today()
        )
        phase = .loaded
    }
}
