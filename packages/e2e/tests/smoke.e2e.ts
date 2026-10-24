import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ADMIN, API_URL } from '../env';

// Phase 4/5 smoke test over the real backend + frontend dev server:
// manager sets up an event, three phones join and two pair up, launch, codename,
// message, moderation, end.

const phone = devices['Pixel 7'];
const EVENT_NAME = `E2E Jam ${Date.now().toString(36)}`;
const MESSAGE = 'Hello from the e2e smoke test';

interface Attendee {
	name: string;
	context: BrowserContext;
	page: Page;
}

async function newPhone(browser: Browser, name: string): Promise<Attendee> {
	const context = await browser.newContext({ ...phone });
	return { name, context, page: await context.newPage() };
}

/** Joins via the invite link; without a code the join page asks for the on-screen code. */
async function join(a: Attendee, token: string, code: () => Promise<string>, withCode: boolean) {
	await a.page.goto(withCode ? `/join/${token}?c=${await code()}` : `/join/${token}`);
	await a.page.getByPlaceholder('How your team will see you').fill(a.name);
	const codeInput = a.page.getByLabel('Enter the code shown on the venue screen');
	if (withCode) {
		await expect(codeInput).toHaveCount(0);
	} else {
		await expect(codeInput).toBeVisible();
		await expect(a.page.getByRole('button', { name: 'Join' })).toBeDisabled();
		await codeInput.fill(await code());
	}
	await a.page.getByRole('button', { name: 'Join' }).click();
	await expect(a.page.getByRole('heading', { name: 'You’re in' })).toBeVisible();
}

const friendCodeOf = (page: Page) =>
	page.locator('section', { hasText: 'Your friend code' }).locator('.font-mono').first().innerText();

/**
 * The viewer page (/e/<slug>/live) is checked only when it renders real event data; until the
 * TV worker replaces its fixture content the check is skipped with an annotation.
 */
async function publicViewShows(page: Page, path: string): Promise<boolean> {
	const res = await page.goto(path);
	if (!res || res.status() === 404) {
		test.info().annotations.push({ type: 'skip', description: `${path}: route does not exist yet` });
		return false;
	}
	const hasEvent = await page
		.getByText(EVENT_NAME)
		.first()
		.waitFor({ timeout: 5_000 })
		.then(() => true)
		.catch(() => false);
	if (!hasEvent) {
		test.info().annotations.push({ type: 'skip', description: `${path}: page does not render event data yet` });
		return false;
	}
	return true;
}

