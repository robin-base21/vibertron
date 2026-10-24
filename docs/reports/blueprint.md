# Blueprint worker report

Branch `ws/blueprint`. All five milestones are done. main was merged in four times, most recently just before this report.

## What was built

### 1. Renderer: `src/lib/blueprint/Blueprint.svelte`
- A read-only SVG renderer whose viewBox is the canvas. Props: `blueprint`, `teams`, `highlightStationId`, `highlightSegmentId`, `highlightTeamId`, `selectedSegmentId`, `hideLabelFor`, `showUnderlay`, `showTitleBlock`, `invert`, `class`, a bindable `svg` and an `overlay` snippet (the editor's layer).
- Drawing primitives are shared by the read-only views, the editor, the import preview and SVG export:
  - `SegmentShape.svelte`: the structural outline, stations, label, `?` badge and highlight for one segment.
  - `TitleBlock.svelte`: the title block.
  - `TeamTag.svelte`: per-team boxes and the codename tag.
  - `geometry.ts` and `types.ts`: pure helpers and stroke constants.
- Implements the visual spec:
  - Grid every 10 units, with a heavier line every 100. The 10-unit grid is hidden when it would be denser than 4 px.
  - Outlines are 0.75 px at 60%. Segments are 1.75 px with miter joins and square caps.
  - Labels are uppercase Barlow Condensed with letter-spacing .08em and a background halo. Each label has a mono station count, marked `· UNCONFIRMED` when the count isn't confirmed.
  - Stations come from `stationPositions()`. Mono station numbers appear once stations are more than 34 px apart on screen.
  - Low confidence (below `LOW_CONFIDENCE`) gives a dashed outline and a `?` badge.
  - Title block shows project, date, rev, total stations and team count.
  - feTurbulence texture at 4%.
  - The accent highlight is drawn under the white lines. The highlighted station gets a pulsing ring (SMIL, so it survives export).
- Stroke widths are computed in screen pixels: the component measures its rendered size and gets heavier on screens wider than about 1500 px. Lines stay crisp from a phone up to 4K.
- With `teams`, each team's stations are filled. They get a dashed box per station row and a white tag with the codename (or the team name if there's no codename). The tag is sized so it never collides with a neighbouring team. The segment name moves to its top-left corner.
- Dev fixtures are in `fixtures.ts`.

### 2. Editor: `/manage/[id]/blueprint`
- `+page.ts` loads the event and its blueprint through `$lib/api`. With no saved blueprint it starts from `emptyBlueprint(event.name)`. In dev, `?fixture` loads a fixture blueprint (you still need to be logged in, because of the `manage/+layout.ts` guard).
- State lives in `editor/editor.svelte.ts`: the document, selection, tool and undo/redo history (up to 200 snapshots). Rapid edits are coalesced into one undo step: typing, +/- clicks, markup edits, nudges and slider moves.
- Canvas (`editor/EditorCanvas.svelte`) is an overlay on the same renderer.
  - Tools:
    - Select (V).
    - Rect (R): drag to draw, with a live W×H readout.
    - Polygon (P): click to add points. Double-click, or click the first point, to close. Esc cancels.
  - Moving and resizing:
    - Move a segment by dragging it.
    - 8 resize handles on rects. The label keeps its relative position.
    - Drag polygon vertices. Double-click an edge to insert a vertex. Alt+click a vertex to remove it (at least 3 stay).
    - Drag labels.
  - Editing:
    - Double-click a segment or label, or press Enter, to rename inline (foreignObject input).
    - Arrow keys nudge by 10, Shift+arrow by 50.
    - Delete/Backspace removes the selected segment.
    - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo. Ctrl+S saves.
  - Everything snaps to the 10-unit grid (toggle in the toolbar, hold Alt to bypass).
  - Drags can start in the letterbox margin.
- Side panel tabs:
  - **Segment**: name, station count +/- and number input, grid/row layout, confirmed toggle, AI confidence readout, delete.
  - **Markup**: two-way sync with `serializeMarkup`/`parseMarkup`. A valid parse is applied. On a parse error the line number is highlighted and the error listed, and the text is never overwritten. Canvas edits regenerate the text.
  - **Sheet**: title block fields (project, date, rev).
