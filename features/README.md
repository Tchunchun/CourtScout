# Feature release priorities

Owner decision, 2026-10-29: Phase 1 proves that Court Scout helps competitive
team captains prepare lineups and is valuable enough to pay for. Team
management is Phase 2. This release order supersedes the earlier plan to
replace Breakpoint before improving lineup preparation. These product phases
are separate from the technical milestones in requirements/ios-app-plan.md.

## Phase 1 — Scouting and lineup preparation

Core flow: choose the match → research the opponent → select available players
→ compare proposed lineups → adjust and save the chosen lineup.

1. Build 022 (leakage-safe baseline for opponent lineup prediction, P0).
2. Build 028 (saved doubles pairs, P0).
3. Build 029 (availability-aware lineup proposals and scenario comparison,
   P0) after 028. Captain-entered availability removes the dependency on 032.
4. Build 035 (save predictions and compare them with actual lineups, P0) after
   022 so every later model change has a measurable baseline.
5. Reuse existing opponent reports, threat board, editable matchup comparisons,
   and lineup saving. Verify the complete flow during pilot evaluation.

Validate repeat use across matches, preparation time saved, whether captains
understand and use the comparisons, and willingness to pay. The intended paid
value is the complete preparation workflow; billing implementation and prices
are not approved by this prioritization.

Existing infrastructure, analysis quality, and offline features remain
supporting work. Their existing dependencies and statuses still apply; this
plan does not require finishing the entire infrastructure or offline backlog
before testing the core flow. Cold-start model changes (023–026) follow
evidence from 022 and 035 rather than blocking the first usable preparation
experience.

Exact UTR is an optional enhancement subject to suitable partner access and
permissions. It must not gate Phase 1 or be the sole reason to subscribe.
The UTR planning changes in PR #5, including proposed feature 034, remain a
separate pending change; this roadmap does not merge or approve them.

## Phase 2 — Team management

Defer 030–033 to Phase 2 (P2 in the current backlog):

1. 030: team members and contact details.
2. 031: player invitations, personal links, and email infrastructure.
3. 032: season availability and simple practice scheduling/signups.
4. 033: publish and email the full lineup to the entire team.

Carry the following agreed requirements into Phase 2 specification work:

- Practices usually use two courts, target eight players, and allow at most
  twelve; no waitlist or automatic threshold/court-cancellation process.
  The captain manually coordinates additional players and court decisions.
- Show player confirmations in the application separately from initial
  availability. The confirmation flow and assignment-change behavior need
  detailed acceptance criteria before implementation.
- Keep warm-up court time, location, court number, and notes with the match
  and include them in lineup communication.
- Include an optional Add to calendar action in the lineup email. Calendar
  addition is not attendance confirmation.
- WhatsApp sharing is optional. Expenses and reimbursement tracking are later
  enhancements, not requirements for Phase 1.

These requirements still need dedicated feature drafts or reviewed expansions
of 032/033. Guest entry and recurring-practice behavior need owner decisions.
No new scope becomes ready through this roadmap update.

## Scheduling rules

Priority expresses release urgency; status expresses implementation/spec
state. A ready Phase 2 feature is not a Phase 1 start candidate. The owner must
agree before any coding session starts. New ideas still require explicit
approval before moving to ready. Existing active work is not cancelled.
