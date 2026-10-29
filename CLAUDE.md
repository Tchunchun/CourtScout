# Court Scout

Scouting tool for USTA team tennis: a Node server (`web/server.mjs`) that
gathers TennisRecord, UTR and WTN data, a web app (`web/public/`), and a
SwiftUI iPhone app (`ios/`). Product plans live in `requirements/`; the data
contract is `contracts/team-data.schema.json`.

## Commands

- `npm install` once per checkout or worktree.
- `npm test` runs every test in `test/`.
- `npm start` serves the web app at http://localhost:4173.
- `npm run features` prints the feature board.
- iOS checks are in `ios/README.md`.

## How work is split across sessions

Features are tracked as one file per feature in `features/`, named
`NNN-short-name.md`, using `features/_template.md`. The front matter holds the
status; the body holds the goal, what "done" means, and notes for whoever
builds it.

Statuses: `idea` (needs a spec) → `ready` (spec complete, dependencies done) →
`in-progress` (a session is building it on `branch`) → `review` (PR open, `pr`
set) → `done` (merged into `main`). `blocked` means waiting on a dependency or
an owner decision named in the file.

### Planning session

One session plans with the owner and starts coding sessions.

- Writes and updates feature files: new ideas, specs, priorities, splitting
  large features. Moves `idea` to `ready` only when every "Done when" item can
  be checked and `depends_on` are all `done`.
- Before starting a coding session, runs `npm run features`, and starts only
  features whose `touches` do not overlap anything `in-progress` or `review`.
  The board warns about overlaps.
- Starts each coding session in its own worktree, with a brief that names the
  feature file. Sets `status: in-progress` and `branch` on `main` first, so
  the next session it starts sees the claim.
- Moves a feature to `done` after its PR merges, then unblocks dependants.
- Runs at most three coding sessions at once.

### Coding session

One session builds one feature, in its own worktree and branch.

- Reads its feature file and the `source` document before starting.
- Edits only its own feature file under `features/`, never another one. Ticks
  "Done when" items as they pass, adds dated lines to Log, and records
  decisions or surprises there.
- Stays inside the files listed in `touches`. If the work needs files outside
  that list, adds them to `touches` and says so in the Log and the PR.
- Asks the owner, rather than guessing, when the spec is unclear or a decision
  is needed.
- Finishes with `npm test` passing, `status: review`, `pr` set, and a PR to
  `main` whose description links the feature file.
- Does not merge its own PR and does not mark its feature `done`.

## Files many features touch

These are the usual source of merge conflicts. Keep changes to them small and
mention them in `touches`:

- `web/server.mjs` and `web/public/app.js` (both several thousand lines)
- `ios/CourtScoutKit/Sources/CourtScoutUI/AppModel.swift`
- `package.json` and `package-lock.json`
- `requirements/ios-app-plan.md`

Gathered data (`data/`, `nationalreport/`) changes when the server runs. Do
not commit data changes from a feature branch unless the feature is about
that data.

## Worktree notes

- Most of `data/` is git-ignored, so a new worktree has only the checked-in
  collections and none of the local datasets, jobs or match cards. Tests must
  not depend on ignored data.
- `.env` is not copied into worktrees. Features that need UTR sign-in or other
  secrets say so in their notes.
- Only one server can listen on port 4173; start a second one with another
  `PORT` if two sessions need a running server.
