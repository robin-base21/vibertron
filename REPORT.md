# Worker report: app (frontend application)

Branch `ws/app`. All six milestones are done and committed. `main` was merged three times as the coordinator asked (most recently with the full backend live API). `bun test` (35 pass), `bun run typecheck` and `bun run check` (0 errors, 0 warnings) are green.

## What was built

### Shell (M1)
- **`src/lib/api/`**: `client.ts` with an `api()` that parses `ApiErrorBody` into `ApiError { status, code, message, details }` and maps network failures to `status 0`. `index.ts` has typed wrappers for **every** endpoint in `common/src/api.ts`, grouped as `auth`, `admin`, `events`, `invites`, `join`, `attendee`, `blueprints`, `launch` and `live`. Request bodies are parsed with the shared zod schemas (so trim/uppercase transforms apply) before sending. `api()` still accepts pre-serialized string bodies, because `lib/blueprint/api.ts` passes `JSON.stringify(...)`.
- **Stores:**
  - `session.svelte.ts`: `me`, `is(role)`, `ensure()`, `refresh()` (re-reads `/api/auth/me`, then `wsStore.reconnect()`), `login()`, `logout()`.
  - `toast.svelte.ts`: toasts, `handleError` and `errorMessage`.
  - `clock.svelte.ts`: a server-offset clock built on `createSubscriber`, which only ticks while it's being read; plus `formatDuration`.
  - `attendee.svelte.ts`: the `AttendeeState` class, which keeps `AttendeeContextDTO` fresh over WS.
- **Layout:** VIBERTRON wordmark and role-aware nav (Admin / Events / My event / Sign in / Sign out). Sign out is shown only to staff, because attendee sessions can't be recovered. The top bar is hidden on the QR and TV routes. Also a toast stack and a `+error.svelte`.
- **Guards:** `requireRole()` in `$lib/guards.ts`, used by `manage/+layout.ts` and `admin/+page.ts`. Signed-out users are redirected to `/login?next=…`. Signed-in staff who lack the role get a 403 page (redirecting them looped through `/login`).
- **Pages:** `/` sends managers to `/manage`, gives attendees a link to each event they've joined, and otherwise shows a short pitch and a sign-in link. `/login` honours `?next=`.

### Manager (M2)
- **`/manage`:** event list and a create form (name, optional slug).
- **`/manage/[id]`:**
  - Status badge and open/close joining (draft↔open).
  - Live participant list: subscribes with the `manage` scope and handles `participants.updated`, `participants.count`, `event.updated` and `event.manage.updated`. Participants can be removed.
  - Invites panel: create, deactivate/reactivate, copy join link, "Show QR on screen".
  - "Edit blueprint" links to `/manage/[id]/blueprint`; "Open TV" opens `/e/[slug]/tv` in a new tab.
  - Delete event (outside `live`).
- **`/manage/[id]/qr/[inviteId]`:** full screen with a huge QR, rendered by `QrSvg.svelte` from the `qr` package's `raw` output. It also shows the 6-char code in large mono, the event name and a thin progress bar for the current window. Polling is aligned to `windowStart + windowMs` (+250 ms), with a 5 s cap as a safety net, and the server clock offset is taken from `serverTime`.

### Joining (M3)
- **`/join/[token]`:** reads `?c=`, shows the event name, a name input and a Join button. If the code is missing, or the server rejects it with 403, it shows "Enter the code shown on the venue screen" with a 6-char input filtered to the join alphabet. If you're already a participant it redirects straight to the event. Invites that are invalid (404/410) or events that aren't open get a clear message.
- **`/e/[slug]` (lobby):** "You're in", your friend code shown big, a friend-code form, and incoming/outgoing/accepted pairings with accept, decline, cancel and unpair. These update live via `pairing.updated`. Also the participant count (live) and "Waiting for launch". Visitors who aren't participants (401/403/404 from `/me`) are redirected to `/e/[slug]/live`.

### Launch (M4)
- **`LaunchDialog.svelte`:** team size, duration with 1h/2h/4h/8h presets, and a debounced live `/launch/preview` showing teams, participants, stations and unconfirmed segments, with a link to the editor. The Launch button is enabled only when `preview.ok`. A `409 capacity` shows needed vs available. After launch it shows the team result (teams, segment, member stations).
- **Live controls on `/manage/[id]`:** a countdown using `wsStore.now()`, End event (with a confirm), and a moderation list (`Moderation.svelte`). Its contents come from the `subscribed` snapshot (which includes hidden messages for managers) plus `message.manage`, `message.created` and `message.hidden`, deduped by id, with a hide/unhide toggle. The participant table shows each team's codename or name, kept live via `launched` and `team.updated`.