- Toolbar: underlay show/hide toggle, underlay opacity slider (undoable), Invert for print, Export SVG (renders a clean offscreen copy and strips the editor layer), Import floorplan.
- A banner lists unconfirmed segments ("Launch is blocked until counts are confirmed"). Clicking a name selects that segment, and there is a **Confirm all** button.
- Save uses PUT with the optimistic `version`.
  - A 409 that has `details.version` opens a "changed elsewhere" dialog with "Reload latest" or "Keep editing".
  - Any other 409 (for example the blueprint is locked while the event is live) is shown as an error toast.
  - The page warns about unsaved changes on reload and on in-app navigation.

### 3. Floorplan import (`src/lib/floorplan/`)
- `contours.worker.ts` is a Web Worker and the only place opencv.js (`@techstark/opencv-js`, about 13 MB) is loaded. The pipeline:
  1. Downscale to at most 1600 px.
  2. Grayscale, then Gaussian blur.
  3. Adaptive threshold, then morphological close.
  4. `findContours(RETR_TREE)`, then `approxPolyDP`.
  5. Filtering in `geometry.ts`.
- `geometry.ts` is pure and unit-tested. It:
  - drops tiny, huge, sliver and frame-border contours;
  - removes duplicate room candidates (RETR_TREE traces both sides of a thick wall);
  - normalizes to a long side of 1000 while keeping the aspect ratio, and sets the canvas height to match;
  - returns at most 80 candidates (largest first) and at most 400 outlines (longest first).
- `contours.ts` runs the worker with progress reporting and a 20 s timeout. It never rejects: on failure or timeout it returns empty candidates and the import continues.
- `draft.ts` (pure, tested):
  - `fitDraft` puts the server draft onto the aspect-correct canvas.
  - `localDraft` is the client-side fallback used if the analyze request itself fails.
- `ImportDialog.svelte`:
  1. Pick or drop an image.
  2. Upload and contour detection run in parallel, each with step progress.
  3. `POST /blueprint/analyze`.
  4. Preview the draft, with a warning when `source: 'fallback'`.
  5. **Accept draft** replaces the segments, outlines, underlay and canvas but keeps the title block. It is a single undoable step.

### 4. TV: `/e/[slug]/tv`
- The layout already renders this route without chrome (`bareRoutes` in `+layout.svelte`), so no layout reset was needed.
- Data: `LiveEvent` (`src/lib/blueprint/live.svelte.ts`) loads `GET /api/e/:slug/live`, then calls `wsStore.subscribe(slug)`. It handles `subscribed`, `launched`, `event.updated`, `blueprint.updated`, `team.updated`, `message.created`, `message.hidden` and `participants.count`. Un-hiding a message we never received triggers a snapshot refetch.
- Layout: full-screen grid, 70/30, with sizes in vw so it scales to the TV.
  - Left: the blueprint with teams.
  - Right column (live): the event name, then a giant mono `HH:MM:SS` countdown from `clock.now` (so `wsStore.now()`, corrected for server time). In the last 10 minutes the digits turn accent and pulse gently; no red is used.
  - Team list: codename, team name, segment and member count. It switches to two columns above 5 teams. When a codename changes, that team flashes on the list and on the blueprint for 5 s.
  - Message feed: newest on top, flies in, last 12 shown.
- Pre-launch state: the event name, "JOIN AT THE VENUE", the live participant count and the blueprint.
- Ended state: shown when the status is `ended` or the countdown reaches zero. "TIME'S UP" plus the final codenames.
- Dev `?fixture=open|live|ended` previews each state; the `live` fixture posts a fake message every 4 s.

### 5. Public viewer: `/e/[slug]/live`
- Same data and the same live store as the TV, as a single responsive column: status, countdown or state card, blueprint, then teams and messages (two columns from `md` up).
- Shows "Event not found" for an unknown slug.

## How it was verified
- `bun test`: 44 pass. `bun test packages/frontend/src/lib/floorplan`: 9 pass (geometry plus draft). `bun run typecheck` and `bun run check` pass with 0 errors and 0 warnings. `vite build` succeeds, and the worker is emitted as its own chunk.
- The Svelte autofixer was run on every component. The only remaining suggestions are about effects that are intentional: the markup text sync, and the live subscription setup, which is untracked.
- Playwright scripts (chromium, run from my scratch directory, not committed) against a real backend on :4201 with the frontend on :4200:
  - **Editor**:
    - Draw a rect and a polygon, then move, resize and rename.
    - Stations +2, then undo and redo.
    - Save; the stored JSON has the exact expected coordinates.
    - Markup: appending a line adds a segment. A bad token shows `L4 unknown segment option` and the text is kept.
    - Bumping the version server-side makes the next save open the conflict dialog, and Reload restores the server copy.
    - Export SVG downloads a file with no editor layer and a white background when inverted.
  - **Import**: a synthetic 2400×1500 PNG floorplan produced a draft in about 2–3 s: 3 candidates, 20 outlines, canvas 1000×625. Without an OpenRouter key the fallback warning shows. Accept and undo work, and the saved blueprint has the underlay and the 1000×625 canvas.
  - **Live**: open the event and invite, then 6 attendees join with rotating codes. On the TV:
    - The participant count goes 0 → 6.
    - After launch: 2 team tags and the countdown at `00:04:59` in its accent final-10-minute state.
    - A codename appears and flashes.
    - A message appears on both the TV and the public page.
    - Hide removes it from both; un-hide brings it back.
    - End shows "TIME'S UP" on both.
