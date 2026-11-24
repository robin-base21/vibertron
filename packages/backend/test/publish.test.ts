import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PUBLISH_SIGNATURE_HEADER, PublishPayload, deckSignatureInput, emptyBlueprint, sha256Hex, verifyPayload, type EventDTO } from 'common';
import { ADMIN, bootTestServer, type Client } from './helpers';

const SECRET = 'publish-test-secret';
let srv: Awaited<ReturnType<typeof bootTestServer>>;
let site: ReturnType<typeof Bun.serve>;
let mgr: Client;
const received: { signature: string | null; payload: string; contentType: string | null }[] = [];
/** Decks as the fake site stored them, after checking their signatures. */
const decks: Record<string, string> = {};
let siteStatus = 200;

beforeAll(async () => {
	// A stand-in for the public site's results endpoint.
	site = Bun.serve({
		port: 0,
		fetch: async (req) => {
			const url = new URL(req.url);
			const signature = req.headers.get(PUBLISH_SIGNATURE_HEADER);
			const deck = /^\/api\/results\/decks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
			if (req.method === 'PUT' && deck) {
				const bytes = new Uint8Array(await req.arrayBuffer());
				const [, eventId, projectId] = deck.map(decodeURIComponent) as [string, string, string];
				const ok = await verifyPayload(SECRET, deckSignatureInput(eventId, projectId, await sha256Hex(bytes)), signature);
				if (!ok) return new Response('bad signature', { status: 401 });
				decks[projectId] = new TextDecoder().decode(bytes);
				return new Response('ok');
			}
			received.push({ signature, payload: await req.text(), contentType: req.headers.get('content-type') });
			return new Response(siteStatus === 200 ? 'ok' : 'nope', { status: siteStatus });
		}
	});
	srv = await bootTestServer({
		autoEndIntervalMs: 600_000,
		env: { sitePublishUrl: `http://localhost:${site.port}/api/results`, sitePublishSecret: SECRET }
	});
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'pub@test.dev', password: 'pub-password', displayName: 'Pub', role: 'manager' });
	mgr = srv.client();
	await mgr.login('pub@test.dev', 'pub-password');
});
afterAll(() => {
	srv.close();
	site.stop(true);
});

test('publish to site: signed push with consented projects only, decks attached', async () => {
	const event = (await mgr.post('/api/events', { name: 'Pub Jam' })).body.event as EventDTO;
	await mgr.patch(`/api/events/${event.id}`, { status: 'open' });
	const invite = (await mgr.post(`/api/events/${event.id}/invites`, {})).body.invite;
	const people: Client[] = [];
	for (const n of ['Ann', 'Bob', 'Cid', 'Dee']) {
		const c = srv.client();
		const code = (await mgr.get(`/api/invites/${invite.id}/code`)).body.code;
		await c.post(`/api/join/${invite.token}`, { code, displayName: n });
		people.push(c);
	}
	const bp = emptyBlueprint('Pub', '2026-11-23');
	bp.segments.push({ id: 'hall', name: 'Hall', shape: 'rect', points: [[0, 0], [400, 400]], labelPos: [200, 200], stations: { count: 4, layout: 'grid', confirmed: true } });
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: bp, version: 0 });
	await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 2, durationMin: 60, seed: 9 });
	const slug = event.slug;
	const [ann, bob, cid, dee] = people as [Client, Client, Client, Client];

	// Ann: public with link + slides. Bob: private. Cid: public, chosen later. Dee: never chose.
	await ann.put(`/api/e/${slug}/project`, { name: 'Ann App', link: 'https://ann.dev', showcase: true });
	const form = new FormData();
	form.append('file', new Blob(['%PDF-1.4 ann slides'], { type: 'application/pdf' }), 'a.pdf');
	await ann.req('PUT', `/api/e/${slug}/project/deck`, form);
	await bob.put(`/api/e/${slug}/project`, { name: 'Bob Bot', showcase: false });
	await cid.put(`/api/e/${slug}/project`, { name: 'Cid Kit' });
	expect((await cid.put(`/api/e/${slug}/project/showcase`, { showcase: true })).body.project.showcase).toBe(true);
	await dee.put(`/api/e/${slug}/project`, { name: 'Dee Doc' });

	// Not before the winner is revealed.
	expect((await mgr.post(`/api/events/${event.id}/publish`)).status).toBe(409);
	for (const a of ['start', 'close-group', 'close-pitch']) expect((await mgr.post(`/api/events/${event.id}/voting`, { action: a })).status).toBe(200);
	// Attendees can't publish.
	expect((await ann.post(`/api/events/${event.id}/publish`)).status).toBe(403);

	const res = await mgr.post(`/api/events/${event.id}/publish`);
	expect(res.status).toBe(200);
	expect(res.body.event.publishedToSiteAt).toBeGreaterThan(0);

	const push = received.at(-1)!;
	expect(push.contentType).toBe('application/json');
	expect(await verifyPayload(SECRET, push.payload, push.signature)).toBe(true);
	const payload = PublishPayload.parse(JSON.parse(push.payload));
	expect(payload.event).toMatchObject({ id: event.id, slug, name: 'Pub Jam', participantCount: 4, teamCount: 2 });
	expect(payload.projects.map((p) => p.name).sort()).toEqual(['Ann App', 'Cid Kit']);
	const annP = payload.projects.find((p) => p.name === 'Ann App')!;
	expect(annP).toMatchObject({ author: 'Ann', link: 'https://ann.dev', hasDeck: true });
	expect(decks[annP.id]).toBe('%PDF-1.4 ann slides');
	// Two pitches (one per team); a private pitch appears without its project.
	expect(payload.ranking).toHaveLength(2);
	const shownIds = new Set(payload.projects.map((p) => p.id));
	for (const r of payload.ranking) expect(r.projectId === null || shownIds.has(r.projectId)).toBe(true);
	expect(JSON.stringify(payload)).not.toContain('Bob');

	// A failing site surfaces as 502 and leaves the timestamp alone.
	siteStatus = 500;
	const failed = await mgr.post(`/api/events/${event.id}/publish`);
	expect(failed.status).toBe(502);
	expect(failed.body.message).toContain('500');
	siteStatus = 200;
});
