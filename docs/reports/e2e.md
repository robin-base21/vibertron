# E2E smoke test report

## What was built
- New workspace package `packages/e2e` uses `@playwright/test` pinned to `1.64.0`. The spec is `tests/smoke.e2e.ts`, the config is `playwright.config.ts`, and shared ports and admin credentials live in `env.ts`.
- **Self-booting**: Playwright `webServer` starts both servers and stops them afterwards.
  - Backend on **:4001**: wipes `packages/e2e/.tmp/db`, runs `src/db/seed.ts` (migrate + admin `admin@e2e.test`), then `index.ts`. It runs with `CORS_ORIGIN=http://localhost:4000`, no OpenRouter key, and `MESSAGE_RATE_LIMIT_MS=2000`.
  - Frontend on **:4000**: `vite dev --port 4000 --strictPort` with `PUBLIC_API_URL` and `PUBLIC_WS_URL` pointing at :4001.
  - `reuseExistingServer: false`, so a stale server on those ports fails the run instead of being tested by mistake. Override the ports with `E2E_API_PORT` / `E2E_WEB_PORT`.
- **Browser**: Playwright's own Chromium if it's installed. Otherwise `CHROMIUM_PATH`, then the newest cached `~/.cache/ms-playwright/chromium-*`, then `/usr/bin/chromium`. Locally Playwright 1.64.0 wants build 1248, which isn't cached, so the run used cached chromium-1243.
- Root scripts: `test:e2e` (`bun run --filter e2e test`) and `seed` (`bun run --filter backend seed`). Root `bun test` still only covers `packages/common` and `packages/backend`, and spec files use the `.e2e.ts` suffix so `bun test` never picks them up.

## Scenario (one serial test, 9 steps)
1. Admin signs in through `/login` and creates an event through the form, ending up on `/manage/<id>`.
2. **Open joining** in the UI, then **New invite**. The invite id, token and slug are read through the API using the manager page's cookie.
3. Three Pixel 7 phone contexts join:
   - Ada and Bo open `/join/<token>?c=<code>`, with the code read from `GET /api/invites/:id/code`.
   - Cy opens `/join/<token>` with no code. The test checks that the code field appears and Join stays disabled, then types the code.
   - All three see "You're in", and the manager's participant table updates live.
4. Ada sends a request to Cy's friend code (read from Cy's lobby), and Cy accepts. Both see "Paired · same team".
5. The manager saves a blueprint with one confirmed 6-station segment through `PUT /api/events/:id/blueprint`.
6. Launch through the **Launch…** dialog: team size 2, 60 min, wait for "Ready to launch.", launch. The dialog shows "2 teams assigned." and the page shows **End event**.
7. Every attendee sees "Your workstation" and "Head to Main Hall". Ada sees "You're with Cy." (the pairing held).
8. A 1920×1080 **TV** context opens `/e/<slug>/tv` and stays open. Ada sets the codename "Night Owls", which appears on Cy's phone and on the TV. Ada posts a message, which appears in the manager's moderation panel and on the TV.
9. The message is also in the public snapshot (`/api/e/<slug>/live`). The manager clicks **Hide**: the moderation panel shows "1 hidden", the message **disappears from the open TV without a reload**, and the public snapshot drops it. Then **End event** (confirm dialog accepted): the manager sees "Event ended", every phone shows "That's a wrap", and the TV shows "Final codenames".

`/e/<slug>/live` still renders fixture blueprints, not event data. The test checks it only if the page shows the event name; otherwise it records a `skip` annotation. It will start asserting automatically once the viewer page is real.

## Verification
- The final spec passed twice in a row locally (direct `playwright test`, then `bun run test:e2e`): about 37–43 s per test, about 50 s total including server boot. An earlier version without the TV checks passed once too.
- `bun test` (44 pass), `bun run typecheck`, `bun run check`, and `tsc -p packages/e2e` are clean.
- Ports 4000 and 4001 are free after the run.

## Known gaps
- Blueprint editing goes through the API, not the editor UI, as the brief asked.
- Not covered: the rate-limit UI, a rejected launch on capacity, and expired-code handling (these are covered by backend integration tests).
- The suite assumes `bun` is on PATH. Under `CI` there is no Playwright browser download step; set `CHROMIUM_PATH` or run `bunx playwright install chromium`.
- Failure artifacts (trace, screenshots) go to `packages/e2e/.tmp/results`, which is gitignored.