- Screenshots were checked at 1920×1080 (TV in all three states), 1400 wide (editor, import) and 390 wide (public page on a phone).

## Follow-ups (coordinator round 2)
1. **Analyze canvas.**
   - The client sends `canvas` with the analyze request.
   - `backend/src/ai/analyze.ts` builds the draft (including the fallback draft) on that canvas.
   - The prompt and AI rects use a normalized 0..1000 square. Candidates are converted into it for the prompt, and rects are scaled back onto the canvas and clamped.
   - The analyze route passes `body.canvas` through.
   - New tests:
     - `test/ai.test.ts`: on a non-square canvas, the prompt uses square coordinates, polygons stay in canvas coordinates, and rects are scaled and clamped.
     - `test/blueprints.test.ts`: the canvas is passed through the route, and an invalid canvas returns 400.
   - `fitDraft` no longer rescales rects. It only clamps to the canvas and keeps the editor's title block.
2. **TV team list pagination.** `PagedTeamList.svelte` measures how many rows fit, rotates pages every 8 s with a fade and shows a `1/5` indicator. It jumps to a team's page when that team's codename changes, and is used on both the live and the ended screens. Dev preview: `?fixture=live&teams=40`.
3. **Favicon.** `static/favicon.svg` is linked from `app.html`, so routes without chrome no longer request `/favicon.ico` before the client renders.
4. **Label band.**
   - `stationPositions` takes a `top` inset (common change below). The renderer reserves a band at the top of each segment, sized from the label font (at most 45% of the segment height), and draws the name and count there, so the label never covers a station.
   - `labelPos.x` still sets the horizontal position (clamped to the segment), so dragging a label in the editor now slides it along the band. `labelPos.y` is kept in the data but no longer used for drawing.
   - Station positions use the same band in every view, so attendee highlights, team boxes and the TV agree.
5. **Highlight weight.**
   - An attendee's highlighted segment now gets a 10% accent tint.
   - The highlighted station gets a solid accent disc plus a pulsing accent ring, both under the white strokes.
   - The editor's selection keeps the 40% accent from the spec.
   - The TV codename flash on the blueprint is 12%.
6. **Confirmed means confident.** Segments with `stations.confirmed = true` never render dashed or with the `?` badge, even when `confidence` is set.
7. **Editor lock.** When the event is `live` or `ended`, the editor shows "Blueprint locked while the event is live/over" in place of the unconfirmed banner. It then:
   - renders the plain read-only renderer instead of the editing canvas;
   - disables tools, undo/redo, snap, the underlay slider, import and save;
   - disables every control in the side panel through a disabled `<fieldset>`;
   - ignores keyboard shortcuts.

   Invert and SVG export still work. In dev, `?fixture&status=live` previews it.

Verified after these changes:
- `bun test`: 47 pass. Floorplan tests: 9 pass. `typecheck` and `check` are clean.
- `bun run test:e2e` passes, run on ports 4210/4211 to stay off other workers' ports.
- My editor, import and live scripts were re-run and pass. The import draft now comes back from the backend on a 1000×625 canvas.
- New visual checks:
  - With 40 fixture teams, the TV team list rotates from page 1/5 to 2/5 after 8 s.
  - The locked editor shows the notice, with Save and the tools disabled and SVG export enabled.
  - A real attendee page shows the faint segment tint and the strong station ring.
  - On the TV, a confirmed segment with confidence 0.3 has no `?` badge, and the label band clears the first row of stations.

