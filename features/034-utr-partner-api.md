---
id: "034"
title: Fetch exact UTR through UTR's official partner API
status: blocked
priority: P1
area: server
source: requirements/ios-app-plan.md (Exact UTR on iPhone)
depends_on: []
touches:
  - scripts/lib/utr-partner.mjs
  - scripts/enrich-utr-partner.mjs
  - test/utr-partner.test.mjs
  - contracts/team-data.schema.json
  - web/server.mjs
  - .env.example
  - package.json
branch:
pr:
updated: 2026-10-29
---

## Goal

The server fills in exact singles and doubles UTR for roster players and opponents from UTR's official partner API, so the hosted server and the phone get exact ratings without anyone's UTR login or screenshots.

## Done when

- [ ] With a partner key in `.env`, gathering a team writes exact singles and doubles UTR, with reliability where UTR provides it, for players the API can identify.
- [ ] Each rating records its own source type (for example `utr_partner_api`), UTR player id, and retrieval date in the contract, distinct from public masked and authenticated profile reads.
- [ ] Without a key, gathering behaves as today (public masked UTR) and reports that partner access is not configured.
- [ ] Requests follow UTR's published rate limits through `scripts/lib/request-pacer.mjs`, and only the fields UTR's terms allow are stored or shown.
- [ ] Tests use recorded or hand-written API responses and never call UTR.
- [ ] `npm test` passes.

## Notes for the coding agent

Blocked on the owner: UTR must grant partner access first. The owner is
contacting UTR. Before this moves to `ready`, record here the base URL, auth
scheme, endpoints for player lookup and ratings, rate limits, and what the
terms allow us to store, redistribute to workspace members, and show in the app.

Decided on 2026-10-29: exact UTR comes from the official API only. No
screenshot OCR and no calls to UTR's data service with a user's own login.
The partner key is a server secret: it lives in `.env` or the host's secret
store and never ships in the iOS app or the web client.

Existing code to build on: `scripts/lib/utr.mjs` (public search and name
matching), `scripts/enrich-utr-public.mjs` (enrichment flow and source
records), and `scripts/lib/ratings.mjs` (`ratingPeople`). Matching a roster
name to a UTR player should reuse the existing matcher and stay conservative:
an unclear match leaves the public rating in place.

Whether the owner's signed-in Mac flow (`enrich-utr.mjs`) is retired once
this ships is an open question for the owner.

## Log

- 2026-10-29: Created after the owner chose UTR's official partner API over screenshot OCR. Replaces 001 and the screenshot scope of 017.
