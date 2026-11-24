import { devices, expect, test, type Browser } from '@playwright/test';
import { ADMIN, API_URL } from '../env';

// Late arrivals after launch: a phone joins, waits, names a friend; the manager sees the friend's
// team suggested and lets them in; the phone switches to its workstation. A second one is turned away.

const EVENT_NAME = `E2E Late ${Date.now().toString(36)}`;

interface Participant {
	id: string;
	displayName: string;
	friendCode: string;
	teamId: string | null;
}

async function phone(browser: Browser) {
	const context = await browser.newContext({ ...devices['Pixel 7'] });
	return context.newPage();
}

test('late arrival: waits, gets suggested into a friend’s team, is let in; another is turned away', async ({ browser }) => {
	const mgrContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
	const mgr = await mgrContext.newPage();
	mgr.on('dialog', (d) => d.accept());
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
				segments: [
					{
						id: 'hall',
						name: 'Hall',
						shape: 'rect',
						points: [
							[100, 100],
							[900, 600]
						],
						labelPos: [500, 350],
						stations: { count: 8, layout: 'grid', confirmed: true }
					}
				],
				titleBlock: { project: EVENT_NAME, date: '2026-11-23', rev: 'A' }
			}
		}
	});
	const joinAs = async (name: string) => {
		const page = await phone(browser);
		const { code } = await (await api.get(`${API_URL}/api/invites/${invite.id}/code`)).json();
		await page.goto(`/join/${invite.token}?c=${code}`);
		await page.getByPlaceholder('How your team will see you').fill(name);
		await page.getByRole('button', { name: 'Join' }).click();
		return page;
	};
	for (const n of ['Ann', 'Ben', 'Cat', 'Dan']) await expect((await joinAs(n)).getByRole('heading', { name: 'You’re in' })).toBeVisible();
	expect((await api.post(`${API_URL}/api/events/${event.id}/launch`, { data: { teamSize: 2, durationMin: 60, seed: 4 } })).status()).toBe(200);
	const participants = async () =>
		((await (await api.get(`${API_URL}/api/events/${event.id}/participants`)).json()) as { participants: Participant[] }).participants;
	const cat = (await participants()).find((p) => p.displayName === 'Cat')!;

	await mgr.goto(`/manage/${event.id}`);
	const late = mgr.getByRole('region', { name: 'Late arrivals' });
	await expect(late).toHaveCount(0);

	await test.step('a late phone joins and waits, naming Cat as a friend', async () => {
		const eve = await joinAs('Eve');
		await expect(eve.getByRole('heading', { name: 'Almost in' })).toBeVisible();
		await eve.getByLabel('Friend code').fill(cat.friendCode);
		await eve.getByRole('button', { name: 'Add' }).click();
		await expect(eve.getByText('The organiser will see you came with')).toBeVisible();

		await expect(late.getByText('Eve', { exact: true })).toBeVisible();
		await expect(late.getByText('came with Cat')).toBeVisible();
		// Cat's team is suggested.
		await expect(late.getByRole('combobox', { name: 'Team for Eve' })).toHaveValue(cat.teamId!);

		await late.getByRole('button', { name: 'Let in' }).click();
		await expect(eve.getByText('Your workstation')).toBeVisible();
		await expect(eve.getByText(/You’re with .*Cat/)).toBeVisible();
		await expect(late).toHaveCount(0);
		expect((await participants()).find((p) => p.displayName === 'Eve')!.teamId).toBe(cat.teamId);
	});

	await test.step('another late phone is turned away', async () => {
		const zed = await joinAs('Zed');
		await expect(zed.getByRole('heading', { name: 'Almost in' })).toBeVisible();
		await late.getByRole('button', { name: 'Turn away' }).click();
		await expect(zed.getByRole('heading', { name: 'Not this time' })).toBeVisible();
		await expect(mgr.getByRole('cell', { name: 'Turned away' })).toBeVisible();
	});
});
