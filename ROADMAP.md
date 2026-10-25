# Vibertron Roadmap

Vibertron is a companion web app for organising and running vibeathons and hackathons. Managers create events and invite attendees with a rotating QR code shown at the venue. On launch, attendees are randomly teamed up and assigned workstations on a white-on-black blueprint of the venue. A TV view shows the countdown, where every team sits, team codenames and global messages.

## Roles

| Role | Auth | Can |
|---|---|---|
| **admin** | email + password | everything; manage users and roles, see all events |
| **manager** | email + password | create and manage own events, invites, blueprints, launch, moderate messages |
| **attendee** | lightweight: display name via QR join → session cookie | join an event, pair with a friend, see directions, set team codename, post messages |
| **viewer** | none | view the live TV/public page of an event |

Roles are ordered `attendee < manager < admin` (`hasRole` in `common`). Viewers have no role.

## Core flows

1. **Invite:** the manager creates an invite link. The invite page shows a **Join** button and a full-screen **QR code**. The QR code holds `/join/:token?c=<code>`, where `code` = HMAC(event.joinSecret, floor(now / 30 s)) truncated to 6 chars. The server accepts the current and previous windows. Opening the link without a valid code asks for the code shown on the venue screen. A forwarded photo expires within a minute.
2. **Pre-launch pairing:** every participant has a short friend code. A enters B's code, B accepts, and they're guaranteed to end up on the same team.
3. **Launch:** the manager picks the team size and duration. A capacity check confirms there are enough confirmed stations. Teams are generated (seeded, reproducible) and assigned to segments/stations. The event goes `live` with `endsAt` set, and everything is broadcast over WS.
4. **Live:** the TV shows the countdown and the blueprint with teams and codenames, plus a message ticker. Attendees see their highlighted station, directions and teammates. Once their team sets a codename, they can post global messages (rate-limited, length-capped, the manager can hide them).

## Architecture

```
packages/
  common/    zod schemas + pure logic shared by FE/BE (only dependency: zod)
  backend/   Bun.serve (REST + WS pub/sub), drizzle + bun:sqlite, auth, OpenRouter
  frontend/  SvelteKit 2 / Svelte 5 runes, Tailwind 4 + daisyUI 5 ("blueprint" theme)
```

