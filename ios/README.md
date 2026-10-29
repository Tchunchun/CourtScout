# Court Scout iOS

The native iPhone app from Phase 2 of `requirements/ios-app-plan.md`: a
read-only app for team reports that works offline. It reads from the existing
Court Scout server (`npm start`), so the server has to be running.

| Folder | What it is | Builds without Xcode |
|---|---|---|
| `CourtScoutModels` | `Codable` types generated from `contracts/team-data.schema.json` | Yes |
| `CourtScoutKit` | All app code: API client, offline cache, SwiftUI screens. Builds for iOS and macOS. | Yes (macOS) |
| `CourtScout.swiftpm` | The iPhone app itself, a thin wrapper around `CourtScoutKit` | No — open in Xcode |

## Run on iPhone or the iOS Simulator (needs Xcode)

1. Start the server: `npm start`.
2. In Xcode, choose File > Open… and pick `ios/CourtScout.swiftpm`.
3. Pick an iPhone simulator and press Run.

From the command line instead:

```bash
cd ios/CourtScout.swiftpm
xcodebuild -scheme CourtScout -destination 'generic/platform=iOS Simulator' -derivedDataPath ../.build/DerivedData build
xcrun simctl install booted "../.build/DerivedData/Build/Products/Debug-iphonesimulator/Court Scout.app"
xcrun simctl launch booted com.courtscout.app
```

Xcode only offers generic destinations for this package, so build for "Any
iOS Simulator" and install on a booted device as above. If the build fails
with "No available simulator runtimes", the installed Simulator runtime does
not match Xcode's iOS SDK: list both with `xcrun simctl runtime match list`
and point the SDK at the installed runtime, e.g.
`xcrun simctl runtime match set iphoneos26.2 23D8133`.

The Simulator reaches the server at `http://localhost:4173`, the default. On a
real iPhone, open Settings (gear icon) in the app and enter
`http://<this Mac's IP>:4173`; both devices must be on the same network. To
install on your own iPhone, choose your Apple ID team under Signing &
Capabilities first.

## Preview on a Mac (no Xcode needed)

```bash
ios/CourtScoutKit/scripts/run-mac-preview.sh
```

This opens the same SwiftUI screens in an iPhone-sized Mac window. iOS-only
details (navigation bar style, keyboard type) differ slightly.

## What the app does

The app follows a captain's season, not a list of every gathered team.

- **Seasons (home):** one card per event collection, newest first, with its
  level, Our team, and next match. The search button finds any gathered team
  across seasons.
- **New season:** the `+` button (or the empty home screen) takes Our team's
  TennisRecord team link, previews the team and how many league opponents
  will be gathered, and starts gathering on the server with public UTR.
  - Exact UTR decimals need the server's signed-in browser, so the phone
    does not offer them; add them later from the web app.
  - A team that is already in a season gathers into that season again
    instead of creating another.
  - The season appears at once with a progress bar. The job runs on the
    server, so the app can close; progress resumes when it reopens.
  - A running gather lives in the server's memory; the server saves each
    job's progress to `data/jobs/`. If the server restarts mid-way, the season
    says so and offers "Start again", which gathers into the same season.
  - Starting a season again, or Update for a team already in one, reuses the
    teams the season has and gathers only the missing opponents. A season
    whose schedule names opponents it does not have offers "Gather missing
    opponents". Refreshing a gathered team is Refresh data in the web app.
- **Season:** Our team, the next match, upcoming matches, past matches whose
  result has not been gathered yet, completed matches, and the scouting pool
  (other gathered teams that are not on the schedule).
  - Our team comes from the confirmed schedule, then the team roles shared
    with the web app (`/api/team-roles`), then the web app's Match Day
    default. Choosing Our team on the phone saves it to the server. Offline,
    the choice is kept on the phone and shared on the next load that reaches
    the server; if another device saved first, the newer choice is shown.
  - The schedule is the season's confirmed schedule. Without one, the app
    falls back to Our team's TennisRecord schedule and says it is unconfirmed.
