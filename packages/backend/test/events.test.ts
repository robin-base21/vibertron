import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { joinCodeWindow } from 'common';
import { eq } from 'drizzle-orm';
import { events } from '../src/db/schema';
import { joinCodeFor, verifyJoinCode } from '../src/joinCode';
import { slugify } from '../src/routes/events';
import { ADMIN, bootTestServer, type Client } from './helpers';

let srv: Awaited<ReturnType<typeof bootTestServer>>;
let mgr: Client;
beforeAll(async () => {
	srv = await bootTestServer();
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'mgr@test.dev', password: 'manager-pw', displayName: 'Mgr', role: 'manager' });
	await admin.post('/api/admin/users', { email: 'other@test.dev', password: 'manager-pw', displayName: 'Other', role: 'manager' });
	mgr = srv.client();
	await mgr.login('mgr@test.dev', 'manager-pw');
});
afterAll(() => srv.close());

describe('join codes', () => {
	test('current and previous window accepted, older rejected', () => {
		const secret = 's3cret';
		const now = 1_700_000_000_000;
		const w = joinCodeWindow(now);
		expect(joinCodeFor(secret, w)).toMatch(/^[A-Z2-9]{6}$/);
		expect(verifyJoinCode(secret, joinCodeFor(secret, w), now)).toBe(true);
		expect(verifyJoinCode(secret, joinCodeFor(secret, w - 1).toLowerCase(), now)).toBe(true);
		expect(verifyJoinCode(secret, joinCodeFor(secret, w - 2), now)).toBe(false);
		expect(verifyJoinCode('other', joinCodeFor(secret, w), now)).toBe(false);
	});

	test('slugify', () => {
		expect(slugify('Vibeathon #3 — Zürich!')).toBe('vibeathon-3-zurich');
		expect(slugify('A')).toBe('event-a');
	});
});