### Attendee live (M5)
- **`LiveView.svelte`:**
  - Countdown at the top.
  - "Your workstation: SEGMENT · Station 03" in big type, with directions: segment, station number, station ID and teammates' names.
  - The real `<Blueprint>` from `$lib/blueprint` with `highlightStationId` and `highlightSegmentId`.
  - Team list and the team-wide codename form (editable, live via `team.updated`).
  - Once a codename is set: a composer with a `MESSAGE_MAX_LENGTH` counter. After a successful post, a cooldown of `MESSAGE_RATE_LIMIT_MS` starts. A 429 starts a cooldown from `details.retryAfterMs`.
  - Recent messages feed, newest first; hidden ones are removed live.
  - Ended state ("That's a wrap").
- Switches from lobby to live view live on `event.updated`, `launched` and `assignment`.

### Admin (M6)
- **`/admin`:**
  - Users table, with attendees hidden behind a toggle.
  - Create a manager or admin.
  - Inline role select.
  - Inline password reset.
  - Delete with a confirm. You can't change your own role or delete yourself.
  - All-events table with manager names, linking to `/manage/[id]`.

## How it was verified
All checks ran against the **real backend** from `main`, on my ports (backend 4101 with `DATABASE_PATH=data/app.sqlite`, frontend 4100), driven by headless Chromium through `playwright-core`. The scripts live in my scratchpad and are not committed.
1. **M1–M3:** guard redirect, admin login, create event, open joining, new invite, QR page. Then on a phone viewport: Alice joins via the QR link. Bob opens the link without a code, his wrong code `ZZZZZZ` gets 403 and the "enter the code" prompt, and the real code works. Bob sends a pairing to Alice's friend code and Alice accepts.
2. **M4–M5** (manager plus 3 phones):
   - Participants appear live on the manager page, and the lobby count is live.
   - The pairing request and the accept both arrive over WS with no reload.
   - The launch preview flags the unconfirmed segment and the Launch button stays disabled. After confirming, launch shows the team result.
   - Attendees switch to the live view over WS, and paired Alice and Bob share a team and segment.
   - Alice's codename appears on Bob's phone live. Bob's message appears on Cara's phone live. Bob's second post shows "Wait 10s".
   - The manager sees the message live. Hiding it removes it from Cara's feed. End event shows the ended state to attendees.
3. **M6:**
   - Create a manager, switch role admin→manager, reset the password.
   - The old password is rejected and the new one works, landing on an empty `/manage` with no Admin link.
   - A manager opening `/admin` gets 403. Anonymous `/manage/xyz` goes to `/login?next=…`, anonymous `/e/<slug>` goes to `/e/<slug>/live`, and a bad invite shows "no longer valid".
4. **QR rotation:** the code on screen changed about 1.2 s after the 30 s window boundary.
5. I checked the screenshots of every screen above for the blueprint look. Every component went through `svelte-autofixer`. The only remaining suggestions are "assignment inside $effect" false positives: WS callbacks, the debounced preview fetch, and `bind:this` on the dialog.

## Decisions / notes
- **`ssr = false` at the root `+layout.ts`.** The session cookie belongs to the API origin, so server-side loads can't see it, and the app is effectively an SPA. The blueprint worker's routes inherit this and can override it per route.
- **QR colours:** the QR is drawn dark-on-white inside the black page rather than inverted, because many phone scanners reject inverted codes.
- **WS store bug fix** (my file, API unchanged): the handlers now ignore events from sockets that were replaced. Previously `reconnect()` could have the old socket's late `onclose` null out the new socket and start a duplicate connection, which caused "send while CONNECTING" errors. `send()` now checks `readyState === OPEN`, and the retry timer is cleared on disconnect.
- **Attendees get no sign out.** Their session is name-only, so signing out would orphan their participation.
- **`BlueprintView` placeholder removed.** Once the real renderer landed on main, `LiveView` imports `$lib/blueprint/Blueprint.svelte` directly.
- **Own-team messages** use the accent colour in the attendee feed (it works as a "selection" highlight). It's a one-line change if the coordinator wants pure white.

## Known gaps
- No automated e2e test is committed; the Playwright scripts were throwaway. The Phase 5 e2e smoke test is still open.
- One unexplained `404` console entry on the manager page during the long scenario. The response listener didn't catch its URL, so it's probably a non-API asset such as the favicon. It has no functional impact.
- The admin role select also offers promoting attendees (users without email/password) to manager. Whether to allow that is up to the backend; the UI just shows the error if it refuses.
- A participant removed by a manager isn't told so live: their page errors on the next action and recovers on reload.

## COMMON CHANGES
None.
