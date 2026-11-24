import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, API_URL } from '../env';

// Manager rearranges teams after launch, starting from a full hall: swaps two people by dragging one
// onto the other, drags a team onto the empty lab on the plan, then moves a person by click-to-pick.
// The swapped person's phone follows along.

const EVENT_NAME = `E2E Move ${Date.now().toString(36)}`;
const NAMES = ['Ann', 'Ben', 'Cat', 'Dan'] as const;

interface Snapshot {
	teams: { id: string; name: string; segmentId: string; members: { displayName: string; stationId: string }[] }[];
}

const segment = (id: string, name: string, x: number, count: number) => ({
	id,
	name,
	shape: 'rect',
	points: [
		[x, 100],
		[x + 350, 450]
	],
	labelPos: [x + 175, 275],
	stations: { count, layout: 'grid', confirmed: true }
});

/** Mouse drag in small steps so pointermove fires along the way. */
async function dragTo(page: Page, from: Locator, x: number, y: number) {
	const box = (await from.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(x, y, { steps: 12 });
	await page.mouse.up();
}

const centre = async (l: Locator) => {
	const b = (await l.boundingBox())!;
	return [b.x + b.width / 2, b.y + b.height / 2] as const;
};

test('rearrange: swap two people, move a team on the plan, move a person by clicks', async ({ browser }) => {
	const mgrContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
	const mgr = await mgrContext.newPage();
	const api = mgr.request;
	await mgr.goto('/login');
	await mgr.getByLabel('Email').fill(ADMIN.email);
	await mgr.getByLabel('Password').fill(ADMIN.password);
	await mgr.getByRole('button', { name: 'Sign in' }).click();
	await expect(mgr).toHaveURL(/\/manage/);

	const post = async (path: string, data: unknown) => (await api.post(`${API_URL}${path}`, { data })).json();
	const { event } = await post('/api/events', { name: EVENT_NAME });
	await api.patch(`${API_URL}/api/events/${event.id}`, { data: { status: 'open' } });
	const { invite } = await post(`/api/events/${event.id}/invites`, {});
	await api.put(`${API_URL}/api/events/${event.id}/blueprint`, {
		data: {
			version: 0,
			blueprint: {
				schemaVersion: 1,
				canvas: { w: 1000, h: 1000 },
				outlines: [],
				segments: [segment('hall', 'Hall', 50, 4), segment('lab', 'Lab', 550, 8)],
				titleBlock: { project: EVENT_NAME, date: '2026-11-23', rev: 'A' }
			}
		}
	});
	const snapshot = async () => (await (await api.get(`${API_URL}/api/e/${event.slug}/live`)).json()) as Snapshot;

	const phones = [];
	for (const name of NAMES) {
		const context = await browser.newContext({ ...devices['Pixel 7'] });
		const page = await context.newPage();
		const { code } = await (await api.get(`${API_URL}/api/invites/${invite.id}/code`)).json();
		await page.goto(`/join/${invite.token}?c=${code}`);
		await page.getByPlaceholder('How your team will see you').fill(name);
		await page.getByRole('button', { name: 'Join' }).click();
		await expect(page.getByRole('heading', { name: 'You’re in' })).toBeVisible();
		phones.push({ name, page });
	}
	expect((await api.post(`${API_URL}/api/events/${event.id}/launch`, { data: { teamSize: 2, durationMin: 60, seed: 5 } })).status()).toBe(200);

	await mgr.goto(`/manage/${event.id}`);
	await mgr.getByRole('link', { name: 'Rearrange teams' }).click();
	await expect(mgr.getByRole('heading', { name: 'Rearrange teams' })).toBeVisible();

	const before = await snapshot();
	const [t1, t2] = before.teams as [Snapshot['teams'][0], Snapshot['teams'][0]];
	const mover = t1.members[0]!.displayName;
	const moverPhone = phones.find((p) => p.name === mover)!.page;
	const teamCard = (id: string) => mgr.locator(`[data-drop-team="${id}"]`);

	const chip = (teamId: string, name: string) => teamCard(teamId).getByRole('button', { name: new RegExp(`^${name}`) });
	const membersOf = async (teamId: string) => (await snapshot()).teams.find((t) => t.id === teamId)!.members.map((m) => m.displayName);
	const partner = t2.members[0]!.displayName;

	await test.step('drag a person onto someone in the other team: they swap (the hall is full)', async () => {
		expect(before.teams.every((t) => t.segmentId === 'hall')).toBe(true);
		const [x, y] = await centre(chip(t2.id, partner));
		await dragTo(mgr, chip(t1.id, mover), x, y);
		await expect(chip(t2.id, mover)).toBeVisible();
		await expect(chip(t1.id, partner)).toBeVisible();
		await expect.poll(() => membersOf(t2.id)).toContain(mover);
		// The mover's phone lists their new teammate.
		const mate = t2.members[1]!.displayName;
		await expect(moverPhone.getByText(mate, { exact: true }).first()).toBeVisible();
	});

	await test.step('drag a team onto the empty lab on the plan', async () => {
		const plan = mgr.getByRole('img', { name: /^Blueprint/ });
		const [x, y] = await centre(plan.locator('[data-segment-id="lab"] polygon').last());
		await dragTo(mgr, teamCard(t1.id).getByRole('button', { name: /^Move team/ }), x, y);
		await expect.poll(async () => (await snapshot()).teams.find((t) => t.id === t1.id)!.segmentId).toBe('lab');
		await expect(mgr.locator(`[data-drop-segment="lab"] [data-drop-team="${t1.id}"]`)).toBeVisible();
	});

	await test.step('click a person, then click a team: they join it', async () => {
		await chip(t1.id, partner).click();
		await teamCard(t2.id).getByText(t2.name, { exact: true }).last().click();
		await expect.poll(() => membersOf(t2.id)).toContain(partner);
		await expect(chip(t2.id, partner)).toBeVisible();
	});
});
