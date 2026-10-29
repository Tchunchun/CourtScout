# Tennis Court Scout iPhone app plan

Date: 2026-10-28

Status: Phase 2 (read-only native app) started on 2026-10-28 with a SwiftUI
client on the recommended architecture, against the local server. Phase 1
(hosting and auth) is not done yet. See `ios/README.md`. Running Phase 2 ahead
of Phase 1 is temporary: until Phase 1 ships, the app has no sign-in and only
reaches a trusted local server.

## Goal

Let a captain scout opponents and run Match Day from an iPhone, including at a
venue with poor connectivity, without weakening the data contract's rules on
source provenance and exact ratings.

## Architecture choice

### Recommended: SwiftUI client plus hosted Node backend

- Host `web/server.mjs` (Azure App Service or Container Apps is fine) and keep
  it as the only component that talks to TennisRecord, public UTR, and WTN.
- Build a SwiftUI app that reads and writes through `/api/*`.
- Move the pure, offline-useful logic onto the phone: lineup analysis and
  screenshot OCR.

### Considered and not recommended

| Option | Why not |
|---|---|
| Fully native app that scrapes on-device | Scraping TennisRecord/UTR from a shipped binary breaks whenever the sites change, needs an App Store update for every fix, and puts site-terms exposure in the app itself (see Risks). |
| Native app that signs in to UTR with one shared account on the server | Violates UTR terms and leaks one account's entitlement to every user. Never do this. |
| Wrapper around the web UI only (WKWebView) | Little gain over a home-screen web app, and App Review rejects thin wrappers (Guideline 4.2). |

### Quick win before any Swift

Host the current app behind sign-in and add it to the iPhone home screen as a
web app. This validates hosting, auth, and the shared store (Phase 1) with no
App Store work and stays useful as a fallback after the native app ships.

## API contract

The SwiftUI client depends on a formal, versioned API rather than on what
`app.js` happens to call today.

1. Prefix every route with `/api/v1/` and keep the current paths as aliases
   during the transition.
2. Describe the API in `contracts/api.openapi.yaml`, reusing
   `contracts/team-data.schema.json` for dataset bodies.
3. Routes the phone needs in the first native release:

| Route | Use on iPhone |
|---|---|
| `GET /api/v1/teams` | Team list and eligibility scopes |
| `GET /api/v1/team-data?team=` | Canonical dataset for offline cache |
| `GET /api/v1/analysis?team=&eligibility=` | Server analysis, used to check on-device results |
| `GET /api/v1/team-collections`, `POST`, collection/team routes | Event collections |
| `GET`/`PUT /api/v1/match-cards` | Match Day Card sync |
| event-schedule routes | Schedule review and confirmation |
| `POST /api/v1/team-preview`, `POST /api/v1/jobs`, `GET /api/v1/jobs/:id` | Start and watch a server-side collection |
| `POST /api/v1/refresh-jobs` | Refresh an existing team |
| `POST /api/v1/utr-screenshot/proposals` (new) | Optional server fallback for the screenshot path below |

4. Excluded from the phone: `/api/utr/connect` and `/api/utr/status`. They
   drive a local signed-in browser and do not make sense for a hosted server.
5. Every response carries `contractVersion`; the app refuses to write data with
   a newer major version than it understands. No response sends it today, so
   adding it is part of pre-work item 2.
6. The server also returns a minimum supported app version. Older builds show
   an "update required" screen instead of writing data, so a breaking server
   change cannot corrupt data from a stale TestFlight build.
7. Add bearer-token auth (Sign in with Apple to start) before hosting. The
   current server assumes a trusted localhost user. Sign-up is invite-only
   (see Accounts and sharing), which adds `POST /api/v1/invites`,
   `DELETE /api/v1/invites/:id`, and `POST /api/v1/invites/:token/redeem`.
8. Collection jobs (`POST /api/v1/jobs`, `POST /api/v1/refresh-jobs`) get a
   per-user rate limit and a shared server-side queue, so hosted users cannot
   overload TennisRecord or run up hosting costs.
9. Add `POST /api/v1/client-errors` (or use MetricKit) so builds in the field
   report crashes and decode or sync failures.

