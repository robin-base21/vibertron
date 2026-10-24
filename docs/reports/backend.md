# Backend worker report

## What was built
The whole REST and WS contract from `packages/common/src/api.ts` and `ws.ts`, in `packages/backend`:

- **Core** (`src/server.ts`, `src/http`, `src/auth`, `src/db`): `createServer({ port, dbPath, env, fetch, autoEndIntervalMs })` boots Bun.serve with one router module per area under `src/routes/`. `index.ts` only calls it. Every handler is wrapped so that `HttpError` becomes an `ApiErrorBody`, and CORS headers (credentials, origin from `CORS_ORIGIN`) are added to every response. OPTIONS gets a 204 preflight. Unknown paths return 404 and wrong methods on known paths return 405. Bodies are validated with the zod schemas from `common`.
- **Schema**: the full data model from ROADMAP, plus `events.seed`, `participants.lastMessageAt` (for the rate limit), `teams.position`, `team_members.stationId` and an `uploads` table (ref → content type). It is an additive migration, `drizzle/0001_*`.
- **Auth**: `vt_session` cookie (httpOnly, SameSite=Lax, optional Secure via `COOKIE_SECURE`). The database stores the sha256 of a random 32-byte token, and sessions expire after 30 days. Passwords use `Bun.password`. Guards are `requireUser`, `requireRole` and `requireEventManager`. A password reset by an admin revokes that user's sessions. The last admin can't be demoted or deleted, and admins can't delete themselves.
- **Seed**: `bun run --filter backend seed` (that is, `src/db/seed.ts`). It runs migrations, then creates the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. It is idempotent and skips when either variable is unset.
- **Events / joining**:
  - Slugs are generated automatically (`vibe-night`, `vibe-night-2`, …). An explicit slug that is already taken returns 409.
  - Status can only move between draft and open through PATCH.
  - Invites support expiry and the active flag.
  - The rotating code is HMAC-SHA256(joinSecret, window) mapped with `bytesToCode`. The current and previous windows are both accepted.
  - Join returns 404 for an unknown token, 410 for an inactive or expired invite, 403 for a wrong code, and 409 unless the event is `open`.
  - Friend codes are 6 characters from the join alphabet and unique per event.
  - Pairings: no self-pairing, no duplicates in either direction (409 with `details.pairingId`), and a merged group must stay within `teamSize ?? 4`, checked both when requesting and when accepting. Only the recipient can accept. Either party, or the event manager, can delete. Pairing closes once the event is live.
- **WS** (`src/live/ws.ts`, `src/live/broadcast.ts`, `src/live/notify.ts`):
  - The session is read at upgrade, and the socket is auto-subscribed to `user:{id}`.
  - `subscribe` with public scope is open to anyone. Manage scope is only for the event manager or an admin; the user is re-read at subscribe time. A manage subscription joins both the public and the manage topics.
  - `subscribed` returns a snapshot, and the manage snapshot includes hidden messages.
  - `ping` is answered with `pong` and `serverTime`, and invalid messages get an `error`.
  - Broadcasts: `participants.updated`/`participants.count`, `event.updated`/`event.manage.updated`, `pairing.updated` (sent to both users), `blueprint.updated`, `launched`, `assignment` (to each user), `team.updated`, `message.created`, `message.hidden` (public) together with `message.manage` (manage).
- **Blueprints / AI**:
  - PUT uses an optimistic `version`. A mismatch returns 409 with `details.version` set to the current version.
  - Uploads are multipart `file`, at most 15 MB (413 otherwise). The type is detected from magic bytes, so only PNG/JPEG/GIF/WebP are accepted (415 otherwise; SVG is refused on purpose). Refs are random 32-hex, files live in `UPLOAD_DIR/<ref>`, and they are served with the stored content type, `nosniff` and immutable caching.
  - `src/ai/openrouter.ts` provides `structuredCompletion`: strict `json_schema` response format, an image sent as a base64 data URL, a 60 s timeout, zod validation, and one retry that feeds the validation errors back to the model.
  - `src/ai/analyze.ts` covers the prompt, the strict schema, and mapping areas to segments (`confirmed: false`, confidence, deduplicated names, and rects clamped to 0..1000 when there is no candidate). Outlines come from the request body and the underlay is the uploaded image. If the key is missing or anything fails, it returns `source: 'fallback'` with "Area N" segments and a warning.
