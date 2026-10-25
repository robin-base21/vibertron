# Voting backend report (Phase 6, §2)

## What was built
- **Schema and migration** (`drizzle/0002_open_unicorn.sql`, generated with `bun run db:generate`):
  - `events.voting_phase`: `none|group|pitch|results`, default `none`.
  - `projects`: unique `participant_id`; `team_id` comes from the participant's team.
  - `ballots`: `round`, `voter_participant_id`, `team_id` (null for pitch), and `ranking` as JSON. Unique index on (event, round, voter).
  - `voting_results`: primary key (event, round), JSON. For `group` it stores `{ teams: Record<teamId, TallyRow[]>, pitches: projectId[] }` with pitches in team order. For `pitch` it stores `TallyRow[]`.
  - All new tables cascade on event, participant and team deletion.
- **`src/routes/voting.ts`**:
  - `PUT /api/e/:slug/project`:
    - the user must be a participant on a team (403 otherwise);
    - the event must be live or ended, and the phase `none` (409 otherwise);
    - the name must be unique in the event, ignoring case (409);
    - it upserts the participant's one project (same id on edit), turns an empty tagline into null, and broadcasts `project.updated`.
  - `PUT /api/e/:slug/ballot`:
    - `round` must equal the current phase (409 otherwise, including after a round closes);
    - the voter must be eligible (403 otherwise). Group: `groupEligibleVoters(team members, team projects)`. Pitch: `pitchEligibleVoters` over every participant on a team.
    - The ranking is checked with `validateRanking` against `candidatesFor` (422 `invalid_ranking`, with `details.candidates`).
    - It upserts the voter's ballot. The phase is re-checked inside the write transaction so a ballot can't land after a concurrent close.
    - It broadcasts `voting.updated`. After a group ballot, the round closes automatically once every voting team is done.
  - `POST /api/events/:id/voting` (event manager):
    - `start`: needs the event live or ended, the phase `none`, and at least one project. It does a compare-and-set from none to group, then runs the auto-close check right away: when no team has 2 or more projects, it goes straight to `pitch`.
    - `close-group` / `close-pitch`: compare-and-set from group to pitch / pitch to results inside a transaction that tallies and freezes the result. They return 409 when that round isn't open, so a manager click that races the automatic close can't apply twice.
    - `reset`: deletes ballots and results and sets the phase to `none`. Projects are kept and become editable again.
  - Every phase change broadcasts `voting.updated`, plus `event.updated` and `event.manage.updated`.
- **Tallies**:
  - Group round, per team: `tally(team project ids, team ballots, hashSeed(event.seed, teamId))`. The winner (rank 1) pitches. A team with exactly one project sends it with no ballots; a team with none sends nothing.
  - Pitch round: `tally(pitch ids, pitch ballots, hashSeed(event.seed, 'pitch'))`.
- **`dto.ts`**:
  - `publicEventDTO.votingPhase`.
  - `projectDTOs` (team order, then author), `projectDTO`, `projectForParticipant`.
  - `votingState(db, event)`:
    - `perTeam` covers every team; `eligible: 0` means the team doesn't vote.
    - `teamsDone` / `teamsTotal` count voting teams only.
    - `pitches` is filled in the `pitch` and `results` phases; `pitch.cast` / `pitch.eligible` are filled too.
    - `results` is present **only** in the `results` phase.
  - `ballotsFor`.
  - `liveSnapshot` now carries `projects` and `voting`.
  - The attendee `GET /api/e/:slug/me` now carries `project` and `ballots`.
- **`test/voting.test.ts`**, using real HTTP and WS:
  - **Full flow**: 8 attendees, teams of 3/3/2 named with 3, 2 and 1 projects.
    - Projects: rejected before launch; name clash (case-insensitive); edits keep the id.
    - `start` (403 for a non-manager; 409 for wrong phase or repeat).
    - Rejections: own project, incomplete, duplicate, other team (all 422); wrong round (409); a team with one project (403); a manager who isn't a participant (403).
    - A changed ballot replaces the old one. No results appear while voting.
    - The group round auto-closes with a pitch list of one project per team in team order. A late group ballot gets 409.
    - The pitch round excludes the voter's own project (422).
    - `close-pitch` produces results with the expected Borda points.
    - Reset clears ballots and results.
    - WS: `project.updated`, `voting.updated`, `event.updated` with `votingPhase`.
  - **No voting team**: start goes straight to `pitch`; a member without a project still ranks the pitches; the results have the expected points.

## Verification
- `bun test`: 66 pass. `bun run typecheck` is clean. `bun run test:e2e` passes.
- `bun run check`: **1 error, in a file I don't own**. `packages/frontend/src/lib/blueprint/fixtures.ts:111` builds a `PublicEventDTO` without the new required `votingPhase`. It comes from the contract commit 29d2511 and **already fails on `main`**. The fix is to add `votingPhase: 'none'` to that fixture (app/blueprint worker or coordinator).

## Decisions
- "Only attendees vote" is read as "participants on a team". A manager or admin who joined as a participant can vote and name a project like anyone else. A manager who isn't a participant gets 403.
- Removing a participant after the event has ended deletes their project and ballots (cascade). That can lower `eligible` counts during voting, but it doesn't trigger an auto-close by itself; the next ballot or a manager action does.
- Pitch ballots can't be changed after `close-pitch`, and group ballots can't be changed after the group round closes (409).
- `reset` works in any phase and is idempotent.

## Contract requests
None.