## Decisions and known gaps
- Confirming a segment (the toggle or Confirm all) clears its AI `confidence`, so the dashed outline and `?` badge go away once the manager has validated it.
- New hand-drawn segments start as `Area N` with 4 stations, unconfirmed.
- The first time opencv is imported in `vite dev`, Vite re-optimizes dependencies and reloads the page once. Adding `optimizeDeps: { include: ['@techstark/opencv-js'] }` to `vite.config.ts`, which I don't own, would avoid it. Production is unaffected.
- The worker imports opencv statically and is only spawned on demand, so it stays out of the main bundle. Vite's default iife worker format can't code-split a dynamic import inside a worker.
- The 20 s contour timeout includes downloading opencv on a cold cache. On a very slow connection the contour pass may time out the first time, and the import still continues with AI-only or manual drawing.
- The contour heuristic traces text and furniture as outlines too (they're decorative). Room candidates on real photos will need tuning; the manager remains the accuracy layer.
- Floorplan unit tests aren't in the root `bun test` script, which only covers common and backend and which I don't own. Run them with `bun test packages/frontend/src/lib/floorplan`, or the coordinator can add the path.
- `src/lib/blueprint/api.ts` only holds `saveBlueprint` (409 handling) and `underlayUrl`. Everything else uses the typed wrappers in `$lib/api`.
- The app worker's `BlueprintView.svelte` loads `$lib/blueprint/Blueprint.svelte` through its glob, so attendee pages now get the real renderer.

## Dependencies (packages/frontend/package.json)
- `dependencies`: added `@techstark/opencv-js` ^5.0.0-release.1.
- `devDependencies`: added `@types/bun`, so the floorplan `*.test.ts` files type-check under svelte-check. They also carry `/// <reference types="bun" />`.

## COMMON CHANGES
Both additive, both made in the follow-ups at the coordinator's request.
- `api.ts`: optional `AnalyzeBody.canvas: { w, h }` (each positive, at most 10 000). It defaults to 1000×1000 on the backend, so older clients are unaffected.
- `blueprint.ts`: `stationPositions(segment, pad = 12, top = 0)`. The new `top` reserves a band at the top of the segment; the default keeps the old behaviour. New test file: `blueprint.test.ts`.

## Round 3: floorplan import v2 + editable walls (in progress)

**Done (committed on `ws/blueprint`)**
- `src/lib/floorplan/pipeline.ts` is pure: `runPipeline(cv, raster)` returns `{canvas, crop, envelope, walls, rooms}`.
  - Ink mask: median background, contrast plus low saturation, with an Otsu fallback.
  - Wall mask: long-line open/close.
  - Envelope crop.
  - Run-length wall vectorization. Double-line walls are paired; in double-line plans the single lines (furniture) are dropped. Stair treads are removed. Lines are merged, snapped at junctions and split at T/X junctions.
  - Rooms: connected components between the vector walls plus door bridges (up to 7% of the envelope long side, including L-corner ends). Shapes are traced on a cell grid, so they are rects or orthogonal polygons with no diagonals, and their edges snap to walls. Furniture nesting is checked only for single-line plans.
- `pipeline.test.ts` runs on `blue-grid.png` (opencv-js + pngjs) in about 0.3 s. It checks:
  - the envelope is within ±1%;
  - there are ≥ 4 rooms;
  - the dining table is not a room;
  - the stair/corridor core is its own room, outside the open plan;
  - there are ≥ 20 walls and all are axis-aligned;
  - polygons are orthogonal.
- Worker (`detect.worker.ts` / `detect.ts`): runs the pipeline and renders the Set-of-Marks JPEG (`marked.ts`, numbers `i + ROOM_MARK_BASE`). The dialog uploads it, then calls analyze v2 with `{imageRef, markedImageRef, crop, canvas, rooms, walls}`. The fallback is `localDraft` ("Area N").
- Import preview: shows the draft over the underlay. It has "Replace walls" and "Replace segments & rooms" toggles (`applyDraft` rescales whatever is kept) and an optional overlay of the detected rooms.
- Renderer:
  - walls are drawn as structural lines;
  - labelled outlines are drawn as dashed rooms with small labels;
  - legacy outlines are faint;
  - the underlay is positioned by `crop` and clipped to the canvas.
- The fixture blueprint now uses walls and a labelled Kitchen.
- Gates at this point: `bun test` 53 pass; typecheck and check are clean.

**Not done yet**
- §4 editor:
  - Walls tool (orthogonal by default, Alt for free angle), wall select/move/endpoint drag/Delete, snapping to endpoints, lines and the grid.
  - Vertex select + Delete.
  - Convert to rect / Orthogonalize.
  - Segment edges snapping to walls.
  - Room label rename/move/delete.
- Visual check of the editor after a real import.
- `bun run test:e2e` has not been re-run this round.
