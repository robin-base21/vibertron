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
let lastAiBody: any = null;
beforeAll(async () => {
	srv = await bootTestServer({
		env: { openrouterApiKey: 'sk-test' },
		fetch: (async (_url: string, init: RequestInit) => {
			aiCalls++;
			lastAiBody = JSON.parse(String(init.body));
			if (lastAiBody.response_format.json_schema.name === 'floorplan_rooms') {
				const rooms = [{ index: 1, name: 'Main Hall', kind: 'work', confidence: 0.8, zones: [] }];
				return Response.json({ choices: [{ message: { content: JSON.stringify({ rooms, extraZones: [] }) } }] });
			}
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
	expect(r.body.blueprint.canvas).toEqual({ w: 1000, h: 1000 });
	const wide = await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { imageRef, candidates, canvas: { w: 1000, h: 625 } });
	expect(wide.status).toBe(200);
	expect(wide.body.blueprint.canvas).toEqual({ w: 1000, h: 625 });
	expect((await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { imageRef, candidates, canvas: { w: 0, h: 5 } })).status).toBe(400);
	expect((await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { imageRef: 'f'.repeat(32), candidates })).status).toBe(404);
});

test('analyze v2: marked image goes to the model, original stays the underlay', async () => {
	const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
	const { imageRef } = (await mgr.post(`/api/events/${eventId}/uploads`, upload(PNG))).body;
	const markedImageRef = (await mgr.post(`/api/events/${eventId}/uploads`, upload(JPEG, 'image/jpeg'))).body.imageRef;
	const body = {
		imageRef,
		markedImageRef,
		crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.6 },
		canvas: { w: 1000, h: 750 },
		rooms: [{ shape: 'rect', points: [[100, 100], [500, 400]] }],
		walls: [[[100, 100], [500, 100]]]
	};
	const r = await mgr.post(`/api/events/${eventId}/blueprint/analyze`, body);
	expect(r.status).toBe(200);
	expect(r.body.source).toBe('ai');
	const img = lastAiBody.messages[1].content[1].image_url.url;
	expect(img).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
	expect(lastAiBody.messages[1].content[0].text).toContain('1: box');
	const bp = r.body.blueprint;
	expect(bp.underlay).toEqual({ imageRef, opacity: 0.35, crop: body.crop });
	expect(bp.walls).toEqual([{ id: 'w1', a: [100, 100], b: [500, 100] }]);
	expect(bp.segments[0]).toMatchObject({ name: 'Main Hall', shape: 'rect', points: [[100, 100], [500, 400]], stations: { count: 0, confirmed: false } });

	// markedImageRef is validated like imageRef
	expect((await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { ...body, markedImageRef: 'nope' })).status).toBe(400);
	expect((await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { ...body, markedImageRef: 'e'.repeat(32) })).status).toBe(404);
	const other = (await mgr.post('/api/events', { name: 'Other Plan' })).body.event;
	const foreign = (await mgr.post(`/api/events/${other.id}/uploads`, upload(JPEG, 'image/jpeg'))).body.imageRef;
	expect((await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { ...body, markedImageRef: foreign })).status).toBe(404);

	// without a marked image the original is sent
	await mgr.post(`/api/events/${eventId}/blueprint/analyze`, { ...body, markedImageRef: undefined });
	expect(lastAiBody.messages[1].content[1].image_url.url).toStartWith('data:image/png;base64,');
});

test('blueprint library: own events only, excludes the current one, skips blank plans', async () => {
	const seg = { id: 's1', name: 'Hall', shape: 'rect' as const, points: [[0, 0], [100, 100]] as [number, number][], labelPos: [50, 50] as [number, number], stations: { count: 8, layout: 'grid' as const, confirmed: true } };
	const ref = (await mgr.post(`/api/events/${eventId}/uploads`, upload(PNG))).body.imageRef;
	const venue = { ...emptyBlueprint('Venue', '2026-10-24'), segments: [seg], underlay: { imageRef: ref, opacity: 0.4 } };
	const past = (await mgr.post('/api/events', { name: 'Past Event' })).body.event;
	expect((await mgr.put(`/api/events/${past.id}/blueprint`, { blueprint: venue, version: 0 })).status).toBe(200);
	const blank = (await mgr.post('/api/events', { name: 'Blank Event' })).body.event;
	await mgr.put(`/api/events/${blank.id}/blueprint`, { blueprint: emptyBlueprint(), version: 0 });

	// Another manager's plan is never offered.
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'other@test.dev', password: 'manager-pw', displayName: 'Other', role: 'manager' });
	const other = srv.client();
	await other.login('other@test.dev', 'manager-pw');
	const theirs = (await other.post('/api/events', { name: 'Their Event' })).body.event;
	await other.put(`/api/events/${theirs.id}/blueprint`, { blueprint: venue, version: 0 });

	const lib = await mgr.get(`/api/blueprints/library?exclude=${eventId}`);
	expect(lib.status).toBe(200);
	expect(lib.body.items.map((i: any) => i.eventName)).toEqual(['Past Event']);
	expect(lib.body.items[0].blueprint.segments[0].stations.count).toBe(8);
	expect((await other.get('/api/blueprints/library')).body.items.map((i: any) => i.eventName)).toEqual(['Their Event']);
	// Admins see every manager's plans.
	expect((await admin.get('/api/blueprints/library')).body.items.length).toBe(2);
	expect((await srv.client().get('/api/blueprints/library')).status).toBe(401);

	// Reusing: the copied plan saves into the new event and its underlay still loads.
	const reused = { ...lib.body.items[0].blueprint, titleBlock: { project: 'Plan Event', date: '2026-10-26', rev: 'A' } };
	const v = (await mgr.get(`/api/events/${eventId}/blueprint`)).body.version;
	expect((await mgr.put(`/api/events/${eventId}/blueprint`, { blueprint: reused, version: v })).status).toBe(200);
	expect((await fetch(`${srv.url}/api/uploads/${ref}`)).status).toBe(200);
});
