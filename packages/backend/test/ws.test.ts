import { afterAll, beforeAll, expect, test } from 'bun:test';
import { ADMIN, bootTestServer, connectWS, type Client } from './helpers';

let srv: Awaited<ReturnType<typeof bootTestServer>>;
let mgr: Client;
let eventId = '';
let slug = '';
let inviteId = '';
let token = '';

beforeAll(async () => {
	srv = await bootTestServer();
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'mgr@test.dev', password: 'manager-pw', displayName: 'Mgr', role: 'manager' });
	mgr = srv.client();
	await mgr.login('mgr@test.dev', 'manager-pw');
	const ev = (await mgr.post('/api/events', { name: 'WS Party' })).body.event;
	eventId = ev.id;
	slug = ev.slug;
	await mgr.patch(`/api/events/${eventId}`, { status: 'open' });
	const inv = (await mgr.post(`/api/events/${eventId}/invites`, {})).body.invite;
	inviteId = inv.id;
	token = inv.token;
});
afterAll(() => srv.close());

const join = async (name: string) => {
	const c = srv.client();
	const code = (await mgr.get(`/api/invites/${inviteId}/code`)).body.code;
	const r = await c.post(`/api/join/${token}`, { code, displayName: name });
	return { c, p: r.body.participant };
};

test('ping, invalid messages, unknown event', async () => {
	const ws = await connectWS(srv.url);
	ws.send({ type: 'ping' });
	expect((await ws.next('pong')).serverTime).toBeNumber();
	ws.ws.send('nonsense');
	expect((await ws.next('error')).message).toBe('Invalid JSON');
	ws.send({ type: 'subscribe', slug: 'nope', scope: 'public' });
	expect((await ws.next('error')).message).toContain('not found');
	ws.close();
});

test('public vs manage subscriptions and participant broadcasts', async () => {
	const viewer = await connectWS(srv.url);
	viewer.send({ type: 'subscribe', slug, scope: 'manage' });
	expect((await viewer.next('error')).message).toContain('Not allowed');
	viewer.send({ type: 'subscribe', slug, scope: 'public' });
	const sub = await viewer.next('subscribed');
	expect(sub.snapshot.event.slug).toBe(slug);
	expect(sub.snapshot.participantCount).toBe(0);

	const manager = await connectWS(srv.url, mgr.cookie);
	manager.send({ type: 'subscribe', slug, scope: 'manage' });
	expect((await manager.next('subscribed')).scope).toBe('manage');

	await join('Alice');
	expect((await viewer.next('participants.count')).count).toBe(1);
	expect((await manager.next('participants.updated')).participants[0].displayName).toBe('Alice');
	expect((await manager.next('participants.count')).count).toBe(1);
	expect(viewer.messages.find((m) => m.type === 'participants.updated')).toBeUndefined();

	await mgr.patch(`/api/events/${eventId}`, { name: 'WS Party 2' });
	expect((await viewer.next('event.updated')).event.name).toBe('WS Party 2');
	expect((await manager.next('event.manage.updated')).event.participantCount).toBe(1);

	viewer.send({ type: 'unsubscribe', slug });
	await join('Bob');
	await manager.next('participants.count');
	await Bun.sleep(50);
	expect(viewer.messages.find((m) => m.type === 'participants.count')).toBeUndefined();
	viewer.close();
	manager.close();
});

test('pairing.updated goes to both users', async () => {
	const x = await join('Xena');
	const y = await join('Yuri');
	const wx = await connectWS(srv.url, x.c.cookie);
	const wy = await connectWS(srv.url, y.c.cookie);
	const r = await x.c.post(`/api/e/${slug}/pairings`, { friendCode: y.p.friendCode });
	expect((await wx.next('pairing.updated')).pairing.id).toBe(r.body.pairing.id);
	expect((await wy.next('pairing.updated')).pairing.accepted).toBe(false);
	await y.c.post(`/api/pairings/${r.body.pairing.id}/accept`);
	expect((await wx.next('pairing.updated')).pairing.accepted).toBe(true);
	await wy.next('pairing.updated');
	await x.c.del(`/api/pairings/${r.body.pairing.id}`);
	expect((await wy.next('pairing.updated')).removed).toBe(true);
	wx.close();
	wy.close();
});
