import { afterAll, beforeAll, expect, test } from 'bun:test';
import { emptyBlueprint } from 'common';
import { ADMIN, bootTestServer, connectWS, type Client } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const upload = (bytes: Uint8Array, type = 'image/png') => {
	const fd = new FormData();
	fd.append('file', new Blob([bytes], { type }), 'plan.png');
	return fd;
};

let srv: Awaited<ReturnType<typeof bootTestServer>>;
let mgr: Client;
let eventId = '';
let slug = '';
let aiCalls = 0;
beforeAll(async () => {
	srv = await bootTestServer({
		env: { openrouterApiKey: 'sk-test' },
		fetch: (async () => {
			aiCalls++;
			const areas = [{ polygonIndex: 0, name: 'Main Hall', isWorkArea: true, suggestedStations: 10, confidence: 0.8, rect: null }];
			return Response.json({ choices: [{ message: { content: JSON.stringify({ areas }) } }] });
		}) as unknown as typeof fetch
	});
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'mgr@test.dev', password: 'manager-pw', displayName: 'Mgr', role: 'manager' });
	mgr = srv.client();
	await mgr.login('mgr@test.dev', 'manager-pw');
	const ev = (await mgr.post('/api/events', { name: 'Plan Event' })).body.event;
	eventId = ev.id;
	slug = ev.slug;
});
afterAll(() => srv.close());

test('blueprint save with optimistic versioning + broadcast', async () => {
	expect((await mgr.get(`/api/events/${eventId}/blueprint`)).body).toEqual({ blueprint: null, version: 0 });
	const ws = await connectWS(srv.url);
	ws.send({ type: 'subscribe', slug, scope: 'public' });
	await ws.next('subscribed');

	const bp = emptyBlueprint('Plan Event', '2026-10-24');
	expect((await mgr.put(`/api/events/${eventId}/blueprint`, { blueprint: bp, version: 0 })).body).toEqual({ version: 1 });
	expect((await ws.next('blueprint.updated')).blueprint.titleBlock.project).toBe('Plan Event');
	const stale = await mgr.put(`/api/events/${eventId}/blueprint`, { blueprint: bp, version: 0 });
	expect(stale.status).toBe(409);
	expect(stale.body.details).toEqual({ version: 1 });
	expect((await mgr.put(`/api/events/${eventId}/blueprint`, { blueprint: { ...bp, schemaVersion: 2 }, version: 1 })).status).toBe(400);
	expect((await mgr.put(`/api/events/${eventId}/blueprint`, { blueprint: bp, version: 1 })).body.version).toBe(2);
	expect((await mgr.get(`/api/events/${eventId}/blueprint`)).body.version).toBe(2);
	ws.close();
});

test('uploads: images only, served with content type', async () => {
	const r = await mgr.post(`/api/events/${eventId}/uploads`, upload(PNG));
	expect(r.status).toBe(201);
	expect(r.body.imageRef).toMatch(/^[0-9a-f]{32}$/);
	const img = await fetch(`${srv.url}/api/uploads/${r.body.imageRef}`);
	expect(img.headers.get('content-type')).toBe('image/png');
	expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);

	expect((await mgr.post(`/api/events/${eventId}/uploads`, upload(new TextEncoder().encode('<svg/>'), 'image/png'))).status).toBe(415);
	expect((await mgr.post(`/api/events/${eventId}/uploads`, upload(new Uint8Array(15 * 1024 * 1024 + 10)))).status).toBe(413);
	expect((await fetch(`${srv.url}/api/uploads/${'0'.repeat(32)}`)).status).toBe(404);
	expect((await fetch(`${srv.url}/api/uploads/..%2f..%2fetc`)).status).toBe(404);
	expect((await srv.client().post(`/api/events/${eventId}/uploads`, upload(PNG))).status).toBe(401);
});

test('analyze uses AI and returns a draft blueprint', async () => {
	const { imageRef } = (await mgr.post(`/api/events/${eventId}/uploads`, upload(PNG))).body;
	const candidates = [
		[
			[100, 100],
			[500, 100],
			[500, 400],
			[100, 400]
		]
	];
	const r = await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { imageRef, candidates });
	expect(r.status).toBe(200);
	expect(r.body.source).toBe('ai');
	expect(aiCalls).toBe(1);
	expect(r.body.blueprint.segments[0]).toMatchObject({ name: 'Main Hall', stations: { count: 10, confirmed: false } });
	expect(r.body.blueprint.underlay.imageRef).toBe(imageRef);
	expect((await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { imageRef: 'f'.repeat(32), candidates })).status).toBe(404);
});