- **REST:** `Bun.serve({ routes })` under `/api/*`, JSON in/out, validated with `common` zod schemas. Cookie sessions (`httpOnly`, `SameSite=Lax`), `Bun.password` for hashing, role guard helper.
- **Realtime:** `/ws`. Clients subscribe to topic `event:{id}` and the server pushes with `server.publish`. Event payloads are a discriminated union in `common/src/ws.ts`. Server time is included so clients can correct countdown drift.
- **DB:** drizzle + `bun:sqlite` (WAL). Migrations live in `packages/backend/drizzle`, generated with `bun run db:generate` and applied with `bun run db:migrate`.
- **AI:** OpenRouter only (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`), wrapped in `backend/src/ai/openrouter.ts`. It uses the OpenAI-compatible `/chat/completions`, `response_format: json_schema` and zod validation of the reply, with one retry that includes the validation errors, then a graceful fallback. Not every model supports structured output, so validation always runs.
- **Uploads:** on disk at `UPLOAD_DIR`, served through an authenticated route.

### Data model

| Table | Key columns |
|---|---|
| `users` | id, role, email?, passwordHash?, displayName |
| `sessions` | id (token hash), userId, expiresAt |
| `events` | id, managerId, slug, name, status `draft│open│live│ended`, teamSize, durationMin, startedAt, endsAt, joinSecret |
| `invites` | id, eventId, token, active, expiresAt |
| `participants` | id, eventId, userId, friendCode, joinedAt |
| `pairings` | eventId, fromParticipantId, toParticipantId, accepted |
| `blueprints` | id, eventId, json (Blueprint), version, underlayPath |
| `teams` | id, eventId, name, codename, segmentId, stationIds (json) |
| `team_members` | teamId, participantId |
| `messages` | id, eventId, teamId, participantId, body, hidden, createdAt |

### Blueprint file (`common/src/blueprint.ts`)

A scene graph, not an image. Coordinates are normalized to a 0–1000 canvas.

```ts
{
  schemaVersion: 1,
  canvas: { w: 1000, h: 1000 },
  underlay?: { imageRef, opacity },              // original floorplan, toggleable
  outlines: [{ id, points, kind: 'wall'|'room' }],  // decorative, from OpenCV
  segments: [{
    id, name,
    shape: 'rect' | 'polygon', points: [[x,y],...],
    labelPos: [x,y],
    stations: { count, layout: 'grid' | 'row', confirmed: boolean },
    confidence?: number                          // AI-suggested → dashed + "?" badge
  }],
  titleBlock: { project, date, rev }
}
```

- Station IDs are derived (`{segmentId}-{nn}`). The renderer lays out the station symbols from `count` and `layout`.
- **Launch is blocked until every segment has `stations.confirmed = true`.**
- **Markup view:** a line-based DSL that round-trips to the same JSON (parser and serializer live in `common`):
  ```
  title "Vibeathon #3" rev A
  segment "Hall A" rect 100,100 300x200 stations 12 grid
  segment "Lounge" poly 500,100 800,100 800,400 600,400 stations 6 row
  ```

### Floorplan import pipeline

1. **Upload** an image (phone photo, PDF screenshot, CAD export). It becomes the underlay.
2. **Contours (client, opencv.js in a Web Worker, lazy-loaded):** grayscale → adaptive threshold → morphological close → `findContours` → `approxPolyDP` → normalized polygons as `outlines`, plus room candidates.
3. **Label (server, one OpenRouter vision call):** image + indexed candidate polygons → `[{ polygonIndex, name, isWorkArea, suggestedStations, confidence }]` → turned into segments with `confirmed: false`.
4. **Manager edits** in the editor/markup view and confirms the counts.

Each step is optional: if the contour pass fails you get a blank canvas with the underlay; if AI fails you get unlabeled polygons; if both fail the manager draws by hand. **The manager is the accuracy layer.**

### Visual language (white on black)

| Element | Spec |
|---|---|
| Background | `#0A0A0A`, 1 px grid `rgba(255,255,255,.035)` every 10 px |
| Structural lines | `#F5F5F5`, 1.5–2 px, `stroke-linejoin: miter`, `stroke-linecap: square` |
| Secondary lines (stations, outlines) | 0.75 px, 60% opacity |
| Labels | Barlow Condensed, uppercase, `letter-spacing: .08em` (`bp-label` utility) |
| IDs / dimensions / countdown digits | IBM Plex Mono |
| Selection | single accent `#38BDF8` at 40%, drawn *under* the white stroke |
| Low confidence | dashed stroke + "?" badge |
| Title block | bottom-right box: event, date, rev, total stations, teams |
| Print | "invert for print" toggle (black on white, same weights) |

### Team assignment (`common/src/teams.ts`, pure and unit-tested)

1. Accepted pairings → union-find groups (a group larger than teamSize is rejected at pairing time).
2. Seeded shuffle (seed stored on the event, so results are reproducible).
3. First-fit-decreasing packing into ⌈n / teamSize⌉ teams, sizes balanced to within ±1.
4. Teams assigned to segments by confirmed station capacity. A team never spans segments, and each member gets a station.
5. Returns `{ teams } | { error: 'capacity', needed, available }`.

## Phases

Each phase lists parallel **workstreams** (one subagent each) with the files they own, to avoid merge conflicts. **`common` is the contract:** schema changes land in `common` first (owned by one workstream per phase), and the others consume them.

### Phase 0: Scaffold ✅
- Workspace from `../template`: `common` package (zod, `bun test`), backend with drizzle + `bun:sqlite` + migrations, frontend with the blueprint theme and fonts.
- Template fixes: the missing env import in the WS store (now `$lib/env.ts` via `$env/dynamic/public`), the FastVote/username gate removed, Dockerfiles built from the repo root so `common` is included, vite pinned to :3000.
- **Done:** `bun install`, `bun test`, `bun run check`, `bun run db:generate`/`db:migrate` and `bun run dev` all work, and `common` imports work in the backend and in the frontend's server render.

### Phase 1: Foundations ✅
| WS | Owns | Deliverables |
|---|---|---|
| **1A common** | `packages/common/src/**` | `blueprint.ts` (schema + station ID helpers), `markup.ts` (parse/serialize + round-trip tests), `teams.ts` (algorithm + tests), `api.ts` (DTOs), `ws.ts` (event union), `joinCode.ts` (window math only; HMAC stays on the server) |
| **1B backend core** | `packages/backend/src/{db,auth,http}/**`, `index.ts` | full drizzle schema + migration, session auth (register-manager by admin, login, logout, me), attendee session creation helper, `requireRole` guard, CORS, error/validation helpers, `bun run seed` (admin from env) |
| **1C frontend shell** | `packages/frontend/src/{lib/components/ui,lib/stores,routes/(auth)}/**`, `+layout.svelte` | session store (`/api/me`), login page, role-aware nav, app layout in blueprint style, toast/error handling, typed `api()` wrappers |

**Acceptance:** an admin logs in, creates a manager, and the manager logs in and sees an empty dashboard. Common tests pass.

### Phase 2: Events and joining ✅
| WS | Owns | Deliverables |
|---|---|---|
| **2A backend** | `backend/src/routes/{events,invites,join,pairings}.ts` | event CRUD (manager owns, admin sees all), invites, `GET /invites/:id/code` (rotating), `POST /join/:token` (validates code → attendee user + participant + session), friend codes, pairing request/accept/cancel, WS `participants.updated` |
| **2B frontend** | `frontend/src/routes/{manage,join}/**` | event list/create/edit, invite panel with Join link + **full-screen QR page** (`qr` package, refreshes every window, large code text fallback), join page (name → join, code-entry fallback), attendee lobby (friend code, pair with friend), live participant list |

**Acceptance:** scanning the QR on a phone joins the event. A link older than about 60 s requires the on-screen code. Two attendees can pair.

### Phase 3: Blueprints ✅
| WS | Owns | Deliverables |
|---|---|---|
| **3A renderer + editor** | `frontend/src/lib/blueprint/**`, `routes/manage/[event]/blueprint/**` | `<Blueprint>` SVG renderer (read-only mode for TV/attendee, with highlight props), editor: add/drag/resize segments, drag vertices and labels, inline rename (double-click), stations +/- and layout, confirm toggle, delete, undo/redo, markup tab (two-way sync, inline parse errors), underlay toggle, title block, invert for print |
| **3B import pipeline** | `frontend/src/lib/floorplan/**` (worker), `backend/src/ai/**`, `backend/src/routes/blueprints.ts` | upload + storage, opencv.js worker (contours → normalized polygons), `POST /blueprints/analyze` (OpenRouter vision, strict schema, retry/fallback), merge into a draft blueprint, save/version endpoints |

**Acceptance:** upload a floorplan photo, get a draft within about 15 s (or a blank canvas with the underlay if it fails), fix it in under 2 minutes, confirm the counts and save. Markup ↔ visual round-trips losslessly.

### Phase 4: Launch and live ✅
| WS | Owns | Deliverables |
|---|---|---|
| **4A backend** | `backend/src/routes/{launch,teams,messages}.ts`, `backend/src/live/**` | launch (capacity check, transactional assignment, `live` + `endsAt`), end event, codename set (once per team, editable by members until ended), messages (requires codename, rate limit 1 per 10 s, 280 chars, manager hide), WS broadcasts, public snapshot endpoint for viewers |
| **4B TV + public** | `frontend/src/routes/e/[slug]/{tv,live}/**` | full-screen TV: huge mono countdown (server-offset corrected), blueprint with team codenames per segment, message ticker, ended state; viewer page (same data, responsive) |
| **4C attendee + manager live** | `frontend/src/routes/e/[slug]/(attendee)/**`, `routes/manage/[event]/live/**` | launch dialog (team size, duration, capacity preview), attendee view (station highlighted on the blueprint, "Segment A · Station 03" directions, teammates), codename form → message composer, manager moderation panel |

**Acceptance:** a simulated event with 3 browsers + TV: launch → everyone sees their station, the TV shows teams and the countdown, codenames appear on the TV, messages flow live, and a hidden message disappears from the TV.

### Phase 5: Admin and polish ✅
- Admin panel: users (promote/demote, reset password), all events, delete.
- Docker compose with a sqlite volume, migrations on boot, production env docs.
- Playwright e2e smoke test of the Phase 4 scenario. README.
- Nice-to-haves: AI codename suggestions (OpenRouter), event recap page, sound/alerts on the TV at T-10 min.

### Phase 6: Projects and voting
Every attendee builds their own project (name + optional tagline). The team codename stays as the team's name. After the build, the manager runs two voting rounds (`events.voting_phase`: `none → group → pitch → results`):

1. **Team voting.** The members of each team drag-rank their teammates' projects; nobody can rank their own. Teams with fewer than two projects don't vote (a single project goes straight through). The round closes automatically once every eligible member has voted, or when the manager force-closes it. Each team's top project pitches.
2. **Pitch voting.** The TV reveals the pitching projects one by one. Every attendee on a team ranks the pitches except their own. The manager closes the round and the TV reveals the winner and the full ranking.

Scoring (`common/src/voting.ts`, pure and unit-tested) is Borda on a fixed scale: with N candidates in the round, position i earns N − i. Ties go to more first places, then a seeded draw (`hashSeed(event.seed, teamId)`), shown as "decided by draw". Ballots can be changed until the round closes. Results are frozen in `voting_results` and hidden until the results phase.

| Workstream | Owns | Deliverables |
|---|---|---|
| **6A backend** | `backend/src/routes/voting.ts`, schema/migration, `dto.ts` | projects and ballots tables, project upsert, ballot upsert with eligibility checks, auto-close, compare-and-set phase actions, WS `project.updated` / `voting.updated` |
| **6B attendee + manager** | `RankList.svelte`, `LiveView.svelte`, `VotingPanel.svelte`, e2e | drag-and-drop ranking (touch + ▲/▼), project card, voting card per phase, manager voting panel, voting e2e |
| **6C TV + viewer** | `lib/blueprint/live*`, `routes/e/[slug]/{tv,live}` | team-voting progress, staggered pitch reveal with team highlights, winner reveal and ranking |

## Coordination

- The coordinator (main session) owns `ROADMAP.md`, `CLAUDE.md` and merges between phases. Workstreams run as subagents (herdr panes) in separate git worktrees, one branch per workstream (`p1/common`, `p1/backend`, ...).
- Start of each phase: the coordinator lands any `common` contract changes first, then spawns the workstreams.
- End of each phase: `bun test`, `bun run check`, a manual smoke test of the acceptance criteria, then merge.