- **Launch / live**:
  - Preview runs `assignTeams` as a dry run.
  - Launch requires `open` and a stored blueprint, and returns 409 with `error: 'capacity'` and `details { needed, available }`, or with `error: 'invalid'`. A single transaction does a guarded open→live flip, then inserts teams and members with their station IDs. It stores the seed, `startedAt`, `endsAt`, `teamSize` and `durationMin`.
  - End is manual, and a 5 s interval also auto-ends live events once they pass `endsAt`.
  - Codenames: team members only, live only, unique per event (case-insensitive).
  - Messages need a codename (409 `codename_required`). The per-participant rate limit is an atomic check-and-set, returning 429 with `details.retryAfterMs`.
  - Moderation is for the event manager.
  - `GET /api/e/:slug/live` includes hidden messages only for the manager or an admin.
- **Ops**: the Dockerfile runs migrate, then seed, then `exec` the server, with `/data` as a volume. Compose passes `CORS_ORIGIN`, `COOKIE_SECURE`, `ADMIN_*`, `OPENROUTER_*` and `MESSAGE_RATE_LIMIT_MS`. `.env.example` was updated, and the unused `SESSION_SECRET` was removed.

## Verification
- `bun test`: 35 tests pass. The backend suites under `packages/backend/test/` boot real servers on random ports with temporary SQLite databases:
  - `auth.test.ts`: seed, CORS/preflight, login/me/logout, admin user management and guards.
  - `events.test.ts`: join code windows, slugify, event CRUD and ownership, invites/code, all join error cases, idempotent join, a manager joining their own event, pairings and the group limit.
  - `ws.test.ts`: ping, errors, public vs manage scope, participant/event broadcasts, unsubscribe, `pairing.updated` to both users.
  - `ai.test.ts`: mocked fetch covering the request shape, response → blueprint mapping, the retry carrying validation errors, fallback on invalid replies, HTTP errors and a missing key.
  - `blueprints.test.ts`: versioning/409 and broadcast, uploads (415/413/404/path traversal), analyze through the server with a mocked OpenRouter.
  - `flow.test.ts`: the full brief scenario. Admin seed → login → create manager → event → invite → code → 3 attendees join (one with a wrong code → 403) → pairing → unconfirmed blueprint blocks launch → confirm → launch (`launched` + `assignment` over WS) → codename → message → 429 → teammate posts → hide (`message.hidden` + `message.manage`) → public vs manager snapshot → end. It also checks auto-end.
- `bun run typecheck` and `bun run check` are clean.
- Manual smoke test on port 4001: migrate, seed twice (idempotent), boot, health check, login, `/api/auth/me` with the cookie. The server was stopped afterwards.
- I did not run `docker build`. `docker compose config` validates.

## Decisions / known gaps
- A user who is already a participant gets an idempotent success from `POST /api/join/:token`, even with a stale or wrong code (the QR link is just reopened). Everyone else needs a valid code.
- PUT blueprint returns 409 while the event is live, because changing station counts would break assignments. Removing participants is blocked while live for the same reason.
- 429 responses carry `details.retryAfterMs`, not a `Retry-After` header.
- `GET /api/e/:slug/me` returns the blueprint whatever the event status is.
- Analyze accepts only images uploaded to the same event.
- Fallback segments get `stations.count = 0` and no confidence.
- The seed script is a backend package script (`bun run --filter backend seed`). I didn't add a root alias because the root `package.json` isn't mine.
- Added `zod` as a direct dependency of `packages/backend`, which also updates the root `bun.lock`, because it isn't hoisted to the backend.
- The milestone 1 commit had test typecheck errors. They are fixed in `bb2cdcb`, which sits on top of the commit already merged into main.

## COMMON CHANGES
None.

## Round 3: analyze v2

### What changed
- **Route** (`POST /api/events/:id/blueprint/analyze`):
  - `markedImageRef` is checked the same way as `imageRef`: a malformed ref returns 400, and an upload that is missing or belongs to another event returns 404.
  - The model sees the marked image when one is sent, otherwise the original. The original always stays the underlay.
  - `rooms`, `walls`, `crop` and `canvas` are passed through.
