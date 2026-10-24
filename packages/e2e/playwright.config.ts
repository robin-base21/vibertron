import { chromium, defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ADMIN, API_PORT, API_URL, WEB_PORT, WEB_URL } from './env';

/**
 * Use Playwright's own Chromium when it is installed; otherwise reuse whatever is around
 * (CHROMIUM_PATH, the newest cached ms-playwright build, or a system chromium).
 */
function chromiumPath(): string | undefined {
	if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
	if (existsSync(chromium.executablePath())) return undefined;
	const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache/ms-playwright');
	const cached = existsSync(cache)
		? readdirSync(cache)
				.filter((d) => /^chromium-\d+$/.test(d))
				.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
				.map((d) => join(cache, d, 'chrome-linux64/chrome'))
				.filter(existsSync)
		: [];
	return [...cached, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
}

const root = resolve(import.meta.dirname, '../..');
const tmp = resolve(import.meta.dirname, '.tmp');

export default defineConfig({
	testDir: './tests',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 180_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	outputDir: '.tmp/results',
	use: {
		baseURL: WEB_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		launchOptions: { executablePath: chromiumPath() }
	},
	webServer: [
		{
			// Fresh DB every run: wipe, migrate + seed the admin, then serve.
			command: `rm -rf "${tmp}/db" && bun run src/db/seed.ts && bun run index.ts`,
			cwd: join(root, 'packages/backend'),
			url: `${API_URL}/api/health`,
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: 'pipe',
			env: {
				PORT: String(API_PORT),
				DATABASE_PATH: join(tmp, 'db/e2e.sqlite'),
				UPLOAD_DIR: join(tmp, 'db/uploads'),
				CORS_ORIGIN: WEB_URL,
				ADMIN_EMAIL: ADMIN.email,
				ADMIN_PASSWORD: ADMIN.password,
				OPENROUTER_API_KEY: '',
				MESSAGE_RATE_LIMIT_MS: '2000'
			}
		},
		{
			command: `bunx vite dev --port ${WEB_PORT} --strictPort`,
			cwd: join(root, 'packages/frontend'),
			url: WEB_URL,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				PUBLIC_API_URL: API_URL,
				PUBLIC_WS_URL: `ws://localhost:${API_PORT}/ws`
			}
		}
	]
});
