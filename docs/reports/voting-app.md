# Phase 6 voting: app worker report

Branch `ws/app`. It has `main` merged in, including the backend voting merge.

## What was built

### API wrappers (`lib/api/index.ts`)
- `attendee.saveProject(slug, ProjectBody)`: `PUT /api/e/:slug/project`.
- `attendee.saveBallot(slug, BallotBody)`: `PUT /api/e/:slug/ballot`.
- `voting.action(eventId, VotingActionBody)`: `POST /api/events/:id/voting`.
- Bodies are parsed with the common zod schemas, as for every other wrapper.

### `lib/components/RankList.svelte`
A sortable list with no new dependencies, using `bind:order` (ids, best first) and a `row(id, index)` snippet.
- **Drag:** pointer events on a grip handle, which covers mouse, touch and pen.
  - The handle has `touch-action: none` and pointer capture, so dragging doesn't scroll the page.
  - The dragged card follows the pointer, with an accent border.
  - The other cards slide out of the way with a 150 ms transform transition.
  - Row numbers show each row's slot while you drag.
  - The page auto-scrolls when the pointer is near the top or bottom edge.
  - Transitions are switched off for the frame that commits the reorder, so rows don't jump.
- **▲/▼ buttons** on every row (disabled at the ends), with aria labels "Move X up/down".
- **Arrow keys** on the focused handle move the row, and focus follows it.
- Large `font-mono` numbers (`01`, `02` …), white-on-black cards.

### Attendee
- **Store (`stores/attendee.svelte.ts`):**
  - New state: `projects`, `teams` and `voting`, filled from the snapshot.
  - Handles `project.updated` and `voting.updated`. `voting.updated` also patches `event.votingPhase` and clears local ballots on a reset.
  - Getters: `phase`, `project`, `teamProjects`, `candidates(round)` (uses `candidatesFor` from common, so never your own project), `projectById`, `teamName`, `teamProgress`, `myResult`.
  - Actions: `saveProject` and `saveBallot`.
- **`attendee/ProjectCard.svelte`** ("Your project", below the codename):
  - Asks you to name a project while it has no name.
  - Shows name + tagline, editable while the phase is `none`. After that it shows "Locked for voting".
  - Backend errors (such as a duplicate name) show inline.
- **`attendee/VotingCard.svelte`** (at the top of LiveView once voting starts):
  - **group / pitch:** a RankList of your candidates.
    - It starts from your saved ballot, or else a stable per-voter seeded shuffle (`hashSeed(participantId, round)`), so the order doesn't reshuffle on every `voting.updated`.
    - "Submit ranking", then "Saved, you can change it until the round closes." Reordering after saving shows "Unsaved changes" and "Update ranking".
    - A cast/eligible counter: for your team in the group round, for everyone in the pitch round.
    - With nothing to rank it says "Your project goes straight through" or "No vote needed".
  - **results:** the winner card (name, author, team codename, plus "Tie decided by draw" when it applies) and "Your project placed #n of m in the final / in your team round (x pts)".

### Manager (`components/manage/VotingPanel.svelte`, on `/manage/[id]` while live or ended)
- **none:** projects per team, including members without one, "N of M members have named a project", and **Start team voting**, which is disabled with no projects.
- **group:**
  - cast/eligible per team with a tick when done;
  - "goes straight through" or "no projects" for teams that don't vote;
  - teamsDone/teamsTotal and **Close team round**.
- **pitch:** the pitch list, ballots cast/eligible, and **Close and reveal winner**.
- **results:** the final ranking (rank, points, first places, draw flag), with each team round in a collapsible section.
- **Reset**, available in every phase except `none`. Every action asks for confirmation.
- The page keeps `projects` and `voting` from the `subscribed` snapshot, `project.updated` and `voting.updated`.

### e2e (`packages/e2e/tests/voting.e2e.ts`)
1. An admin creates an event, an invite and a blueprint with 4 confirmed stations.
2. 4 Pixel 7 phones join, and the manager launches with teams of 2.
3. Everyone names a project through the UI. The manager sees "4 of 4", and the TV is opened.
4. **Start team voting:** the phones show "Team vote" and "Locked for voting".
5. **Team round:** each phone has exactly one candidate (its teammate's project, never its own) and submits. The 4th ballot **closes the round automatically**: the manager sees "Pitch round" and the phones see "Pitch vote".
6. There are 2 pitches, one per team, and they appear on the **TV** and the manager page.
7. **Pitch round:**
   - each pitcher sees only the other pitch;
   - one non-pitcher puts the winner first with **CDP touch drag** (it first drags the runner-up to the top, so at least one real drag always happens);
   - the other non-pitcher uses **▲/▼**, submits, **changes the ballot** ("Unsaved changes") and resubmits;
   - the manager sees 4/4.
8. **Close and reveal winner:** the manager's final ranking puts the winner at 01 with 6 pts. Every phone shows "Results", the winner and its own placing, and the TV shows the winner.

`smoke.e2e.ts`: one locator changed to `{ name: 'Save', exact: true }`, because the new "Save project" button made `name: 'Save'` ambiguous.

## Verification
- `bun test` (66 pass) and `bun run typecheck` are clean, and so is `tsc -p packages/e2e`.
- `bun run check` has **1 error, in `lib/blueprint/fixtures.ts`** (missing `votingPhase`). That file belongs to the blueprint worker and I left it alone. In a trial merge with `ws/blueprint`, `check` is 0/0.
- **e2e:**
  - In a throwaway worktree in my scratchpad (`ws/app` + `ws/backend` + `ws/blueprint`), on ports 4100/4101: `playwright test` gives **2/2 passed** (smoke 30 s, voting 34 s).
  - On `ws/app` alone (main without the blueprint worker's TV voting), the voting test gets through every phone and manager step and fails only at the first TV assertion (pitch names on the TV), as expected. It goes green once `ws/blueprint` is merged.
- Every new or changed component went through `svelte-autofixer`. The only remaining suggestions are the known false positives (assignments inside WS callbacks, `bind:this`).
- I checked screenshots of the manager panel in all four phases, the attendee pitch RankList, the saved state and the results.

## Notes / decisions
- Running scores are never shown before `results`, because the contract doesn't expose them.
- Ballots aren't saved automatically on reorder: you submit explicitly, and the "Saved" text confirms the server accepted it.
- When a ballot is rejected (for example the round closed meanwhile), the error shows inline and the attendee context is reloaded.

## Contract change requests
None. `packages/common` is unchanged.