- **Prepare lineup:** tap an upcoming match (or, with no schedule, any team
  in the event) to test Our lineup against the opponent's three scenarios:
  most likely, strongest by ratings (unconfirmed), and alternate.
  - Picking the ratings or alternate scenario says what it changes from the
    first one: which courts have different opponents, who comes in or drops
    out, how Our edge moves on each changed court, and the score change.
    Changed courts are tagged on their cards.
  - Each court shows Our players, theirs, DR and UTR averages, our margin,
    and an edge: favorable, swing, challenging, or limited data.
  - Tap a player to change them; eligible players are listed first, and a
    player already on another court swaps places. The server re-checks the
    lineup (complete, no repeats, eligibility, mixed pairs and NTRP) after
    every change.
  - The lineup starts from Our team's own most likely lineup and is saved on
    the device per opponent. The score per scenario and the worst case show
    how well the lineup holds up if the opponent does something else.
  - The comparison comes from `POST /api/matchup`, which reuses
    `web/public/match-card.mjs`, so the phone and the web Match Day Card agree.
- **Team report:** Overview (record, eligibility counts, data notes, sources),
  Threats (the threat board: likely lineups with each line's weak spots, such
  as no postseason history or a missing rating; whether the team stacks its
  courts; available players strongest first with their usual role and
  courts, regular partner, and whether their UTR is exact or a public band
  and how old it is; regular pairs; and data-coverage warnings),
  Roster (DR, UTR, NTRP, eligibility, role), Lineups (up to three likely
  lineups with court history), and Matches (results with court-by-court
  scores). Eligibility defaults to the team's own level and can be switched.
- **Offline:** every screen opened is saved on the device. When the server is
  unreachable the app shows the saved copy with an "Offline" banner. Server
  errors, such as a removed team, are shown instead of stale data.

## Checks

Run these from the repository root.

```bash
swift run --package-path ios/CourtScoutModels verify-models
```

Decodes every checked-in `data/collections/**/team-data.json` and checks that
encoding it again gives identical JSON.

```bash
swift run --package-path ios/CourtScoutKit verify-kit
```

With the server running, decodes every team's catalog entry, dataset, and
analysis through the app's API client, and checks the offline fallback,
matchups, team roles, threat boards, and the New season preview (it starts no jobs and
saves nothing).

With Xcode installed and selected (`xcode-select -p` points into `Xcode.app`),
the Swift Testing suite for the models also runs:

```bash
swift test --package-path ios/CourtScoutModels
```

## Regenerating the models

`TeamData.generated.swift` is generated. After changing the schema, run:

```bash
npm run generate:swift
```

`npm test` fails when the checked-in Swift file is out of date.

### Mapping rules

- Schema objects become structs. Objects nested inside a property become
  nested types, such as `RosterPlayer.UTR` and `Match.TeamResult`.
- Values that are nullable or not required become optionals. Encoding keeps
  `null` versus absent: required nullable keys always encode `null`, and
  optional nullable keys encode `null` only if they were `null` when decoded.
- String enums become open `RawRepresentable` structs. Values the app does not
  know yet still decode, and `knownValues` lists the values from the schema.
- Objects that allow extra keys keep them in `additionalProperties`, so the
  app can save a dataset again without losing fields the schema does not
  declare.
- Objects without declared properties, such as `dataQuality`, are `JSONValue`.
- Dates and date-times stay as `String`, the same as in the JSON. Parse them
  where they are displayed.

## App icon

The source is `ios/branding/app-icon.svg`. After changing it, export the
1024 px PNG without an alpha channel (App Store Connect rejects icons with
transparency) and copy it into the asset catalog:

```bash
qlmanage -t -s 1024 -o /tmp ios/branding/app-icon.svg
sips -s format jpeg -s formatOptions 100 /tmp/app-icon.svg.png --out /tmp/app-icon.jpg
sips -s format png /tmp/app-icon.jpg --out ios/CourtScout.swiftpm/App/Assets.xcassets/AppIcon.appiconset/AppIcon.png
cp ios/CourtScout.swiftpm/App/Assets.xcassets/AppIcon.appiconset/AppIcon.png ios/branding/app-icon-1024.png
```

## Not done yet

- Hosting and sign-in (Phase 1). The app has no authentication and expects a
  trusted local server.
- Saving a phone lineup as a web Match Day Card, and on-site evidence in the
  phone matchup.
- Match Day Cards, availability, and editing (Phase 3).
- Tested on the iOS 26.3 Simulator (iPhone 17 Pro); not yet on a physical
  iPhone.
- A real iPhone reaches the Mac over plain HTTP. iOS App Transport Security
  may block that; if it does, the fix is the HTTPS hosting in Phase 1 rather
  than an exception in the app.
