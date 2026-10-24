# Vibertron

Hackathon/vibeathon companion web app. See `ROADMAP.md` for product, architecture and phases.

## Layout
- `packages/common`: zod schemas and pure logic shared by FE/BE. No runtime deps besides zod. Unit-test everything here (`bun test`).
- `packages/backend`: Bun.serve (REST under `/api`, WS at `/ws`), drizzle + bun:sqlite. Config in `src/env.ts`.
- `packages/frontend`: SvelteKit 2, Svelte 5 runes only, Tailwind 4 + daisyUI 5 with the `blueprint` theme (`src/routes/layout.css`).

## Commands (repo root)
- `bun run dev`: backend :3001 + frontend :3000
- `bun test`: common + backend tests
- `bun run check`: svelte-check
- `bun run db:generate` / `bun run db:migrate`: drizzle migrations

## Conventions
- Import shared code as `from 'common'`. Validate every API body and WS message with the zod schemas from `common`.
- Tabs, single quotes (prettier config in the frontend).
- Blueprint style is strictly white on black plus one accent (`--color-bp-accent`) for selection. Labels use the `bp-label` utility; numbers and IDs use `font-mono`.
- AI goes only through `backend/src/ai/openrouter.ts` (OpenRouter). Never call AI from the frontend.
- Svelte work: use the Svelte MCP / svelte-file-editor agent and run the autofixer.