- **Code layout** (`packages/backend/src/ai/`):
  - `draft.ts` holds the shared helpers: base blueprint with walls `w1..`, underlay plus `crop`, segment and outline builders, name de-duplication, and canvas ↔ model-space conversion.
  - `analyze-v1.ts` is the unchanged legacy path.
  - `analyze.ts` is v2 plus the `analyzeFloorplan` dispatcher.
- **Prompt and schema v2**:
  - The input is the marked image plus a room list: `N: box [ymin, xmin, ymax, xmax]` in 0..1000 of the marked image.
  - The reply has, per room: `index`, `name`, `kind` (`work|lounge|kitchen|meeting|corridor|stairs|toilet|storage|other`), `confidence`, and `zones[] {name, kind, box}`. A top-level `extraZones[]` covers work areas the CV missed entirely.
  - There are no station counts. The JSON Schema is strict and plain (no provider extensions, no `minItems`); zod checks box length and clamps confidence. The one retry with validation errors works as before.
  - The model comes from `OPENROUTER_MODEL`, and the schema name is `floorplan_rooms`.
- **Draft building** (on the request canvas):
  - Work room without work zones → a segment from the room geometry. Rects get normalized corners; orthogonal polygons are kept as they are.
  - Work zones → rect segments. Order: box → canvas, snap each edge to the nearest wall line within 2% of the long side (only walls whose span overlaps the zone), then clamp into the room's bbox. Zones that collapse below 1% of the long side are dropped.
  - Non-work rooms and non-work zones → `kind: 'room'` outlines with `label`, as closed polygons (rects expand to 4 corners).
  - A non-work room that contains work zones keeps its labelled outline and also gets the zone segments.
  - All segments get `stations: { count: 0, layout: 'grid', confirmed: false }`. Rooms and zones carry the room's confidence; extra zones get 0.5.
- **Fallback** (no key, or any AI error after the retry): each room becomes segment "Area N". Walls and crop are kept, with `source: 'fallback'` and a warning.
- **Legacy**: when `rooms` is empty and `candidates` is non-empty, the old v1 prompt, schema and mapping run unchanged. With no rooms and no candidates, the v2 prompt asks for `extraZones` only.
- **Dev script**: `bun run --filter backend analyze:fixture <image> <rooms.json> [--marked <img>]`.
  - It prints the raw model replies (including the retry), the timing, and a segment/outline summary.
  - Without `OPENROUTER_API_KEY` it is a dry run: it prints the prompt and the fallback draft and never touches the network.
  - Example input: `packages/backend/scripts/fixtures/rooms.example.json`.

### Decisions the blueprint worker needs to match
- **Room marks are 1-based**: `rooms[i]` must be drawn as number `i + 1` on the marked image (`ROOM_MARK_BASE` in `analyze.ts`). The room list in the prompt uses the same numbers.
- Boxes are relative to the **marked image**, which is assumed to cover exactly the request canvas (the crop), so `x = xmin / 1000 * canvas.w` and `y = ymin / 1000 * canvas.h`.

### Other decisions / gaps
- Rooms the model leaves out become **unlabelled** room outlines, not segments, so they don't block launch. Invalid or duplicate indices are ignored; the first entry wins.
- Zones are clamped to the room's **bounding box**, not to the exact shape of an L-shaped orthogonal polygon.
- Walls more than 1% of the long side away from axis-aligned are ignored for snapping, but still kept as walls.
- I didn't run the script against the real OpenRouter API because no key was set. The dry run on the blue-grid fixture works.

### Verification
- `bun test`: 56 pass, including the new `test/analyze-v2.test.ts` and the extended `test/blueprints.test.ts`. They cover:
  - request shape: marked image sent as a JPEG data URL, numbered room list in model space, strict schema with no station fields;
  - zone wall-snapping and clamping;
  - non-work rooms and zones becoming labelled outlines, and skipped rooms becoming unlabelled outlines;
  - extra zones;
  - fallback for no key, network error, and two invalid replies;
  - legacy v1 compatibility (existing `ai.test.ts` and the route test with `candidates`);
  - `markedImageRef` validation (400, 404, other event's upload → 404).
- `bun run typecheck` and `bun run check` are clean.
- No common changes this round.
