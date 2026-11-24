import { afterAll, beforeAll, expect, test } from 'bun:test';
import { emptyBlueprint, type AttendeeContextDTO, type LiveSnapshotDTO, type ProjectDTO } from 'common';
import { ADMIN, bootTestServer, type Client } from './helpers';

let srv: Awaited<ReturnType<typeof bootTestServer>>;
let mgr: Client;

beforeAll(async () => {
	srv = await bootTestServer({ autoEndIntervalMs: 600_000 });
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'subs@test.dev', password: 'subs-password', displayName: 'Subs', role: 'manager' });
	mgr = srv.client();
	await mgr.login('subs@test.dev', 'subs-password');
});
afterAll(() => srv.close());

const pdf = (text: string) => {
	const form = new FormData();
	form.append('file', new Blob([`%PDF-1.4\n% ${text}\n%%EOF\n`], { type: 'application/pdf' }), 'deck.pdf');
	return form;
};

test('submissions: link + PDF, private until voting, PDF open until the pitch round', async () => {
	const event = (await mgr.post('/api/events', { name: 'Submit Jam' })).body.event;
	await mgr.patch(`/api/events/${event.id}`, { status: 'open' });
	const invite = (await mgr.post(`/api/events/${event.id}/invites`, {})).body.invite;
	const people: Client[] = [];
	for (const n of ['A', 'B', 'C', 'D']) {
		const c = srv.client();
		const code = (await mgr.get(`/api/invites/${invite.id}/code`)).body.code;
		await c.post(`/api/join/${invite.token}`, { code, displayName: n });
		people.push(c);
	}
	const bp = emptyBlueprint('Submit', '2026-11-23');
	bp.segments.push({
		id: 'hall',
		name: 'Hall',
		shape: 'rect',
		points: [
			[0, 0],
			[400, 400]
		],
		labelPos: [200, 200],
		stations: { count: 4, layout: 'grid', confirmed: true }
	});
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: bp, version: 0 });
	await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 2, durationMin: 60, seed: 1 });
	const slug = event.slug;
	const [a, b, c, d] = people as [Client, Client, Client, Client];
	const anon = srv.client();
	const snapshot = async (c: Client = anon) => (await c.get(`/api/e/${slug}/live`)).body as LiveSnapshotDTO;
	const own = async (c: Client) => ((await c.get(`/api/e/${slug}/me`)).body as AttendeeContextDTO).project!;

	// A PDF needs a project first; links must be http(s).
	expect((await a.req('PUT', `/api/e/${slug}/project/deck`, pdf('early'))).status).toBe(409);
	expect((await a.put(`/api/e/${slug}/project`, { name: 'Alpha', link: 'javascript:alert(1)' })).status).toBe(400);
	expect((await a.put(`/api/e/${slug}/project`, { name: 'Alpha', link: 'https://alpha.dev' })).status).toBe(200);
	// Every team gets two projects, so the team round really opens when voting starts.
	for (const [who, name] of [[b, 'Bravo'], [c, 'Charlie'], [d, 'Delta']] as const) await who.put(`/api/e/${slug}/project`, { name });

	// Only real PDFs are accepted.
	const notPdf = new FormData();
	notPdf.append('file', new Blob(['<html>hi</html>'], { type: 'application/pdf' }), 'evil.pdf');
	expect((await a.req('PUT', `/api/e/${slug}/project/deck`, notPdf)).status).toBe(415);
	const up = await a.req('PUT', `/api/e/${slug}/project/deck`, pdf('v1'));
	expect(up.status).toBe(200);
	const project = up.body.project as ProjectDTO;
	expect(project.deckSize).toBeGreaterThan(0);

	// Before voting: the author and managers see the submission, everyone else does not.
	expect(await own(a)).toMatchObject({ link: 'https://alpha.dev', deckSize: project.deckSize });
	expect((await snapshot()).projects!.find((p) => p.id === project.id)).toMatchObject({ link: null, deckSize: null });
	expect((await snapshot(mgr)).projects!.find((p) => p.id === project.id)).toMatchObject({ link: 'https://alpha.dev' });
	const deckUrl = `/api/projects/${project.id}/deck`;
	expect((await anon.get(deckUrl)).status).toBe(404);
	expect((await b.get(deckUrl)).status).toBe(404);
	const mine = await a.get(deckUrl);
	expect(mine.status).toBe(200);
	expect(mine.res.headers.get('content-type')).toBe('application/pdf');
	expect(mine.res.headers.get('content-security-policy')).toBe('sandbox');
	expect((await mgr.get(deckUrl)).status).toBe(200);

	// Voting starts: everyone sees it, the link locks, the PDF can still be replaced.
	expect((await mgr.post(`/api/events/${event.id}/voting`, { action: 'start' })).status).toBe(200);
	expect((await snapshot()).projects!.find((p) => p.id === project.id)).toMatchObject({ link: 'https://alpha.dev', deckSize: project.deckSize });
	expect((await anon.get(deckUrl)).status).toBe(200);
	expect((await a.put(`/api/e/${slug}/project`, { name: 'Alpha', link: 'https://other.dev' })).status).toBe(409);
	const v2 = await a.req('PUT', `/api/e/${slug}/project/deck`, pdf('version two, longer'));
	expect(v2.status).toBe(200);
	expect(v2.body.project.deckSize).not.toBe(project.deckSize);
	expect(new TextDecoder().decode((await anon.get(deckUrl)).body)).toContain('version two');

	// The pitch round closes the PDF too.
	expect((await mgr.post(`/api/events/${event.id}/voting`, { action: 'close-group' })).status).toBe(200);
	expect((await a.req('PUT', `/api/e/${slug}/project/deck`, pdf('late'))).status).toBe(409);
	expect((await a.del(`/api/e/${slug}/project/deck`)).status).toBe(409);

	// Reset hides submissions again; removing the PDF works once it is open.
	expect((await mgr.post(`/api/events/${event.id}/voting`, { action: 'reset' })).status).toBe(200);
	expect((await snapshot()).projects!.find((p) => p.id === project.id)).toMatchObject({ link: null, deckSize: null });
	expect((await anon.get(deckUrl)).status).toBe(404);
	expect((await a.del(`/api/e/${slug}/project/deck`)).body.project.deckSize).toBeNull();
	expect((await a.get(deckUrl)).status).toBe(404);
});
