import CourtScoutCore
import Foundation

// Usage: swift run --package-path ios/CourtScoutKit verify-kit [server-address]
// Needs a running server (`npm start`). Checks that every catalog team's
// dataset and analysis decode, and that the offline cache takes over when the
// server is unreachable.

struct UnreachableTransport: HTTPTransport {
    func get(_ path: String, query: [URLQueryItem]) async throws -> Data {
        throw URLError(.notConnectedToInternet)
    }

    func post(_ path: String, body: Data) async throws -> Data {
        throw URLError(.notConnectedToInternet)
    }
}

let address = CommandLine.arguments.dropFirst().first ?? "http://localhost:4173"
let cacheDirectory = FileManager.default.temporaryDirectory
    .appending(path: "court-scout-verify-\(UUID().uuidString)", directoryHint: .isDirectory)
let cache = OfflineCache(directory: cacheDirectory)
defer { try? cache.removeAll() }

var failures: [String] = []
func check(_ condition: Bool, _ message: @autoclosure () -> String) {
    if !condition { failures.append(message()) }
}

do {
    let live = TeamRepository(transport: try URLSessionTransport(serverAddress: address), cache: cache)
    let catalog = try await live.catalog()
    let collections = try await live.collections()
    check(!catalog.value.teams.isEmpty, "Catalog has no teams")
    check(catalog.source == .live, "Catalog did not come from the server")

    let sections = groupTeams(catalog.value.teams, collections: collections.value.collections)
    check(sections.flatMap(\.teams).count == catalog.value.teams.count, "Grouping lost or duplicated teams")

    var analyses = 0
    for summary in catalog.value.teams {
        do {
            let data = try await live.teamData(summary.id)
            check(data.value.datasetId == summary.datasetId, "\(summary.datasetId): dataset id mismatch")
            if summary.reportAvailable != false {
                let analysis = try await live.analysis(summary.id)
                check(analysis.value.eligibility.players.count == analysis.value.eligibility.summary.rosterSize,
                      "\(summary.datasetId): eligibility player count")
                analyses += 1
            }
        } catch {
            failures.append("\(summary.datasetId): \(error)")
        }
    }

    // Seasons: Our team, schedule, and opponent links.
    let today = ISO8601DateFormatter.string(from: .now, timeZone: .current, formatOptions: [.withFullDate])
    var seasonLines: [String] = []
    for collection in orderedSeasons(collections.value.collections) {
        let schedule = try await live.eventSchedule(collection.id).value.schedule
        let season = buildSeason(
            collection: collection, teams: catalog.value.teams, schedule: schedule,
            ourTeamData: nil, deviceChoice: nil, today: today
        )
        check(season.teams.count == collection.teamDatasetIds.count, "\(collection.name): season lost teams")
        let pooled = season.scoutingPool.count + Set(season.matches.compactMap { $0.opponent?.id }).count +
            (season.ourTeam == nil ? 0 : 1)
        check(pooled == season.teams.count, "\(collection.name): teams missing from schedule and pool")
        if let schedule {
            check(season.ourTeam?.id == schedule.ourTeamId, "\(collection.name): Our team not from schedule")
            check(season.matches.count == schedule.matches.count, "\(collection.name): schedule rows lost")
            check(season.matches.allSatisfy { $0.opponent != nil }, "\(collection.name): unlinked opponent")

            // Without the confirmed schedule, Our team's TennisRecord schedule
            // must still find the same opponents by profile link.
            let ours = try await live.teamData(schedule.ourTeamId).value
            let fallback = buildSeason(
                collection: collection, teams: catalog.value.teams, schedule: nil,
                ourTeamData: ours, deviceChoice: schedule.ourTeamId, today: today
            )
            check(fallback.scheduleSource == .tennisRecord, "\(collection.name): fallback schedule unused")
            check(fallback.matches.compactMap { $0.opponent?.id }.sorted() ==
                  season.matches.compactMap { $0.opponent?.id }.sorted(),
                  "\(collection.name): fallback linked different opponents")
        }
        seasonLines.append("\(collection.name): our team \(season.ourTeam?.team.name ?? "not set"), " +
            "\(season.matches.count) scheduled, \(season.scoutingPool.count) in scouting pool")
    }

    // Matchups: every scheduled opponent in seasons with a confirmed schedule,
    // plus one single-gender Nationals pairing with history on both sides.
    // Opponents are resolved the way the season screen does it, since a
    // confirmed schedule can link to a dataset folder that was replaced.
    var matchupPairs: [(String, String)] = []
    for collection in collections.value.collections {
        guard let schedule = try await live.eventSchedule(collection.id).value.schedule else { continue }
        let season = buildSeason(
            collection: collection, teams: catalog.value.teams, schedule: schedule,
            ourTeamData: nil, deviceChoice: nil, today: today
        )
        if let ours = season.ourTeam {
            matchupPairs += Set(season.matches.compactMap { $0.opponent?.id }).sorted().map { (ours.id, $0) }
        }
    }
    let nationals = catalog.value.teams.filter { $0.id.contains("3.0-women-nationals") }
    if let ours = nationals.first(where: { $0.datasetId.contains("sunnyvale") }),
       let theirs = nationals.first(where: { $0.datasetId.contains("eastern") }) {
        matchupPairs.append((ours.id, theirs.id))
        let matchup = try await live.matchup(ourTeamId: ours.id, opponentTeamId: theirs.id).value
        check(matchup.scenarios.map(\.scenarioType) == ["most_likely", "rating_ceiling", "alternate"],
              "Nationals matchup scenarios: \(matchup.scenarios.map(\.scenarioType))")
        check(matchup.validation.valid, "Suggested Nationals lineup is not valid")
        check(matchup.challenges.allSatisfy { $0.comparisons.count == 5 }, "Nationals courts missing")

        // Swapping S1 and S2 keeps every player listed once and is re-checked.
        let s1 = matchup.player(court: "S1", slot: 0)!, s2 = matchup.player(court: "S2", slot: 0)!
        let swapped = assigning(s2, to: "S1", slot: 0, in: matchup.draft)
        check(swapped["S1"] == [s2] && swapped["S2"] == [s1], "Swap did not exchange S1 and S2")
        let rechecked = try await live.matchup(ourTeamId: ours.id, opponentTeamId: theirs.id, draft: swapped).value
        check(rechecked.draft == swapped && rechecked.validation.valid, "Server did not keep the swapped lineup")
        let cleared = assigning(nil, to: "D1", slot: 1, in: swapped)
        let incomplete = try await live.matchup(ourTeamId: ours.id, opponentTeamId: theirs.id, draft: cleared).value
        check(!incomplete.validation.complete, "An open slot was not reported")

        // Offline, the last comparison for the pair comes back from the cache.
        let offlineMatchup = try await TeamRepository(transport: UnreachableTransport(), cache: cache)
            .matchup(ourTeamId: ours.id, opponentTeamId: theirs.id)
        check(offlineMatchup.source == .offline && offlineMatchup.value.draft == cleared,
              "Offline matchup is not the last one fetched")
    } else {
        failures.append("Nationals teams for the matchup check not found")
    }
    for (ourId, opponentId) in matchupPairs {
        do {
            let matchup = try await live.matchup(ourTeamId: ourId, opponentTeamId: opponentId).value
            check(matchup.challenges.count == matchup.scenarios.count, "\(opponentId): challenge per scenario")
        } catch {
            failures.append("matchup \(opponentId): \(error)")
        }
    }
    do {
        _ = try await live.matchup(ourTeamId: matchupPairs[0].0, opponentTeamId: "collections/missing")
        failures.append("Matchup with an unknown opponent did not fail")
    } catch APIError.http {}

    // An explicit scope is honored.
    let local = try await live.analysis(catalog.value.teams[0].id, scope: "local")
    check(local.value.eligibility.scope == "local", "Explicit eligibility scope ignored")

    // Offline: everything fetched above must load from the cache, marked offline.
    let offline = TeamRepository(transport: UnreachableTransport(), cache: cache)
    let cachedCatalog = try await offline.catalog()
    check(cachedCatalog.source == .offline, "Offline catalog not marked offline")
    check(cachedCatalog.value == catalog.value, "Offline catalog differs from live")
    let first = catalog.value.teams[0]
    let cachedData = try await offline.teamData(first.id)
    check(cachedData.value.datasetId == first.datasetId, "Offline dataset differs")
    do {
        _ = try await offline.teamData("collections/never-fetched")
        failures.append("Uncached team loaded while offline")
    } catch {}

    // Server errors are not hidden behind the cache.
    do {
        _ = try await live.teamData("collections/does-not-exist")
        failures.append("Unknown team did not fail")
    } catch APIError.http {
    } catch {
        failures.append("Unknown team failed with \(error), not an HTTP error")
    }

    if failures.isEmpty {
        seasonLines.forEach { print("  \($0)") }
        print("  \(matchupPairs.count) matchups decoded")
        print("verify-kit: \(catalog.value.teams.count) teams and \(analyses) analyses decoded from \(address); offline cache checks passed")
    }
} catch {
    failures.append("\(error)")
}

if !failures.isEmpty {
    failures.forEach { print("FAIL \($0)") }
    print("verify-kit: \(failures.count) failure(s)")
    exit(1)
}
