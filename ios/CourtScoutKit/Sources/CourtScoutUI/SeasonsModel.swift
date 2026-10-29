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

    init(defaults: UserDefaults = SharedStore.defaults) {
        self.defaults = defaults
        prepared = defaults.data(forKey: Self.preparedKey)
            .flatMap { try? JSONDecoder().decode([String: PreparedRecord].self, from: $0) } ?? [:]
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

    // MARK: Match day

    /// What was saved for offline use, per collection id.
    struct PreparedRecord: Codable, Equatable {
        var savedAt: Date
        var teamIds: [String]
        /// Teams that could not be saved, so their copies may be old or missing.
        var failedTeamIds: [String]
    }

    struct PrepareProgress: Equatable {
        var done: Int
        var total: Int
    }

    private static let preparedKey = "matchDayPrepared"

    /// Read from defaults at start, then kept in memory so the screen updates.
    private(set) var prepared: [String: PreparedRecord] = [:]

    /// Downloads in progress, per collection id.
    var preparing: [String: PrepareProgress] = [:]

    /// Saves Our team and the chosen opponents for offline use at the venue.
    /// The seasons list, schedules, and roles are refreshed first, since the
    /// season screen reads them too.
    func prepare(_ season: Season, teamIds: [String], repository: TeamRepository?) async {
        guard let repository else { return }
        let collectionId = season.collection.id
        let ourTeamId = season.ourTeam?.id
        let all = (ourTeamId.map { [$0] } ?? []) + teamIds.filter { $0 != ourTeamId }
        preparing[collectionId] = PrepareProgress(done: 0, total: all.count)
        await load(repository)
        var failed: [String] = []
        for (index, teamId) in all.enumerated() {
            do {
                try await repository.prepareTeam(
                    teamId,
                    ourTeamId: teamId == ourTeamId ? nil : ourTeamId,
                    eligibility: season.collection.competitionLevel
                )
            } catch {
                failed.append(teamId)
            }
            preparing[collectionId] = PrepareProgress(done: index + 1, total: all.count)
        }
        prepared[collectionId] = PreparedRecord(savedAt: .now, teamIds: all, failedTeamIds: failed)
        defaults.set(try? JSONEncoder().encode(prepared), forKey: Self.preparedKey)
        preparing[collectionId] = nil
    }

    // MARK: Seasons being gathered

    /// Latest state of the jobs started on this device, by slot: the
    /// collection id for a season's own gathering, "collection|team key" for
    /// a playoff opponent.
    var jobs: [String: CollectionJob] = [:]

    /// What is needed to follow, or restart, a job after a relaunch.
    struct TrackedJob: Codable {
        var collectionId: String
        var teamUrl: String
        var competitionLevel: String
        /// Set for a playoff opponent being gathered or refreshed.
        var playoffTeamKey: String?

        var slot: String { playoffTeamKey.map { SeasonsModel.playoffSlot(collectionId, $0) } ?? collectionId }
    }

    nonisolated static func playoffSlot(_ collectionId: String, _ teamKey: String) -> String {
        "\(collectionId)|\(teamKey)"
    }

    func playoffJob(_ collectionId: String, _ teamKey: String) -> CollectionJob? {
        jobs[Self.playoffSlot(collectionId, teamKey)]
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
        trackedJobs.values.contains { jobs[$0.slot]?.isFinished != true }
    }

    func track(_ job: CollectionJob, teamUrl: String, competitionLevel: String) {
        guard let collectionId = job.eventCollectionId else { return }
        trackedJobs = trackedJobs.filter { $0.value.slot != collectionId }
        trackedJobs[job.id] = TrackedJob(collectionId: collectionId, teamUrl: teamUrl, competitionLevel: competitionLevel)
        jobs[collectionId] = job
    }

    func dismissJob(for slot: String) {
        trackedJobs = trackedJobs.filter { $0.value.slot != slot }
        jobs[slot] = nil
    }

    /// Adds the bracket's next opponent: the server gathers the team into the
    /// season, or refreshes it when the season already has it.
    func addPlayoffOpponent(
        _ teamUrl: String,
        name: String?,
        to collection: TeamCollection,
        repository: TeamRepository?
    ) async throws -> PlayoffOpponentAdded? {
        guard let repository else { return nil }
        let added = try await repository.addPlayoffOpponent(teamUrl, name: name, to: collection.id)
        if let index = collections.firstIndex(where: { $0.id == collection.id }) {
            collections[index] = added.collection
        }
        if let teamKey = added.collection.playoffOpponents?.first(where: { $0.teamUrl == teamUrl })?.teamKey {
            let slot = Self.playoffSlot(collection.id, teamKey)
            trackedJobs = trackedJobs.filter { $0.value.slot != slot }
            trackedJobs[added.job.id] = TrackedJob(
                collectionId: collection.id,
                teamUrl: teamUrl,
                competitionLevel: collection.competitionLevel ?? "local",
                playoffTeamKey: teamKey
            )
            jobs[slot] = added.job
        }
        return added
    }

    func removePlayoffOpponent(_ teamKey: String, from collection: TeamCollection, repository: TeamRepository?) async throws {
        guard let repository else { return }
        try await repository.removePlayoffOpponent(teamKey, from: collection.id)
        dismissJob(for: Self.playoffSlot(collection.id, teamKey))
        if let index = collections.firstIndex(where: { $0.id == collection.id }) {
            collections[index].playoffOpponents?.removeAll { $0.teamKey == teamKey }
        }
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
        guard let repository, let tracked = trackedJobs.values.first(where: { $0.slot == collectionId })
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
            let slot = tracked.slot
            let previous = jobs[slot]
            if previous?.isFinished == true { continue }
            do {
                let job = try await repository.job(jobId)
                jobs[slot] = job
                if job.collectedTeamCount != previous?.collectedTeamCount || job.isFinished || offlineSince != nil {
                    reload = true
                }
                if job.status == "complete" && job.warning == nil {
                    trackedJobs[jobId] = nil
                    jobs[slot] = nil
                }
            } catch APIError.http(status: 404, _) {
                // Jobs live in server memory; a restart forgets them.
                jobs[slot] = .lost(id: jobId, collectionId: collectionId, last: previous)
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
    /// The season as last loaded; playoff opponents change while it is open.
    private(set) var collection: TeamCollection
    var season: Season?
    var phase: LoadPhase = .idle

    init(collection: TeamCollection) {
        self.collection = collection
    }

    func load(_ repository: TeamRepository?, seasons: SeasonsModel) async {
        guard let repository, let catalog = seasons.catalog else { return }
        collection = seasons.collections.first { $0.id == collection.id } ?? collection
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