### Accounts and sharing

Decided on 2026-10-28: Phase 1 sign-up is invite-only, by QR code. There is
no open sign-up.

- **Bootstrap:** the owner's account is created on the server from
  configuration at deploy time. Every other account starts from an invite.
- **Creating an invite:** in Phase 1 only the owner can create invites. The
  owner picks the workspace and role, and the app or web app shows a QR code.
  `POST /api/v1/invites` returns `403` for everyone else. Letting captains
  invite is a later change to the role rules, not to the invite flow. The server
  stores the invite with its workspace, role, creator, expiry (7 days by
  default), and use count. Each invite is single-use by default and can be
  revoked before it is used.
- **QR contents:** an HTTPS link, `https://<host>/invite/<token>`. The token
  is random (at least 128 bits) and stored only as a hash. The link is a
  universal link: it opens the app when installed, and otherwise a web page
  that signs in to the home-screen web app.
- **Redeeming:** scanning with the Camera opens the link, the user signs in
  with Apple, and the server redeems the token in the same request that
  creates the account. A Sign in with Apple identity that has no account and
  no valid invite is rejected. Redemption is rate-limited, and expired, used,
  or revoked tokens give one generic error.
- **Existing users:** an invite redeemed by someone who already has an
  account adds the workspace to that account instead of creating a second one.
- **Who owns data:** user-owned state (Match Day Cards, notes, confirmed
  screenshot ratings) belongs to a team workspace, not to one person.
- **Still open:** the roles (for example captain, co-captain, player) and
  which of them can edit cards or only read. Who can invite after Phase 1.
- **App Review:** with invite-only sign-up, the review notes for Phase 5 must
  include a working invite or demo account, and account deletion is still
  required.

## Phone user flow

Revised on 2026-10-28 after reviewing the flow against the captain's job:
scout opponents, predict their lineup, and test Our lineup against it.

A season starts when the captain looks up their own team: the home-team run
gathers Our team and every league opponent into one event collection. The
phone therefore starts from seasons, not from a list of every gathered team.

1. **Seasons (home):** event collections, newest first, with Our team and the
   next match. A "New season" button (toolbar `+`, and the main action of the
   empty state) starts a season from the phone. P0: without it a new user's
   first screen is a dead end that sends them to the web app.
   - Paste or share a TennisRecord team profile link. A share extension from
     Safari is P1. **Done:** Share > Court Scout on a team page.
   - `POST /api/team-preview` shows the team name, league, level, and how many
     opponents will be gathered; the user confirms.
   - `POST /api/jobs` with `teamType: "home"` and public ratings only.
     Exact-UTR collection needs the server's signed-in browser, so the phone
     does not offer it.
   - If a home collection for that team already exists, offer to refresh it
     (`POST /api/refresh-jobs`) instead of creating a duplicate.
   - The new season appears at the top of the list with job progress from
     `GET /api/jobs/:id`. The job runs on the server, so the app can close;
     progress resumes when it reopens.
   - Disabled with an explanation when offline.
   - **Done.** The server already reuses the existing season for a team link
     it has gathered, so the phone says "Update" rather than offering a
     separate refresh. Jobs live in server memory: a stopped job shows on its
     season with "Start again", which passes the season id so a retry never
     creates a second season.
2. **Season:** Our team, the schedule in date order (upcoming, result not
   collected, completed), and the scouting pool. **Done.**
3. **Opponent threat board:** available players first, usual roles, rating
   freshness and source (exact or public band), regular partners, stacking
   patterns, and postseason coverage gaps shown next to predictions. P1.
   **Done** as `GET /api/threat-board` (`scripts/lib/threat-board.mjs`) and
   the Threats tab on a team. Stacking is read only from four or more matches
   with ratings on two or more courts.
4. **Prepare lineup / matchup:** Our lineup built from eligible, available
   players; court-by-court edges against each predicted scenario; expected
   courts won per scenario; and the lineup that holds up across scenarios.
   **Done** as `POST /api/matchup`, which reuses `web/public/match-card.mjs`
   (the scenario assembly moved there from `app.js`, so web and phone share
   it).
