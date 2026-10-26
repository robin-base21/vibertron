import { devices, expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { ADMIN, API_URL } from '../env';

// Phase 6 voting over the real backend + frontend: 4 phones in 2 teams of 2 name their projects,
// the manager starts voting, the team round closes by itself, the TV shows the 2 pitches,
// everyone ranks the pitches (touch drag on one phone, ▲/▼ on another), the manager closes the
// round and the winner shows on the phones, the manager page and the TV.

const phone = devices['Pixel 7'];
const EVENT_NAME = `E2E Vote ${Date.now().toString(36)}`;
const NAMES = ['Ada', 'Bo', 'Cy', 'Di'] as const;
const projectName = (n: string) => `Proj ${n}`;

interface Attendee {
	name: string;
	context: BrowserContext;
	page: Page;
}

interface Project {
	id: string;
	name: string;
	participantId: string;
	teamId: string;
}

interface Snapshot {
	projects: Project[];
	voting: { phase: string; pitches: Project[] };
	teams: { id: string; members: { participantId: string; displayName: string }[] }[];
}

async function newPhone(browser: Browser, name: string): Promise<Attendee> {
	const context = await browser.newContext({ ...phone });
	return { name, context, page: await context.newPage() };
}

const votingCard = (page: Page) => page.getByRole('region', { name: 'Voting' });
const rows = (page: Page) => votingCard(page).locator('li[data-rank-id]');

/** Project names in the order the RankList shows them. */
async function rankedNames(page: Page): Promise<string[]> {
	// textContent, not innerText: the labels are uppercased with CSS.
	return (await rows(page).locator('.bp-label').allTextContents()).map((s) => s.trim());
}

/** Touch-drag a row's handle so its centre lands `dy` px away, via CDP touch events. */
async function touchDrag(a: Attendee, handle: Locator, dy: number) {
	const box = (await handle.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	const cdp = await a.context.newCDPSession(a.page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	for (let i = 1; i <= 10; i++) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 10 }] });
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

/** Puts `name` first by touch-dragging its row above the first row. */
async function dragToTop(a: Attendee, name: string) {
	const row = rows(a.page).filter({ hasText: name });
	const first = rows(a.page).first();
	const [rowBox, firstBox] = [(await row.boundingBox())!, (await first.boundingBox())!];
	if (rowBox.y === firstBox.y) return;
	await touchDrag(a, row.getByRole('button', { name: /^Drag / }), firstBox.y - rowBox.y - 10);
}

/** Puts `name` first with the ▲ buttons. */
async function buttonsToTop(a: Attendee, name: string) {
	for (let i = 0; i < 10 && (await rankedNames(a.page))[0] !== name; i++) {
		await rows(a.page).filter({ hasText: name }).getByRole('button', { name: `Move ${name} up` }).click();
	}
}

/** `closesRound`: the last team ballot closes the round at once, so there is no "Saved" state. */
async function submitBallot(page: Page, closesRound = false) {
	const card = votingCard(page);
	await card.getByRole('button', { name: /^(Submit|Update) ranking$/ }).click();
	if (!closesRound) await expect(card.getByText('Saved, you can change it until the round closes.')).toBeVisible();
}