describe('events, invites, join, pairings', () => {
	let eventId = '';
	let slug = '';
	let token = '';
	let inviteId = '';

	test('event CRUD and ownership', async () => {
		const a = await mgr.post('/api/events', { name: 'Vibe Night' });
		expect(a.status).toBe(201);
		expect(a.body.event.slug).toBe('vibe-night');
		expect(a.body.event.status).toBe('draft');
		const b = await mgr.post('/api/events', { name: 'Vibe Night' });
		expect(b.body.event.slug).toBe('vibe-night-2');
		expect((await mgr.post('/api/events', { name: 'X', slug: 'vibe-night' })).status).toBe(409);
		eventId = a.body.event.id;
		slug = a.body.event.slug;

		const other = srv.client();
		await other.login('other@test.dev', 'manager-pw');
		expect((await other.get(`/api/events/${eventId}`)).status).toBe(403);
		expect((await other.get('/api/events')).body.events).toHaveLength(0);
		const admin = srv.client();
		await admin.login(ADMIN.email, ADMIN.password);
		expect((await admin.get('/api/events')).body.events).toHaveLength(2);

		expect((await mgr.del(`/api/events/${b.body.event.id}`)).status).toBe(200);
		expect((await mgr.get('/api/events')).body.events).toHaveLength(1);
		expect((await mgr.patch(`/api/events/${eventId}`, { status: 'live' })).status).toBe(400);
	});

	test('invites and rotating code', async () => {
		const inv = await mgr.post(`/api/events/${eventId}/invites`, {});
		expect(inv.status).toBe(201);
		token = inv.body.invite.token;
		inviteId = inv.body.invite.id;
		const code = await mgr.get(`/api/invites/${inviteId}/code`);
		expect(code.body.code).toHaveLength(6);
		expect(code.body.joinPath).toBe(`/join/${token}?c=${code.body.code}`);
		expect(code.body.windowMs).toBe(30_000);
		expect((await srv.client().get(`/api/invites/${inviteId}/code`)).status).toBe(401);
		expect((await mgr.get(`/api/events/${eventId}/invites`)).body.invites).toHaveLength(1);
	});

	const code = async () => (await mgr.get(`/api/invites/${inviteId}/code`)).body.code as string;

	test('join flow', async () => {
		const pub = await srv.client().get(`/api/join/${token}`);
		expect(pub.body.event.name).toBe('Vibe Night');
		expect((await srv.client().get('/api/join/nope')).status).toBe(404);

		const alice = srv.client();
		// draft events are not joinable
		expect((await alice.post(`/api/join/${token}`, { code: await code(), displayName: 'Alice' })).status).toBe(409);
		await mgr.patch(`/api/events/${eventId}`, { status: 'open' });
		expect((await alice.post(`/api/join/${token}`, { code: 'ZZZZZZ', displayName: 'Alice' })).status).toBe(403);
		const j = await alice.post(`/api/join/${token}`, { code: await code(), displayName: 'Alice' });
		expect(j.status).toBe(201);
		expect(j.body.user.role).toBe('attendee');
		expect(j.body.participant.friendCode).toMatch(/^[A-Z2-9]{6}$/);
		expect(alice.cookie).toContain('vt_session=');
		// idempotent
		const again = await alice.post(`/api/join/${token}`, { code: 'ZZZZZZ', displayName: 'Alice' });
		expect(again.status).toBe(200);
		expect(again.body.participant.id).toBe(j.body.participant.id);
		const me = await alice.get('/api/auth/me');
		expect(me.body.participations).toEqual([{ eventId, slug, participantId: j.body.participant.id }]);

		// manager joining their own event becomes a participant with their own user
		const mj = await mgr.post(`/api/join/${token}`, { code: await code(), displayName: 'ignored' });
		expect(mj.body.user.role).toBe('manager');
		const parts = await mgr.get(`/api/events/${eventId}/participants`);
		expect(parts.body.participants).toHaveLength(2);
		expect((await mgr.get(`/api/events/${eventId}`)).body.event.participantCount).toBe(2);
		expect((await mgr.del(`/api/events/${eventId}/participants/${mj.body.participant.id}`)).status).toBe(200);

		// expired previous-previous window code
		const ev = srv.app.db.select().from(events).where(eq(events.id, eventId)).get()!;
		const old = joinCodeFor(ev.joinSecret, joinCodeWindow() - 3);
		expect((await srv.client().post(`/api/join/${token}`, { code: old, displayName: 'Late' })).status).toBe(403);

		// deactivated invite
		await mgr.patch(`/api/invites/${inviteId}`, { active: false });
		expect((await srv.client().get(`/api/join/${token}`)).status).toBe(410);
		expect((await srv.client().post(`/api/join/${token}`, { code: await code(), displayName: 'Bob' })).status).toBe(410);
		await mgr.patch(`/api/invites/${inviteId}`, { active: true });
	});

	test('pairings', async () => {
		const join = async (name: string) => {
			const c = srv.client();
			const r = await c.post(`/api/join/${token}`, { code: await code(), displayName: name });
			return { c, p: r.body.participant };
		};
		const alice = srv.client();
		const [b, c, d, e] = [await join('Bob'), await join('Cat'), await join('Dan'), await join('Eve')];

		expect((await b.c.post(`/api/e/${slug}/pairings`, { friendCode: b.p.friendCode })).status).toBe(400);
		expect((await b.c.post(`/api/e/${slug}/pairings`, { friendCode: 'QQQQQQ' })).status).toBe(404);
		expect((await alice.post(`/api/e/${slug}/pairings`, { friendCode: c.p.friendCode })).status).toBe(401);

		const p1 = await b.c.post(`/api/e/${slug}/pairings`, { friendCode: c.p.friendCode });
		expect(p1.status).toBe(201);
		expect(p1.body.pairing).toMatchObject({ fromName: 'Bob', toName: 'Cat', accepted: false });
		expect((await c.c.post(`/api/e/${slug}/pairings`, { friendCode: b.p.friendCode })).status).toBe(409);
		expect((await b.c.post(`/api/pairings/${p1.body.pairing.id}/accept`)).status).toBe(403);
		expect((await c.c.post(`/api/pairings/${p1.body.pairing.id}/accept`)).body.pairing.accepted).toBe(true);

		const ctx = await b.c.get(`/api/e/${slug}/me`);
		expect(ctx.body.pairings).toHaveLength(1);
		expect(ctx.body.participant.displayName).toBe('Bob');
		expect(ctx.body.team).toBeNull();

		// group limit 4: B-C + D-E then C-D (=4 ok) then add a fifth → 409
		const p2 = await d.c.post(`/api/e/${slug}/pairings`, { friendCode: e.p.friendCode });
		await e.c.post(`/api/pairings/${p2.body.pairing.id}/accept`);
		const p3 = await c.c.post(`/api/e/${slug}/pairings`, { friendCode: d.p.friendCode });
		expect((await d.c.post(`/api/pairings/${p3.body.pairing.id}/accept`)).status).toBe(200);
		const f = await join('Fay');
		expect((await f.c.post(`/api/e/${slug}/pairings`, { friendCode: b.p.friendCode })).status).toBe(409);

		// either party can cancel
		expect((await e.c.del(`/api/pairings/${p2.body.pairing.id}`)).status).toBe(200);
		expect((await d.c.get(`/api/e/${slug}/me`)).body.pairings).toHaveLength(1);
		expect((await f.c.get('/api/e/nope/me')).status).toBe(404);
	});
});
