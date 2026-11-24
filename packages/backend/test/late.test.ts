import { afterAll, beforeAll, expect, test } from 'bun:test';
import { emptyBlueprint, type AttendeeContextDTO, type LiveSnapshotDTO, type ParticipantDTO, type TeamDTO } from 'common';
import { ADMIN, bootTestServer, connectWS, type Client } from './helpers';

let srv: Awaited<ReturnType<typeof bootTestServer>>;
let admin: Client;
let mgr: Client;

beforeAll(async () => {
	srv = await bootTestServer({ autoEndIntervalMs: 600_000 });
	admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'late@test.dev', password: 'late-password', displayName: 'Late', role: 'manager' });
	mgr = srv.client();
	await mgr.login('late@test.dev', 'late-password');
});
afterAll(() => srv.close());

test('late arrivals wait for a manager or admin, then get a seat', async () => {
	const event = (await mgr.post('/api/events', { name: 'Late Jam' })).body.event;
	await mgr.patch(`/api/events/${event.id}`, { status: 'open' });
	const invite = (await mgr.post(`/api/events/${event.id}/invites`, {})).body.invite;
	const join = async (name: string, c = srv.client()) => {
		const code = (await mgr.get(`/api/invites/${invite.id}/code`)).body.code;
		const r = await c.post(`/api/join/${invite.token}`, { code, displayName: name });
		return { c, r, pid: r.body.participant?.id as string };
	};
	for (const n of ['A', 'B', 'C', 'D']) expect((await join(n)).r.body.participant.status).toBe('active');

	// Hall: 4 seats (filled at launch), Lab: 5 empty seats.
	const bp = emptyBlueprint('Late', '2026-11-23');
	for (const [id, name, count, x] of [['hall', 'Hall', 4, 0], ['lab', 'Lab', 5, 300]] as const) {
		bp.segments.push({ id, name, shape: 'rect', points: [[x, 0], [x + 200, 200]], labelPos: [x + 100, 100], stations: { count, layout: 'grid', confirmed: true } });
	}
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: bp, version: 0 });
	const launched = await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 2, durationMin: 60, seed: 2 });
	const [t1] = launched.body.teams as TeamDTO[];
	const count = async () => ((await srv.client().get(`/api/e/${event.slug}/live`)).body as LiveSnapshotDTO).participantCount;
	expect(await count()).toBe(4);

	// Joining after launch: pending, not counted, no team, can't post.
	const eve = await join('Eve');
	expect(eve.r.status).toBe(201);
	expect(eve.r.body.participant.status).toBe('pending');
	expect(await count()).toBe(4);
	const me = (await eve.c.get(`/api/e/${event.slug}/me`)).body as AttendeeContextDTO;
	expect(me.participant.status).toBe('pending');
	expect(me.team).toBeNull();
	expect((await eve.c.put(`/api/e/${event.slug}/project`, { name: 'Sneaky' })).status).toBe(403);
	// Joining again is idempotent.
	expect((await join('Eve', eve.c)).r.body.participant.status).toBe('pending');

	// Only managers of the event (or admins) decide.
	expect((await eve.c.post(`/api/events/${event.id}/participants/${eve.pid}/approve`, {})).status).toBe(403);

	// Let Eve into an existing team: the team is in the full hall, so that fails; a new team goes to the lab.
	const full = await mgr.post(`/api/events/${event.id}/participants/${eve.pid}/approve`, { teamId: t1!.id });
	expect(full.status).toBe(409);
	expect(full.body.message).toContain('Hall has no free station');
	const ws = await connectWS(srv.url, eve.c.cookie);
	const ok = await mgr.post(`/api/events/${event.id}/participants/${eve.pid}/approve`, {});
	expect(ok.status).toBe(200);
	expect(ok.body.participant).toMatchObject({ status: 'active', teamId: ok.body.team.id });
	expect(ok.body.team).toMatchObject({ name: 'Team 3', position: 2, segmentId: 'lab', members: [{ participantId: eve.pid, stationId: 'lab-01' }] });
	expect((await ws.next('assignment')).stationId).toBe('lab-01');
	expect(((await ws.next('participant.updated')).participant as ParticipantDTO).status).toBe('active');
	ws.close();
	expect(await count()).toBe(5);
	expect((await mgr.post(`/api/events/${event.id}/participants/${eve.pid}/approve`, {})).status).toBe(409);

	// An admin lets the next one into Eve's team (seat next to her); a friend code shows up as friendIds.
	const fay = await join('Fay');
	await fay.c.post(`/api/e/${event.slug}/pairings`, { friendCode: ok.body.participant.friendCode });
	const listed = (await mgr.get(`/api/events/${event.id}/participants`)).body.participants as ParticipantDTO[];
	expect(listed.find((p) => p.id === fay.pid)).toMatchObject({ status: 'pending', friendIds: [eve.pid] });
	const intoTeam = await admin.post(`/api/events/${event.id}/participants/${fay.pid}/approve`, { teamId: ok.body.team.id });
	expect(intoTeam.body.team.members.map((m: { stationId: string }) => m.stationId)).toEqual(['lab-01', 'lab-02']);

	// Turned away: can't get back in.
	const gus = await join('Gus');
	expect((await mgr.post(`/api/events/${event.id}/participants/${gus.pid}/reject`)).body.participant.status).toBe('rejected');
	expect((await gus.c.get(`/api/e/${event.slug}/me`)).status).toBe(403);
	expect((await join('Gus', gus.c)).r.status).toBe(403);

	// Once voting starts, joining is closed and pending people can't be let in.
	const hal = await join('Hal');
	await fay.c.put(`/api/e/${event.slug}/project`, { name: 'Fay Thing' });
	expect((await mgr.post(`/api/events/${event.id}/voting`, { action: 'start' })).status).toBe(200);
	expect((await join('Ivy')).r.status).toBe(409);
	expect((await mgr.post(`/api/events/${event.id}/participants/${hal.pid}/approve`, {})).status).toBe(409);
});