5. **Day of match:** availability, posted-lineup photo, final lineup sharing,
   results. P2.

| Priority | Scope | Status |
|---|---|---|
| P0 | Seasons home, season screen, Our team | Done (Our team shared with the web app through `/api/team-roles`) |
| P0 | Matchup screen | Done (lineup saved on device; not yet a web Match Day Card) |
| P0 | New season from the home screen (paste link, preview, start job, progress) | Done (job progress saved to `data/jobs/`; a restart reports the job as interrupted and offers Start again) |
| P1 | Threat board, scenario differences, coverage warnings, share extension for team links | Threat board and coverage warnings done (`GET /api/threat-board`, the team's Threats tab); scenario differences done (each matchup challenge carries `differences` from the first scenario); share extension done (`ios/ShareExtension`; the app moved from `CourtScout.swiftpm` to `CourtScout.xcodeproj`, since a Swift Playgrounds package cannot hold an extension) |
| P1+ | Add matches as they are announced: local playoffs and playoff final, Sectionals round robin and final, Nationals round robin, semifinal, and final | Done (`POST`/`DELETE /api/event-schedules/:id/matches`, kept across schedule re-imports; the season's Add match, the Prepare sheet for a published round robin, and the share sheet for a team not yet in the season) |
| P2 | Day-of availability, lineup photo, sharing, results | Not started |

## Logic that moves on-device

| Logic | Source today | On-device plan |
|---|---|---|
| Lineup prediction and evidence scoring | `scripts/lib/analysis.mjs` (`analyzeTeam`, `analyzeEligibility`, `analyzeSingles`, `analyzeDoubles`, `analyzeLineupPredictions`) | Port to Swift. Golden-file tests (below) must match the JS output exactly before the Swift port is trusted. |
| Match Day lineup scoring | `web/public/match-card.mjs` | Port to Swift alongside analysis. |
| Result screenshot OCR | `/api/result-ocr` with tesseract.js | Apple Vision `VNRecognizeTextRequest`. Same downstream parser. |
| UTR screenshot parsing and name matching | `scripts/lib/utr-screenshot.mjs` | Port the parser and matcher to Swift; feed it Vision text. Shares fixtures with the JS tests. |
| Collection and scraping | `scripts/collect-team.mjs`, collectors | Stays on the server. |

Porting `analysis.mjs` is the largest risk in this plan. Two alternatives worth
checking in a spike before committing to a Swift port:

- run the existing ES module in `JavaScriptCore` on the phone, so there is one
  implementation, or
- keep analysis server-side and cache the last `analysis/<scope>.json` snapshot
  for offline Match Day.

The cached-snapshot option is enough for offline Match Day if lineups are
prepared beforehand; the port is only needed to recompute analysis offline.

Cached snapshots are the fallback for this season. A JavaScriptCore spike at
the start of Phase 3, limited to running `analyzeTeam` against the golden
files, decides whether Phase 3 recomputes analysis on-device.

## Exact UTR on iPhone

1. Default to public masked UTR, TennisRecord ratings, and WTN.
2. Exact decimals come from the user's own screenshots of UTR profiles or
   team lists. Vision reads them, `utr-screenshot` proposes matches with a
   confidence score, and the user confirms each match before anything is
   saved. A prototype exists today as `scripts/utr-screenshot-ocr.mjs`.
3. Confirmed screenshot ratings are stored with a distinct provenance
   (`lookupStatus: "user_screenshot_confirmed"`, source type
   `utr_user_screenshot`), the capture date, and the OCR confidence, so the
   analysis can tell them apart from authenticated profile reads. This needs a
   contract update before ratings are written.
4. In parallel, ask UTR about official partner API access.
5. Calling UTR's data service directly with the user's own login is an
   unofficial, opt-in fallback only. Credentials stay in the iOS Keychain and
   never reach our server.
6. Never use one shared UTR account on a server.

## Data ownership and storage

Decided on 2026-10-29: start locally, behind a storage layer, and move to the
cloud as a copy rather than a rewrite. Start light; add a database only when
it is needed.

| Kind | Examples | Owner | Home |
|---|---|---|---|
| Scouting data | `team-data.json`, `analysis/<scope>.json` | Shared; can be gathered again | Server store |
| Team workspace data | Seasons, Our team and team roles, Match Day Cards, event schedules, gathering jobs | A workspace (a captain and invited members) | Server store |
| Personal and device data | Server address, sign-in token, a user's own UTR login, lineup drafts, UI preferences | One person on one device | Phone: Keychain for secrets, UserDefaults for the rest. Browser: localStorage |

Team workspace data has one home, the server. The web app and the phone read
and write the same records; their local copies are offline caches only.

**Storage layer** (`scripts/lib/store.mjs`): JSON documents by key, with an
ETag on every read and an optional `ifMatch` on writes, so two people saving at
once get a conflict instead of overwriting each other.

1. **Now (local):** a file-system store on the `data/` folder. Keys are paths
   relative to it, so the layout is unchanged. Workspace documents are keyed by
   workspace; the single `default` workspace keeps today's file names
   (`team-collections.json`, `match-cards.json`, `event-schedules.json`,
   `team-roles.json`), and any later workspace uses `workspaces/<id>/<name>`.
   Gathering jobs are saved as `jobs/<id>.json`, so a restarted server still
   reports a job, as interrupted, instead of forgetting it.
2. **Cloud (Phase 1):** one Azure App Service (Linux B1, Always On, exactly one
   instance, since running gathers live in server memory) and Azure Blob
   Storage implementing the same store with the same keys and native ETags.
   Moving is copying `data/` into a container. Sign-in ships with hosting, never
   after it. The hosted server collects public UTR only; exact UTR stays on the
   owner's Mac or comes from confirmed screenshots.
3. **Later, only if needed:** a database (Cosmos DB or Postgres) when queries
   across many workspaces call for one.

Once the cloud store has backups, stop committing `data/` to git. Until then,
the private repository is the backup.

## Data sync

- The storage layer above carries `team-collections.json`,
  `match-cards.json`, `event-schedules.json`, and team roles today; in Phase 1
  the dataset folders move behind it too, as Blob documents.
- The phone keeps an offline cache: SwiftData or SQLite for collections, cards,
  and schedules; cached `team-data.json` and analysis snapshots as files.
- The offline cache lives in Application Support, not Caches: iOS can purge
  the Caches directory under storage pressure, which would lose a report right
  before a match. Match Day data is never evicted automatically; the user
  removes it. (Done: `OfflineCache` uses Application Support and moves older copies from Caches once.)
- "Prepare for match day" downloads an event in one step: every opponent's
  `team-data.json`, analysis snapshots for the needed eligibility scope, the
  event schedule, and the Match Day Cards. Only opening a report is not enough
  to cache it.
- Every cached report shows its age ("saved 2 days ago") and the dataset's
  retrieval date, so the user knows how stale it is.
- Canonical datasets are read-only on the phone. Only the server collects or
  refreshes them, matching the contract rule that analysis never rewrites
  source data.
- User-owned state (Match Day Cards, roles, notes, confirmed screenshot
  ratings) syncs both ways. Each record carries `updatedAt` and a revision
  number; the server rejects stale writes with `409` and the app shows both
  versions for the user to choose. Last-writer-wins is acceptable only for
  per-device UI preferences.
- Match Day Cards keep working offline and queue writes until the phone is
  back online.
- Server pre-work for this: `PUT /api/match-cards` replaces the whole card list
  today. Phase 3 needs per-card routes (`PUT /api/v1/match-cards/:id`) with a
  card ID, revision, and `409` on stale writes, and each queued write carries
  an idempotency key so a retry after a dropped connection is not applied
  twice.

## App Store and terms-of-use risks

| Risk | Mitigation |
|---|---|
| TennisRecord and UTR terms may forbid automated collection or redistribution | Collection stays on the server, paced and cached as today. Review each site's terms before hosting for anyone beyond the owner's own team. Keep the app useful without UTR. |
| App Review Guideline 5.2 (intellectual property) for third-party data | Show sources and retrieval dates; do not use UTR, USTA, or TennisRecord branding; attribute each rating to its source. |
| Guideline 4.2 (minimum functionality) | Ship native Match Day, offline cards, and Vision OCR so the app is clearly more than a website. |
| Guideline 5.1 (privacy) | Player names and ratings are personal data. Publish a privacy policy, add an account deletion flow (required when sign-in exists), and fill in the privacy nutrition labels. |
| Unofficial UTR login fallback | Off by default, clearly labeled, credentials only in the Keychain. Drop it if UTR objects or a partner API becomes available. |
| Screenshot OCR misreads a rating | Every match needs user confirmation; masked bands stay masked; low OCR confidence forces review. |
| Hosted collection jobs overload source sites or run up costs | Per-user rate limits and a shared job queue on the server (API contract item 8). |

## Match Day usability

Match Day happens courtside, often in sunlight and in a hurry. Match Day views
support Dynamic Type and high-contrast colors, use large tap targets, and keep
the lineup and score entry reachable with one hand. Check these with
Accessibility Inspector before Phase 3 is done.

## Pre-work (before Swift)

1. Split `web/public/app.js` into modules by view so the API calls the UI
   depends on are visible.
2. Version and document `/api/*` (see API contract), including
   `contractVersion` and the minimum app version in every response.
3. Turn test fixtures into golden files: a small set of `team-data.json`
   inputs with checked-in `analysis/<scope>.json` outputs, validated against
   the schema in `npm test`. The Swift port must reproduce them.
4. Move `team-collections.json` and `match-cards.json` into the shared store.
   Started: they, event schedules, team roles, and job records go through the
   local storage layer (see Data ownership and storage); the Blob store remains.
5. Replace whole-list `PUT /api/match-cards` with per-card routes that carry a
   revision and accept an idempotency key (see Data sync).
6. Add rate limits and a queue for collection jobs.

## Milestones

| Phase | Scope | Done when |
|---|---|---|
| 0. Screenshot prototype | `scripts/utr-screenshot-ocr.mjs` and tests (done); try it on real UTR profile and roster screenshots | Real screenshots parse with the expected pairs, or parser fixes are captured as fixtures |
| 1. Hosted backend | Pre-work items 2–6, Sign in with Apple with invite-only QR sign-up, workspace roles, Azure App Service and Blob Storage over HTTPS, home-screen web app | A second person joins by scanning an invite QR code; the owner uses the hosted web app from an iPhone for a real match; and the native app runs on a physical iPhone against the hosted server over HTTPS |
| 2. Read-only native app | SwiftUI shell, `Codable` types generated from the schema, teams, rosters, analysis views, offline cache in Application Support, "prepare for match day" download, cache age display (done on the iOS Simulator on 2026-10-29: a prepared season's opponents open with the server stopped; not yet tested on a physical iPhone in airplane mode) | After preparing an event and switching to airplane mode, every opponent's report opens with its saved age shown |
| 3. Native Match Day | JavaScriptCore spike decides on-device analysis; Match Day Cards with per-card sync, conflict handling, and idempotent retries; lineup scoring on-device or from cached snapshots; Match Day usability checks; client error reporting | A full Match Day runs offline and syncs afterward, with no duplicated or lost card edits |
| 4. Vision OCR | Result screenshots and UTR screenshots through Vision, confirmation UI, contract update for screenshot provenance | A user confirms exact UTR from screenshots and the ratings appear in reports with the right provenance |
| 5. TestFlight and App Store | Privacy policy, account deletion, review notes with a working invite or demo account, terms review | Approved TestFlight build; App Store submission when the terms review is clear |

## Open decisions for the owner

1. Whether the native app reaches TestFlight this season, or the hosted web
   app is enough until next season. (Native work has started in Phase 2.)
2. Swift port of `analysis.mjs` vs. JavaScriptCore vs. cached snapshots.
   Cached snapshots are the default for this season; the Phase 3 spike decides
   the rest.
3. Whether to contact UTR about partner API access now.
4. ~~Whether to generate Swift `Codable` types now.~~ Done: `ios/CourtScoutModels`.
5. ~~Who can sign up.~~ Decided: invite-only by QR code (see Accounts and
   sharing). Only the owner creates invites in Phase 1. Still open: workspace
   roles, and who else can invite after Phase 1.
