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
5. **Launch**: pick a team size and duration. Teams are randomised, friends stay together, and everyone gets a workstation. Latecomers can still join with the invite until voting starts; they wait on their phone until a manager or admin lets them in from **Late arrivals** on the event page (into a suggested team, a friend's team, or a new one) or turns them away.
6. Attendees name their own project on their phone during the build, optionally with a project link and a presentation PDF (up to 20 MB). Only the author and managers see these until voting starts; then everyone can open them while ranking. Name and link lock when voting starts; the PDF can be replaced until pitch voting opens. Need to fix the seating? **Rearrange teams** (managers and admins): drag a person onto another team or swap two people, or drag a whole team into another area on the list or on the plan. People stay put once voting starts; whole teams can still move.
7. **Voting** (on the event page): start team voting. Each team ranks its members' projects, and the top project of each team pitches. When every team has voted, the TV reveals the pitches and pitch voting opens. Close it to reveal the winner on the TV.

## Public site (`packages/site`)

A separate SvelteKit app with its own SQLite database: event pages with signups (name, email, optional newsletter opt-in, waitlist past capacity), past events with results and a project showcase, and an admin area at `/admin` (password `SITE_ADMIN_PASSWORD`) to create events, see signups, mark them **paid** by hand, and export CSVs.

Vibertron's only link to it is **Publish to site** (manager page, after the winner is revealed): it pushes the results, the projects whose authors chose "show on the public website" on their phone, and their slides. Contract in `common/src/publish.ts`; set the same `SITE_PUBLISH_SECRET` on both sides and `SITE_PUBLISH_URL` (the site's `/api/results`) on Vibertron. To land results on an event page you already made on the site, put the Vibertron event slug in its "Vibertron event slug" field; otherwise a new past-event page is created.

- `bun run dev:site`: site on :3100 (runs on Bun for `bun:sqlite`)
- `bun run check:site`: svelte-check for the site
- Docker: the `site` service in `docker-compose.yml`; it is served at https://vibe.ourbusan.life (`SITE_ORIGIN`, the default; links in emails use it). For a local http test set `SITE_ORIGIN=http://localhost:3100` and `SITE_COOKIE_SECURE=false`.

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

### Behind Pangolin (same host)

Set the host ports in `.env` (no edits to `docker-compose.yml` needed):

```sh
FRONTEND_PORT=3080
BACKEND_PORT=3081
SITE_PORT=3082
```

Then `docker compose up -d --build`, and in Pangolin (local site):

| Domain | Target |
|---|---|
| `vibe.ourbusan.life` | host port `3082`, authentication off (public site) |
| the event app's domain | `/api` and `/ws` → port `3081`, everything else → port `3080` |

The event app publishes results to the site inside Docker (`http://site:3100/api/results`), so that
path never goes through Pangolin. The site's data (SQLite, flyers, slides, payment screenshots) lives
in the `vibertron-site-data` volume.

If Pangolin's targets are container names instead of IP and port, also add the containers to
Pangolin's Docker network: `docker compose -f docker-compose.yml -f docker-compose.pangolin.yml up -d --build`
(targets `vibertron-site:3100`, `vibertron-backend:3001`, `vibertron-frontend:3000`). Host ports stay.