test('voting: projects → team round (auto-close) → pitch round → results', async ({ browser }) => {
	const mgrContext = await browser.newContext();
	const mgr = await mgrContext.newPage();
	mgr.on('dialog', (d) => d.accept());
	const api = mgr.request;

	let eventId = '';
	let slug = '';
	let token = '';
	let inviteId = '';
	const code = async () =>
		((await (await api.get(`${API_URL}/api/invites/${inviteId}/code`)).json()) as { code: string }).code;
	const snapshot = async () => (await (await api.get(`${API_URL}/api/e/${slug}/live`)).json()) as Snapshot;

	await test.step('admin creates an event with an invite and a blueprint', async () => {
		await mgr.goto('/login');
		await mgr.getByLabel('Email').fill(ADMIN.email);
		await mgr.getByLabel('Password').fill(ADMIN.password);
		await mgr.getByRole('button', { name: 'Sign in' }).click();
		await mgr.getByPlaceholder('Vibeathon #3').fill(EVENT_NAME);
		await mgr.getByRole('button', { name: 'Create event' }).click();
		await expect(mgr).toHaveURL(/\/manage\/[0-9a-f-]{36}$/);
		eventId = mgr.url().split('/').pop()!;

		await mgr.getByRole('button', { name: 'Open joining' }).click();
		await expect(mgr.getByRole('button', { name: 'Close joining' })).toBeVisible();
		await mgr.getByRole('button', { name: 'New invite' }).click();
		await expect(mgr.getByText('Active', { exact: true })).toBeVisible();
		const { invites } = (await (await api.get(`${API_URL}/api/events/${eventId}/invites`)).json()) as {
			invites: { id: string; token: string }[];
		};
		inviteId = invites[0]!.id;
		token = invites[0]!.token;
		slug = ((await (await api.get(`${API_URL}/api/events/${eventId}`)).json()) as { event: { slug: string } }).event.slug;

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
							stations: { count: 4, layout: 'grid', confirmed: true }
						}
					],
					titleBlock: { project: EVENT_NAME, date: '2026-10-25', rev: 'A' }
				}
			}
		});
		expect(res.status()).toBe(200);
	});

	const attendees = await Promise.all(NAMES.map((n) => newPhone(browser, n)));
	const byName = (n: string) => attendees.find((a) => a.name === n)!;

	await test.step('four phones join', async () => {
		for (const a of attendees) {
			await a.page.goto(`/join/${token}?c=${await code()}`);
			await a.page.getByPlaceholder('How your team will see you').fill(a.name);
			await a.page.getByRole('button', { name: 'Join' }).click();
			await expect(a.page.getByRole('heading', { name: 'You’re in' })).toBeVisible();
		}
		await expect(mgr.getByRole('cell', { name: 'Di', exact: true })).toBeVisible();
	});

	await test.step('launch with teams of 2', async () => {
		await mgr.getByRole('button', { name: 'Launch…' }).click();
		const dialog = mgr.locator('dialog[open]');
		await dialog.getByLabel('Team size').fill('2');
		await dialog.getByLabel('Duration (minutes)').fill('60');
		await expect(dialog.getByText('Ready to launch.')).toBeVisible();
		await dialog.getByRole('button', { name: /^Launch · 60 min/ }).click();
		await expect(dialog.getByText('2 teams assigned.')).toBeVisible();
		await dialog.getByRole('button', { name: 'Done' }).click();
		for (const a of attendees) await expect(a.page.getByText('Your workstation')).toBeVisible();
	});

	await test.step('everyone names a project', async () => {
		for (const a of attendees) {
			const card = a.page.getByRole('region', { name: 'Your project' });
			await card.getByPlaceholder('Project name').fill(projectName(a.name));
			await card.getByPlaceholder('One-line pitch (optional)').fill(`${a.name}'s idea`);
			await card.getByRole('button', { name: 'Save project' }).click();
			await expect(card.getByText(projectName(a.name), { exact: true })).toBeVisible();
		}
		await expect(mgr.getByText('4 of 4 members have named a project.')).toBeVisible();
		expect((await snapshot()).projects).toHaveLength(4);
	});

	// The TV stays open: every phase change below must reach it over WS.
	const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
	const tv = await tvContext.newPage();
	await tv.goto(`/e/${slug}/tv`);
	await expect(tv.getByRole('heading', { name: EVENT_NAME })).toBeVisible();

	await test.step('manager confirms voting from the header; the build ends and project names lock', async () => {
		await mgr.getByRole('button', { name: 'Start voting…' }).click();
		const confirm = mgr.getByRole('dialog', { name: 'Start voting?' });
		await expect(confirm.getByText(/Ends the build now/)).toBeVisible();
		await expect(confirm.getByText('4 of 4 attendees named a project.')).toBeVisible();
		await confirm.getByRole('button', { name: 'End build and start voting' }).click();
		await expect(confirm).toBeHidden();
		await expect(mgr.getByRole('listitem').filter({ hasText: 'Team vote' })).toHaveAttribute('aria-current', 'step');
		await expect(mgr.getByText('Team round', { exact: true })).toBeVisible();
		for (const a of attendees) {
			await expect(votingCard(a.page).getByRole('heading', { name: 'Team vote' })).toBeVisible();
			await expect(a.page.getByText('Locked for voting')).toBeVisible();
		}
	});

	await test.step('team round: each member ranks their teammate; the round closes by itself', async () => {
		for (const [i, a] of attendees.entries()) {
			// Teams of 2: the only candidate is the teammate's project, never your own.
			await expect(rows(a.page)).toHaveCount(1);
			expect(await rankedNames(a.page)).not.toContain(projectName(a.name));
			await submitBallot(a.page, i === attendees.length - 1);
		}
		await expect(mgr.getByText('Pitch round', { exact: true })).toBeVisible();
		for (const a of attendees) {
			await expect(votingCard(a.page).getByRole('heading', { name: 'Pitch vote' })).toBeVisible();
		}
	});

	const snap = await snapshot();
	const pitches = snap.voting.pitches;
	const nameOf = (participantId: string) =>
		snap.teams.flatMap((t) => t.members).find((m) => m.participantId === participantId)!.displayName;
	const pitchers = pitches.map((p) => nameOf(p.participantId));
	const others = NAMES.filter((n) => !pitchers.includes(n));
	const [winner, runnerUp] = [pitches[0]!, pitches[1]!];

	await test.step('TV and manager show the two pitches', async () => {
		expect(pitches).toHaveLength(2);
		expect(new Set(pitches.map((p) => p.teamId)).size).toBe(2);
		for (const p of pitches) {
			await expect(tv.getByText(p.name, { exact: true }).first()).toBeVisible();
			await expect(mgr.getByText(p.name, { exact: true })).toBeVisible();
		}
	});

	await test.step('pitch round: drag on one phone, ▲/▼ on another, ballot change before close', async () => {
		// Pitchers only see the other pitch.
		for (const n of pitchers) {
			const page = byName(n).page;
			await expect(rows(page)).toHaveCount(1);
			expect(await rankedNames(page)).not.toContain(projectName(n));
			await submitBallot(page);
		}

		const [dragger, clicker] = [byName(others[0]!), byName(others[1]!)];
		await expect(rows(dragger.page)).toHaveCount(2);

		// Touch drag: runner-up to the top first (so at least one real drag happens), then the winner.
		await dragToTop(dragger, runnerUp.name);
		expect((await rankedNames(dragger.page))[0]).toBe(runnerUp.name);
		await dragToTop(dragger, winner.name);
		expect(await rankedNames(dragger.page)).toEqual([winner.name, runnerUp.name]);
		await submitBallot(dragger.page);

		// Buttons: vote runner-up first, then change the ballot before the round closes.
		await buttonsToTop(clicker, runnerUp.name);
		await submitBallot(clicker.page);
		await buttonsToTop(clicker, winner.name);
		await expect(votingCard(clicker.page).getByText('Unsaved changes')).toBeVisible();
		await submitBallot(clicker.page);
		expect(await rankedNames(clicker.page)).toEqual([winner.name, runnerUp.name]);

		await expect(mgr.getByText(/4\/4\s+ballots cast/)).toBeVisible();
	});

	await test.step('manager closes the round; the winner is revealed everywhere', async () => {
		await mgr.getByRole('button', { name: 'Reveal winner…' }).click();
		const confirm = mgr.getByRole('dialog', { name: 'Reveal the winner?' });
		await expect(confirm.getByText('4 of 4 ballots cast.')).toBeVisible();
		await confirm.getByRole('button', { name: 'Reveal winner' }).click();
		await expect(mgr.getByText('Final ranking')).toBeVisible();
		const first = mgr.getByRole('region', { name: 'Voting' }).locator('ol').first().locator('li').first();
		await expect(first).toContainText(winner.name);
		await expect(first).toContainText('6 pts');

		for (const a of attendees) {
			const card = votingCard(a.page);
			await expect(card.getByRole('heading', { name: 'Results' })).toBeVisible();
			await expect(card.getByText(winner.name, { exact: true })).toBeVisible();
			await expect(card.getByText(/Your project placed/)).toBeVisible();
		}
		await expect(tv.getByText(winner.name, { exact: true }).first()).toBeVisible();
	});

	await Promise.all([mgrContext, tvContext, ...attendees.map((a) => a.context)].map((c) => c.close()));
});
