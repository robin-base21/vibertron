import { afterAll, beforeAll, expect, test } from 'bun:test';
import { emptyBlueprint, type Blueprint, type LiveSnapshotDTO } from 'common';
import { eq } from 'drizzle-orm';
import { events } from '../src/db/schema';
import { endExpiredEvents } from '../src/routes/launch';
import { ADMIN, bootTestServer, connectWS, type Client } from './helpers';

// End-to-end walk through the whole contract over real HTTP + WS.

let srv: Awaited<ReturnType<typeof bootTestServer>>;
beforeAll(async () => {
	// Auto-end is driven manually below, so keep the background interval out of the way.
	srv = await bootTestServer({ env: { messageRateLimitMs: 500 }, autoEndIntervalMs: 600_000 });
});
afterAll(() => srv.close());

function blueprint(confirmed: boolean): Blueprint {
	return {
		...emptyBlueprint('Flow Jam', '2026-10-24'),
		segments: [
			{
				id: 'hall',
				name: 'Hall',
				shape: 'rect',
				points: [
					[100, 100],
					[400, 300]
				],
				labelPos: [250, 200],
				stations: { count: 4, layout: 'grid', confirmed }
			}
		]
	};
}

test('full flow: seed → login → manager → event → join → pair → blueprint → launch → codename → messages → moderate → snapshot', async () => {
	// admin seeded by bootTestServer
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	expect((await admin.post('/api/admin/users', { email: 'host@test.dev', password: 'host-password', displayName: 'Host', role: 'manager' })).status).toBe(201);
	const mgr = srv.client();
	expect((await mgr.login('host@test.dev', 'host-password')).role).toBe('manager');

	const event = (await mgr.post('/api/events', { name: 'Flow Jam' })).body.event;
	await mgr.patch(`/api/events/${event.id}`, { status: 'open' });
	const invite = (await mgr.post(`/api/events/${event.id}/invites`, {})).body.invite;
	const code = async () => (await mgr.get(`/api/invites/${invite.id}/code`)).body.code as string;

	const tv = await connectWS(srv.url);
	tv.send({ type: 'subscribe', slug: event.slug, scope: 'public' });
	await tv.next('subscribed');
	const mod = await connectWS(srv.url, mgr.cookie);
	mod.send({ type: 'subscribe', slug: event.slug, scope: 'manage' });
	await mod.next('subscribed');

	// three attendees join; one tries a wrong code first
	const people: { c: Client; p: any; name: string }[] = [];
	for (const name of ['Ada', 'Bo', 'Cy']) {
		const c = srv.client();
		if (name === 'Cy') expect((await c.post(`/api/join/${invite.token}`, { code: 'WRONG1', displayName: name })).status).toBe(403);
		const r = await c.post(`/api/join/${invite.token}`, { code: await code(), displayName: name });
		expect(r.status).toBe(201);
		people.push({ c, p: r.body.participant, name });
	}
	const [ada, bo, cy] = people as [(typeof people)[0], (typeof people)[0], (typeof people)[0]];
	expect((await tv.next('participants.count')).count).toBe(1);
	expect((await mgr.get(`/api/events/${event.id}/participants`)).body.participants).toHaveLength(3);

	// Ada and Cy pair up
	const pairing = (await ada.c.post(`/api/e/${event.slug}/pairings`, { friendCode: cy.p.friendCode })).body.pairing;
	expect((await cy.c.post(`/api/pairings/${pairing.id}/accept`)).body.pairing.accepted).toBe(true);

	// blueprint: unconfirmed blocks launch
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: blueprint(false), version: 0 });
	let preview = (await mgr.post(`/api/events/${event.id}/launch/preview`, { teamSize: 2 })).body;
	expect(preview).toMatchObject({ ok: false, participants: 3, teams: 2, stationsAvailable: 4, unconfirmedSegments: ['Hall'] });
	expect((await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 2, durationMin: 60 })).status).toBe(409);
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: blueprint(true), version: 1 });
	preview = (await mgr.post(`/api/events/${event.id}/launch/preview`, { teamSize: 2 })).body;
	expect(preview.ok).toBe(true);
	// a friend group of 2 cannot fit teams of 1
	expect((await mgr.post(`/api/events/${event.id}/launch/preview`, { teamSize: 1 })).body.ok).toBe(false);

	// messages are closed before launch; codename too
	expect((await ada.c.post(`/api/e/${event.slug}/messages`, { body: 'hi' })).status).toBe(409);

	// attendee WS for the personal assignment
	const adaWs = await connectWS(srv.url, ada.c.cookie);

	const launched = await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 2, durationMin: 90, seed: 42 });
	expect(launched.status).toBe(200);
	expect(launched.body.event.status).toBe('live');
	expect(launched.body.event.endsAt - launched.body.event.startedAt).toBe(90 * 60_000);
	expect(launched.body.teams).toHaveLength(2);
	const snap: LiveSnapshotDTO = (await tv.next('launched')).snapshot;
	expect(snap.teams).toHaveLength(2);
	expect((await tv.next('event.updated')).event.status).toBe('live');
	const assignment = await adaWs.next('assignment');
	expect(assignment.team.members.map((m: any) => m.displayName).sort()).toEqual(['Ada', 'Cy']);
	expect(assignment.stationId).toMatch(/^hall-0[1-4]$/);
	expect((await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 2, durationMin: 90 })).status).toBe(409);
	expect((await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: blueprint(true), version: 2 })).status).toBe(409);

	// attendee context now has team + station
	const ctx = (await ada.c.get(`/api/e/${event.slug}/me`)).body;
	expect(ctx.team.id).toBe(assignment.team.id);
	expect(ctx.stationId).toBe(assignment.stationId);
	expect(ctx.participant.teamId).toBe(assignment.team.id);

	// codename required before messages; only members may set it
	expect((await ada.c.post(`/api/e/${event.slug}/messages`, { body: 'hello' })).body.error).toBe('codename_required');
	const boTeam = launched.body.teams.find((t: any) => t.members.some((m: any) => m.displayName === 'Bo'));
	expect((await ada.c.patch(`/api/teams/${boTeam.id}`, { codename: 'Nope' })).status).toBe(403);
	const named = await ada.c.patch(`/api/teams/${ctx.team.id}`, { codename: 'Night Owls' });
	expect(named.body.team.codename).toBe('Night Owls');
	expect((await tv.next('team.updated')).team.codename).toBe('Night Owls');
	expect((await bo.c.patch(`/api/teams/${boTeam.id}`, { codename: 'night owls' })).status).toBe(409);

	// message + rate limit
	const m1 = await ada.c.post(`/api/e/${event.slug}/messages`, { body: 'We are live!' });
	expect(m1.status).toBe(201);
	expect(m1.body.message).toMatchObject({ codename: 'Night Owls', authorName: 'Ada', body: 'We are live!', hidden: false });
	expect((await tv.next('message.created')).message.id).toBe(m1.body.message.id);
	const limited = await ada.c.post(`/api/e/${event.slug}/messages`, { body: 'again' });
	expect(limited.status).toBe(429);
	expect(limited.body.details.retryAfterMs).toBeGreaterThan(0);
	// teammate has their own limit
	expect((await cy.c.post(`/api/e/${event.slug}/messages`, { body: 'me too' })).status).toBe(201);
	expect((await ada.c.post(`/api/e/${event.slug}/messages`, { body: 'x'.repeat(281) })).status).toBe(400);
	await Bun.sleep(550);
	expect((await ada.c.post(`/api/e/${event.slug}/messages`, { body: 'after the wait' })).status).toBe(201);

	// moderation
	expect((await ada.c.patch(`/api/messages/${m1.body.message.id}`, { hidden: true })).status).toBe(403);
	const hidden = await mgr.patch(`/api/messages/${m1.body.message.id}`, { hidden: true });
	expect(hidden.body.message.hidden).toBe(true);
	expect(await tv.next('message.hidden')).toEqual({ type: 'message.hidden', messageId: m1.body.message.id, hidden: true });
	expect((await mod.next('message.manage')).message.hidden).toBe(true);

	// snapshots: public hides the hidden message, the manager sees it
	const pub: LiveSnapshotDTO = (await srv.client().get(`/api/e/${event.slug}/live`)).body;
	expect(pub.messages.map((m) => m.body)).toEqual(['me too', 'after the wait']);
	expect(pub.teams.find((t) => t.id === ctx.team.id)!.codename).toBe('Night Owls');
	expect(pub.participantCount).toBe(3);
	expect(pub.blueprint!.segments[0]!.name).toBe('Hall');
	const priv: LiveSnapshotDTO = (await mgr.get(`/api/e/${event.slug}/live`)).body;
	expect(priv.messages).toHaveLength(3);
	expect((await srv.client().get('/api/e/missing/live')).status).toBe(404);

	// end manually
	const ended = await mgr.post(`/api/events/${event.id}/end`);
	expect(ended.body.event.status).toBe('ended');
	expect((await tv.next('event.updated')).event.status).toBe('ended');
	expect((await mgr.post(`/api/events/${event.id}/end`)).status).toBe(409);
	expect((await cy.c.post(`/api/e/${event.slug}/messages`, { body: 'late' })).status).toBe(409);

	tv.close();
	mod.close();
	adaWs.close();
});

test('auto-end marks live events past endsAt as ended', async () => {
	const mgr = srv.client();
	await mgr.login('host@test.dev', 'host-password');
	const event = (await mgr.post('/api/events', { name: 'Short Jam' })).body.event;
	await mgr.patch(`/api/events/${event.id}`, { status: 'open' });
	const invite = (await mgr.post(`/api/events/${event.id}/invites`, {})).body.invite;
	const code = (await mgr.get(`/api/invites/${invite.id}/code`)).body.code;
	await srv.client().post(`/api/join/${invite.token}`, { code, displayName: 'Solo' });
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: blueprint(true), version: 0 });
	await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 3, durationMin: 1 });

	const tv = await connectWS(srv.url);
	tv.send({ type: 'subscribe', slug: event.slug, scope: 'public' });
	await tv.next('subscribed');
	expect(endExpiredEvents(srv.app)).toBe(0);
	srv.app.db
		.update(events)
		.set({ endsAt: new Date(Date.now() - 1000) })
		.where(eq(events.id, event.id))
		.run();
	expect(endExpiredEvents(srv.app)).toBe(1);
	expect((await tv.next('event.updated')).event.status).toBe('ended');
	tv.close();
});
