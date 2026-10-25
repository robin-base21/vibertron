# Phase 6 voting: TV and viewer side (blueprint worker)

Branch `ws/blueprint`. Merged `main` at 29d2511 first. `packages/common` is unchanged.

## What's in

- **`lib/blueprint/live.svelte.ts`**: `LiveEvent` now handles two WS events:
  - `project.updated` upserts into `snapshot.projects`.
  - `voting.updated` replaces `snapshot.voting` and also sets `event.votingPhase`. This way the panel switches even if `event.updated` arrives later or not at all.
- **`lib/blueprint/live/voting.ts`**: pure view helpers, unit-tested in `voting.test.ts`:
  - `withVoting`, `upsertProject`, `projectCounts`;
  - `groupRows`: per-team progress, plus whether a team votes, goes straight through or has no project;
  - `pitchRanking`: the pitch tally joined with projects and teams;
  - `winnerByDraw`, `teamLabel`.
- **`lib/blueprint/live/VotingPanel.svelte`**: one component used by both the TV and `/live`. It is sized in em, and both pages mount it inside `{#key votingPhase}` so each phase change replays its reveal.
  - **`group`**: "Team voting" with the overall teams done/total, then one row per team:
    - a tick box per eligible voter, filled as ballots come in, and "✓ Done" when the team is complete;
    - teams with one project show "Straight through"; teams with none show "No project".
  - **`pitch`**: "The pitches" reveal:
    - after a 1 s lead-in, one project every 2.6 s (1.8 s on `/live`) flies in, showing the number, project name, author and team codename;
    - the item being revealed has the accent border, and its team is highlighted on the blueprint through the existing `highlightTeamId`;
    - after the reveal, the title changes to "Pitch voting" and the list stays up with a ballots-cast counter (cast/eligible plus a bar).
    - If the page opens when pitch ballots are already in (a TV reload mid-round), the reveal is skipped and the list shows straight away.
  - **`results`**:
    - about 1.6 s of "And the winner is…", then the winner card scales in: name, author, team, points and number of first places, plus "DECIDED BY DRAW" when the top two were separated by the draw;
    - the winner's team stays highlighted on the blueprint;
    - the rest of the ranking appears one row at a time, with points and a DRAW tag on rows where `tieBrokenByDraw` is set, plus a footnote explaining it.
- **TV (`routes/e/[slug]/tv`)**: while the event is live or ended and `votingPhase !== 'none'`, the right panel is the VotingPanel. The countdown, team list and message feed are hidden during voting. The header label reads "Voting · round 1", "Voting · round 2" or "Results".
- **`/live`**: shows the same panel read-only in place of the countdown box (nobody votes on this page), and highlights the same teams on the blueprint.
- **TeamList / PagedTeamList**: an optional `projects` prop shows `n/m PRJ`, meaning members who have named their project. The TV always passes it; `/live` passes it only while live and before voting.
- **Fixtures**:
  - `fixtureProjects()`: one project per member, except that team 3 has one member who hasn't named a project yet, and team 5 has a single project so it goes straight through.
  - `fixtureVoting(phase, teams, projects, progress, draw)`: builds the state with the real common rules (`groupEligibleVoters`, `pitchEligibleVoters`, `candidatesFor`, `tally`) from seeded fake ballots.
  - `fixtureSnapshot(status, now, votingPhase, draw)` fills `projects`, `voting` and `event.votingPhase`.
  - Preview URLs (dev only):
    - `?fixture=live|ended&voting=group|pitch|results[&draw][&teams=N]` on both `/e/<any>/tv` and `/e/<any>/live`. The parser is in `fixtureParams` in `liveFixture.ts`.
    - The simulation ticks every 4 s. With no voting, names arrive through `project.updated`. In `group`, ballots come in and the round closes into the pitch round, which plays the reveal. In `pitch`, ballots tick up.

## Verification

- `bun test`: 68 pass. The new `packages/frontend/src/lib/blueprint/live/voting.test.ts` passes 4/4 when run as `bun test packages/frontend/src/lib/blueprint`. The root `test` script only lists `packages/frontend/src/lib/floorplan`, so it doesn't pick this file up. That script is outside my files; please add `packages/frontend/src/lib/blueprint` to it.
- `bun run check`: 0 errors and 0 warnings. The Svelte autofixer on VotingPanel reports no issues; its suggestions are only about the reveal timers.
- `bun run typecheck`: three errors, all in `packages/backend`, and none in my files. They come from the 29d2511 contract change: `dto.ts` lacks `votingPhase`, `projects` and `voting`, and `attendee.ts` lacks `project` and `ballots`. They are already on main and are the backend worker's to fix.
- `bun run test:e2e` (on ports 4211/4210): 1 passed.
- Playwright against fixtures, TV at 1600×900 and `/live` at 390 px:
  - every check passed: PRJ counts, group panel, the reveal starting empty and showing 2 after two steps then all 5, the drum roll, the winner card with the draw note, the group round auto-closing into the pitch round, and no horizontal scroll on `/live` in any phase;
  - one check failed: the test looked for the ballots-cast counter at about 15 s, before the reveal's final hold step ends at about 16.6 s. The counter was already rendered (9/18), so the test waited too little; I didn't re-run it with a longer wait.

## Notes / requests

- **No contract change needed.**
- Robust to an older backend: with `votingPhase` missing the pages behave as before, and with `projects` missing the PRJ counts are hidden.
- The blueprint highlight reuses `TeamTag`'s `highlighted` style (accent tint on the team's stations), so it is fairly subtle at TV distance. A stronger highlight could be added later inside the renderer, which is mine.