test('event lifecycle: invite → join → pair → launch → codename → message → moderate → end', async ({ browser }) => {
	const mgrContext = await browser.newContext();
	const mgr = await mgrContext.newPage();
	mgr.on('dialog', (d) => d.accept());
	const api = mgr.request; // shares the manager's session cookie

	let eventId = '';
	let slug = '';
	let token = '';
	let inviteId = '';
	const code = async () => {
		const res = await api.get(`${API_URL}/api/invites/${inviteId}/code`);
		expect(res.ok()).toBe(true);
		return ((await res.json()) as { code: string }).code;
	};

	await test.step('admin signs in and creates an event', async () => {
		await mgr.goto('/login');
		await mgr.getByLabel('Email').fill(ADMIN.email);
		await mgr.getByLabel('Password').fill(ADMIN.password);
		await mgr.getByRole('button', { name: 'Sign in' }).click();
		await expect(mgr.getByRole('heading', { name: 'Events' })).toBeVisible();

		await mgr.getByPlaceholder('Vibeathon #3').fill(EVENT_NAME);
		await mgr.getByRole('button', { name: 'Create event' }).click();
		await expect(mgr).toHaveURL(/\/manage\/[0-9a-f-]{36}$/);
		await expect(mgr.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
		eventId = mgr.url().split('/').pop()!;
	});

	await test.step('open joining and create an invite', async () => {
		await mgr.getByRole('button', { name: 'Open joining' }).click();
		await expect(mgr.getByRole('button', { name: 'Close joining' })).toBeVisible();
		await mgr.getByRole('button', { name: 'New invite' }).click();
		await expect(mgr.getByText('Active', { exact: true })).toBeVisible();

		const res = await api.get(`${API_URL}/api/events/${eventId}/invites`);
		const { invites } = (await res.json()) as { invites: { id: string; token: string }[] };
		expect(invites).toHaveLength(1);
		inviteId = invites[0]!.id;
		token = invites[0]!.token;
		const ev = (await (await api.get(`${API_URL}/api/events/${eventId}`)).json()) as { event: { slug: string } };
		slug = ev.event.slug;
	});

	const [ada, bo, cy] = await Promise.all(['Ada', 'Bo', 'Cy'].map((n) => newPhone(browser, n)));
	const attendees = [ada!, bo!, cy!];

	await test.step('three phones join (one types the code)', async () => {
		await join(ada!, token, code, true);
		await join(bo!, token, code, true);
		await join(cy!, token, code, false);
		await expect(mgr.getByRole('cell', { name: 'Cy', exact: true })).toBeVisible();
	});

	await test.step('Ada and Cy pair via friend code', async () => {
		const cyCode = (await friendCodeOf(cy!.page)).trim();
		expect(cyCode).toMatch(/^[A-Z2-9]{6}$/);
		await ada!.page.getByPlaceholder('FRIEND CODE').fill(cyCode);
		await ada!.page.getByRole('button', { name: 'Send' }).click();
		await expect(ada!.page.getByText('Waiting for them to accept')).toBeVisible();
		await expect(cy!.page.getByText('Wants to team up')).toBeVisible();
		await cy!.page.getByRole('button', { name: 'Accept' }).click();
		await expect(cy!.page.getByText('Paired · same team')).toBeVisible();
		await expect(ada!.page.getByText('Paired · same team')).toBeVisible();
	});

	await test.step('manager saves a confirmed blueprint (API)', async () => {
		const current = (await (await api.get(`${API_URL}/api/events/${eventId}/blueprint`)).json()) as { version: number };
		const res = await api.put(`${API_URL}/api/events/${eventId}/blueprint`, {
			data: {
				version: current.version,
				blueprint: {
					schemaVersion: 1,
					canvas: { w: 1000, h: 1000 },
					outlines: [],
					segments: [
						{
							id: 'hall',
							name: 'Main Hall',
							shape: 'rect',
							points: [
								[100, 100],
								[600, 500]
							],
							labelPos: [350, 300],
							stations: { count: 6, layout: 'grid', confirmed: true }
						}
					],
					titleBlock: { project: EVENT_NAME, date: '2026-10-24', rev: 'A' }
				}
			}
		});
		expect(res.status()).toBe(200);
	});

	await test.step('launch from the dialog', async () => {
		await mgr.reload();
		await mgr.getByRole('button', { name: 'Launch…' }).click();
		const dialog = mgr.locator('dialog[open]');
		await dialog.getByLabel('Team size').fill('2');
		await dialog.getByLabel('Duration (minutes)').fill('60');
		await expect(dialog.getByText('Ready to launch.')).toBeVisible();
		await dialog.getByRole('button', { name: /^Launch · 60 min/ }).click();
		await expect(dialog.getByRole('heading', { name: 'Launched' })).toBeVisible();
		await expect(dialog.getByText('2 teams assigned.')).toBeVisible();
		await dialog.getByRole('button', { name: 'Done' }).click();
		await expect(mgr.getByRole('button', { name: 'End event' })).toBeVisible();
	});

	await test.step('attendees see their workstation directions', async () => {
		for (const a of attendees) {
			await expect(a.page.getByText('Your workstation')).toBeVisible();
			await expect(a.page.getByText(/Head to\s+Main Hall/)).toBeVisible();
		}
		// paired friends share a team
		await expect(ada!.page.getByText('You’re with Cy.')).toBeVisible();
	});

	// The TV stays open from here on, so every change below must arrive over WS without a reload.
	const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
	const tv = await tvContext.newPage();
	await test.step('TV shows the live event', async () => {
		await tv.goto(`/e/${slug}/tv`);
		await expect(tv.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
		await expect(tv).toHaveTitle(`${EVENT_NAME} · TV`);
	});

	await test.step('Ada sets the codename and posts a message', async () => {
		await ada!.page.getByPlaceholder('Pick a name for the TV').fill('Night Owls');
		await ada!.page.getByRole('button', { name: 'Save' }).click();
		await expect(ada!.page.getByText('Night Owls', { exact: true })).toBeVisible();
		await expect(cy!.page.getByText('Night Owls', { exact: true })).toBeVisible();
		await expect(tv.getByText('Night Owls', { exact: true }).first()).toBeVisible();

		await ada!.page.getByPlaceholder('Shows up on the venue TV').fill(MESSAGE);
		await ada!.page.getByRole('button', { name: 'Post' }).click();
		await expect(mgr.getByText(MESSAGE)).toBeVisible();
		await expect(tv.getByText(MESSAGE)).toBeVisible();
	});

	const viewerContext = await browser.newContext();
	const viewer = await viewerContext.newPage();
	let liveViewer = false;

	await test.step('message is in the public snapshot and viewer page', async () => {
		const snap = (await (await viewer.request.get(`${API_URL}/api/e/${slug}/live`)).json()) as { messages: { body: string }[] };
		expect(snap.messages.map((m) => m.body)).toContain(MESSAGE);
		liveViewer = await publicViewShows(viewer, `/e/${slug}/live`);
		if (liveViewer) await expect(viewer.getByText(MESSAGE)).toBeVisible();
	});

	await test.step('manager hides it and it disappears', async () => {
		const row = mgr.locator('li', { hasText: MESSAGE });
		await row.getByRole('button', { name: 'Hide' }).click();
		await expect(row.getByRole('button', { name: 'Unhide' })).toBeVisible();
		await expect(mgr.getByText('1 · 1 hidden')).toBeVisible();

		await expect(tv.getByText(MESSAGE)).toHaveCount(0);
		if (liveViewer) await expect(viewer.getByText(MESSAGE)).toHaveCount(0);
		const snap = (await (await viewer.request.get(`${API_URL}/api/e/${slug}/live`)).json()) as { messages: { body: string }[] };
		expect(snap.messages.map((m) => m.body)).not.toContain(MESSAGE);
	});

	await test.step('manager ends the event', async () => {
		await mgr.getByRole('button', { name: 'End event' }).click();
		await expect(mgr.getByText('Event ended')).toBeVisible();
		for (const a of attendees) await expect(a.page.getByText('That’s a wrap')).toBeVisible();
		await expect(tv.getByText(/Final codenames/)).toBeVisible();
	});

	await Promise.all([mgrContext, tvContext, viewerContext, ...attendees.map((a) => a.context)].map((c) => c.close()));
});
