import { afterAll, beforeAll, expect, test } from 'bun:test';
import { emptyBlueprint, type AttendeeContextDTO, type LiveSnapshotDTO, type TeamDTO } from 'common';
import { ADMIN, bootTestServer, type Client } from './helpers';

let srv: Awaited<ReturnType<typeof bootTestServer>>;
let admin: Client;
let mgr: Client;

beforeAll(async () => {
	srv = await bootTestServer({ autoEndIntervalMs: 600_000 });
	admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'mover@test.dev', password: 'mover-password', displayName: 'Mover', role: 'manager' });
	mgr = srv.client();
	await mgr.login('mover@test.dev', 'mover-password');
});
afterAll(() => srv.close());

const segment = (id: string, name: string, count: number, x: number) => ({
	id,
	name,
	shape: 'rect' as const,
	points: [
		[x, 0],
		[x + 200, 200]
	] as [number, number][],
	labelPos: [x + 100, 100] as [number, number],
	stations: { count, layout: 'grid' as const, confirmed: true }
});

test('managers move people between teams and teams between areas', async () => {
	const event = (await mgr.post('/api/events', { name: 'Shuffle Jam' })).body.event;
	await mgr.patch(`/api/events/${event.id}`, { status: 'open' });
	const invite = (await mgr.post(`/api/events/${event.id}/invites`, {})).body.invite;
	const people: { c: Client; pid: string }[] = [];
	for (const n of ['A', 'B', 'C', 'D']) {
		const c = srv.client();
		const code = (await mgr.get(`/api/invites/${invite.id}/code`)).body.code;
		people.push({ c, pid: (await c.post(`/api/join/${invite.token}`, { code, displayName: n })).body.participant.id });
	}
	const bp = emptyBlueprint('Shuffle', '2026-11-23');
	bp.segments.push(segment('hall', 'Hall', 4, 0), segment('lab', 'Lab', 5, 300));
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: bp, version: 0 });

	const move = (c: Client, body: unknown) => c.post(`/api/events/${event.id}/teams/move`, body);
	expect((await move(mgr, { kind: 'team', teamId: 'x', segmentId: 'lab' })).status).toBe(409); // not launched

	const teams: TeamDTO[] = (await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 2, durationMin: 60, seed: 3 })).body.teams;
	expect(teams.map((t) => t.segmentId)).toEqual(['hall', 'hall']);
	const [t1, t2] = teams as [TeamDTO, TeamDTO];
	const mover = people.find((p) => p.pid === t1.members[0]!.participantId)!;
	await mover.c.put(`/api/e/${event.slug}/project`, { name: 'Mover Project' });

	// Attendees cannot rearrange.
	expect((await move(mover.c, { kind: 'team', teamId: t1.id, segmentId: 'lab' })).status).toBe(403);

	// Whole team to the lab: contiguous stations, colour position unchanged.
	const r1 = await move(mgr, { kind: 'team', teamId: t2.id, segmentId: 'lab' });
	expect(r1.status).toBe(200);
	expect(r1.body.teams).toHaveLength(1);
	expect(r1.body.teams[0]).toMatchObject({ id: t2.id, segmentId: 'lab', position: t2.position });
	expect(r1.body.teams[0].members.map((m: { stationId: string }) => m.stationId)).toEqual(['lab-01', 'lab-02']);

	// A person joins the other team (admin works too); their project follows them.
	const r2 = await move(admin, { kind: 'member', participantId: mover.pid, teamId: t2.id });
	expect(r2.status).toBe(200);
	const ctx = (await mover.c.get(`/api/e/${event.slug}/me`)).body as AttendeeContextDTO;
	expect(ctx.team?.id).toBe(t2.id);
	expect(ctx.stationId).toBe('lab-03');
	const snap = (await srv.client().get(`/api/e/${event.slug}/live`)).body as LiveSnapshotDTO;
	expect(snap.teams.find((t) => t.id === t1.id)!.members).toHaveLength(1);
	expect(snap.projects?.find((p) => p.participantId === mover.pid)?.teamId).toBe(t2.id);

	// The last member cannot leave a team.
	const lastOfT1 = snap.teams.find((t) => t.id === t1.id)!.members[0]!.participantId;
	expect((await move(mgr, { kind: 'member', participantId: lastOfT1, teamId: t2.id })).body.message).toBe('A team needs at least one member');

	// Swapping two people trades their teams and stations; projects follow.
	const r3 = await move(mgr, { kind: 'swap', participantId: mover.pid, withParticipantId: lastOfT1 });
	expect(r3.status).toBe(200);
	const after = (await srv.client().get(`/api/e/${event.slug}/live`)).body as LiveSnapshotDTO;
	expect(after.teams.find((t) => t.id === t1.id)!.members.map((m) => m.participantId)).toEqual([mover.pid]);
	expect(after.teams.find((t) => t.id === t2.id)!.members.find((m) => m.participantId === lastOfT1)?.stationId).toBe('lab-03');
	expect(after.projects?.find((p) => p.participantId === mover.pid)?.teamId).toBe(t1.id);

	// Once voting starts only whole teams can still move.
	expect((await mgr.post(`/api/events/${event.id}/voting`, { action: 'start' })).status).toBe(200);
	expect((await move(mgr, { kind: 'member', participantId: lastOfT1, teamId: t1.id })).status).toBe(409);
	expect((await move(mgr, { kind: 'swap', participantId: mover.pid, withParticipantId: lastOfT1 })).status).toBe(409);
	expect((await move(mgr, { kind: 'team', teamId: t2.id, segmentId: 'hall' })).status).toBe(200);
});
