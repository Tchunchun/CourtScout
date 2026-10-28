# Tennis Court Scout iPhone app plan

Date: 2026-10-28

Status: Proposal. The owner has not yet chosen an architecture; this document
records the recommended path so the decision can be made against concrete
phases.

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
   a newer major version than it understands.
6. Add bearer-token auth (Sign in with Apple to start) before hosting. The
   current server assumes a trusted localhost user.

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

## Data sync

- Phase 1 moves `team-collections.json`, `match-cards.json`, and the dataset
  folders into a real store (Azure Cosmos DB or Postgres for documents; Blob
  Storage for `team-data.json` and analysis snapshots).
- The phone keeps an offline cache: SwiftData or SQLite for collections, cards,
  and schedules; cached `team-data.json` and analysis snapshots as files.
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

## App Store and terms-of-use risks

| Risk | Mitigation |
|---|---|
| TennisRecord and UTR terms may forbid automated collection or redistribution | Collection stays on the server, paced and cached as today. Review each site's terms before hosting for anyone beyond the owner's own team. Keep the app useful without UTR. |
| App Review Guideline 5.2 (intellectual property) for third-party data | Show sources and retrieval dates; do not use UTR, USTA, or TennisRecord branding; attribute each rating to its source. |
| Guideline 4.2 (minimum functionality) | Ship native Match Day, offline cards, and Vision OCR so the app is clearly more than a website. |
| Guideline 5.1 (privacy) | Player names and ratings are personal data. Publish a privacy policy, add an account deletion flow (required when sign-in exists), and fill in the privacy nutrition labels. |
| Unofficial UTR login fallback | Off by default, clearly labeled, credentials only in the Keychain. Drop it if UTR objects or a partner API becomes available. |
| Screenshot OCR misreads a rating | Every match needs user confirmation; masked bands stay masked; low OCR confidence forces review. |

## Pre-work (before Swift)

1. Split `web/public/app.js` into modules by view so the API calls the UI
   depends on are visible.
2. Version and document `/api/*` (see API contract).
3. Turn test fixtures into golden files: a small set of `team-data.json`
   inputs with checked-in `analysis/<scope>.json` outputs, validated against
   the schema in `npm test`. The Swift port must reproduce them.
4. Move `team-collections.json` and `match-cards.json` into the shared store.

## Milestones

| Phase | Scope | Done when |
|---|---|---|
| 0. Screenshot prototype | `scripts/utr-screenshot-ocr.mjs` and tests (done); try it on real UTR profile and roster screenshots | Real screenshots parse with the expected pairs, or parser fixes are captured as fixtures |
| 1. Hosted backend | Pre-work items 2–4, auth, Azure deployment, home-screen web app | Owner uses the hosted web app from an iPhone for a real match |
| 2. Read-only native app | SwiftUI shell, `Codable` types generated from the schema, teams, rosters, analysis views, offline cache | App shows cached team reports in airplane mode |
| 3. Native Match Day | Match Day Cards with sync and conflict handling, lineup scoring on-device or from cached snapshots | A full Match Day runs offline and syncs afterward |
| 4. Vision OCR | Result screenshots and UTR screenshots through Vision, confirmation UI, contract update for screenshot provenance | A user confirms exact UTR from screenshots and the ratings appear in reports with the right provenance |
| 5. TestFlight and App Store | Privacy policy, account deletion, review notes, terms review | Approved TestFlight build; App Store submission when the terms review is clear |

## Open decisions for the owner

1. Native SwiftUI client vs. hosted web app only for this season.
2. Swift port of `analysis.mjs` vs. JavaScriptCore vs. cached snapshots.
3. Whether to contact UTR about partner API access now.
4. Whether to generate Swift `Codable` types into `ios/` now or at Phase 2.
