<p><img src="packages/frontend/static/logo.svg" alt="Vibertron" height="40"></p>

# Vibertron

Companion web app for organising and running vibeathons and hackathons.

- **Managers** create events, show a rotating QR code at the venue, draw (or AI-import) a white-on-black blueprint of the venue, and launch.
- **Attendees** scan the QR code at the venue, optionally pair up with a friend, then get their team, workstation directions, a team codename, and global messages on the TV.
- **TV** (`/e/<slug>/tv`) shows the countdown, the blueprint with every team's location and codename, and the message feed. `/e/<slug>/live` is the public viewer page.
- **Admins** manage users and roles and see all events.

See [`ROADMAP.md`](ROADMAP.md) for the architecture and data model.

## Stack

Bun workspaces: `packages/common` (zod contracts and pure logic), `packages/backend` (Bun.serve, drizzle + SQLite, WebSockets, OpenRouter), `packages/frontend` (SvelteKit 2, Svelte 5, Tailwind 4, daisyUI 5), `packages/e2e` (Playwright smoke test).

## Getting started

```sh
bun install
cp .env.example .env            # set ADMIN_EMAIL / ADMIN_PASSWORD, optionally OPENROUTER_API_KEY
bun run db:migrate
bun run seed                    # creates the admin (idempotent)
bun run dev                     # backend :3001, frontend :3000
```

Sign in at http://localhost:3000/login with the admin account, then create a manager under **Admin** (or manage events as the admin).

### Running an event

1. **Events → New event**, then **Open joining**.
2. **Edit blueprint**: draw segments, set station counts, and confirm them, or use **Import floorplan**. Import runs an OpenCV contour pass in the browser, then an OpenRouter vision model labels the areas. Text editing is available in the **Markup** tab. Running at the same venue again? **Reuse floorplan** copies the blueprint from one of your earlier events.
3. Create an **invite**, then **Show QR on screen** on the venue display. The code rotates every 30 s, so only people in the room can join.
4. Open the **TV** view on the big screen.
5. **Launch**: pick a team size and duration. Teams are randomised, friends stay together, and everyone gets a workstation.
6. Attendees name their own project on their phone during the build.
7. **Voting** (on the event page): start team voting. Each team ranks its members' projects, and the top project of each team pitches. When every team has voted, the TV reveals the pitches and pitch voting opens. Close it to reveal the winner on the TV.

## Commands

| Command | What |
|---|---|
| `bun run dev` | backend + frontend dev servers |
| `bun test` | unit and integration tests (common + backend) |
| `bun run typecheck` | tsc for common + backend |
| `bun run check` | svelte-check for the frontend |
| `bun run test:e2e` | Playwright end-to-end smoke test |
| `bun run db:generate` / `db:migrate` | drizzle migrations |
| `bun run seed` | create the admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` |

## Configuration

See [`.env.example`](.env.example). Key variables: `DATABASE_PATH`, `UPLOAD_DIR`, `CORS_ORIGIN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (any OpenRouter vision model that supports structured output), `PUBLIC_API_URL`, `PUBLIC_WS_URL`. Without an OpenRouter key, floorplan import still works and falls back to unlabeled contour segments.

## Docker

```sh
docker compose up --build
```

The backend runs migrations and seeds on boot. SQLite and uploads live in the `vibertron-data` volume.
