import Foundation

/// `GET /api/team-roles/:collectionId`: Our team and scheduled opponents for a
/// season, shared with the web app. `saved` is false until someone chooses.
public struct TeamRoles: Codable, Hashable, Sendable {
    public var collectionId: String
    public var saved: Bool
    public var ourTeamId: String?
    public var scheduledOpponentIds: [String]
    public var revision: Int
    public var updatedAt: String?

    /// A season nobody has chosen roles for yet.
    public static func unsaved(_ collectionId: String) -> TeamRoles {
        TeamRoles(collectionId: collectionId, saved: false, ourTeamId: nil, scheduledOpponentIds: [], revision: 0)
    }

    /// Roles with `teamId` as Our team (or none); it leaves the scheduled
    /// opponents, as on the web app.
    public func choosingOurTeam(_ teamId: String?) -> TeamRoles {
        var next = self
        next.ourTeamId = teamId
        next.scheduledOpponentIds.removeAll { $0 == teamId }
        return next
    }
}

struct TeamRolesUpdate: Encodable {
    var ourTeamId: String?
    var scheduledOpponentIds: [String]
    /// The revision this change was made from; the server refuses the save
    /// when another device saved since.
    var baseRevision: Int
}

extension TeamRepository {
    public func teamRoles(_ collectionId: String) async throws -> Loaded<TeamRoles> {
        try await load(TeamRoles.self, key: "team-roles-\(collectionId)", path: "api/team-roles/\(collectionId)")
    }

    /// Saving needs the server; it never falls back to a saved copy.
    public func saveTeamRoles(_ roles: TeamRoles) async throws -> TeamRoles {
        let body = try JSONEncoder().encode(TeamRolesUpdate(
            ourTeamId: roles.ourTeamId,
            scheduledOpponentIds: roles.scheduledOpponentIds,
            baseRevision: roles.revision
        ))
        let saved = try await JSONDecoder().decode(
            TeamRoles.self,
            from: transport.put("api/team-roles/\(roles.collectionId)", body: body)
        )
        try? cache.store(JSONEncoder().encode(saved), for: "team-roles-\(roles.collectionId)")
        return saved
    }
}
