import { afterAll, beforeAll, expect, test } from 'bun:test';
import { emptyBlueprint, type AttendeeContextDTO, type LiveSnapshotDTO, type ProjectDTO, type TeamDTO } from 'common';
import { ADMIN, bootTestServer, connectWS, type Client } from './helpers';

let srv: Awaited<ReturnType<typeof bootTestServer>>;
let mgr: Client;

beforeAll(async () => {
	srv = await bootTestServer({ autoEndIntervalMs: 600_000 });
	const admin = srv.client();
	await admin.login(ADMIN.email, ADMIN.password);
	await admin.post('/api/admin/users', { email: 'host@test.dev', password: 'host-password', displayName: 'Host', role: 'manager' });
	mgr = srv.client();
	await mgr.login('host@test.dev', 'host-password');
});
afterAll(() => srv.close());

interface Person {
	c: Client;
	name: string;
	pid: string;
}

/** Creates an open event with a confirmed 12-station blueprint and `names.length` joined attendees. */
async function setupEvent(name: string, names: string[]) {
	const event = (await mgr.post('/api/events', { name })).body.event;
	await mgr.patch(`/api/events/${event.id}`, { status: 'open' });
	const invite = (await mgr.post(`/api/events/${event.id}/invites`, {})).body.invite;
	const people: Person[] = [];
	for (const n of names) {
		const c = srv.client();
		const code = (await mgr.get(`/api/invites/${invite.id}/code`)).body.code;
		const r = await c.post(`/api/join/${invite.token}`, { code, displayName: n });
		people.push({ c, name: n, pid: r.body.participant.id });
	}
	const bp = emptyBlueprint(name, '2026-10-25');
	bp.segments.push({
		id: 'hall',
		name: 'Hall',
		shape: 'rect',
		points: [
			[0, 0],
			[500, 500]
		],
		labelPos: [250, 250],
		stations: { count: 12, layout: 'grid', confirmed: true }
	});
	await mgr.put(`/api/events/${event.id}/blueprint`, { blueprint: bp, version: 0 });
	return { event, people };
}

const me = async (p: Person, slug: string) => (await p.c.get(`/api/e/${slug}/me`)).body as AttendeeContextDTO;
const name = (p: Person, slug: string, project: string, tagline?: string) => p.c.put(`/api/e/${slug}/project`, { name: project, tagline });
const vote = (p: Person, slug: string, round: 'group' | 'pitch', ranking: string[]) => p.c.put(`/api/e/${slug}/ballot`, { round, ranking });
const action = (c: Client, eventId: string, a: string) => c.post(`/api/events/${eventId}/voting`, { action: a });
const snapshot = async (slug: string) => (await srv.client().get(`/api/e/${slug}/live`)).body as LiveSnapshotDTO;

test('full voting flow: projects → group round (auto-close) → pitch round → results → reset', async () => {
	const { event, people } = await setupEvent('Vote Jam', ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
	const slug = event.slug;

	// projects need a team (and a live event)
	expect((await name(people[0]!, slug, 'Too Early')).status).toBe(409);
	const launched = await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 3, durationMin: 60, seed: 7 });
	expect(launched.status).toBe(200);
	const teams: TeamDTO[] = launched.body.teams;
	expect(teams.map((t) => t.members.length).sort()).toEqual([2, 3, 3]);

	// Team A (3 members, 3 projects), team B (3 members, 2 projects), team C (2 members, 1 project).
	const byPid = new Map(people.map((p) => [p.pid, p]));
	const membersOf = (t: TeamDTO) => t.members.map((m) => byPid.get(m.participantId)!);
	const [teamA, teamB] = teams.filter((t) => t.members.length === 3) as [TeamDTO, TeamDTO];
	const teamC = teams.find((t) => t.members.length === 2)!;
	const [a1, a2, a3] = membersOf(teamA) as [Person, Person, Person];
	const [b1, b2, b3] = membersOf(teamB) as [Person, Person, Person];
	const [c1, c2] = membersOf(teamC) as [Person, Person];

	const tv = await connectWS(srv.url);
	tv.send({ type: 'subscribe', slug, scope: 'public' });
	const sub = await tv.next('subscribed');
	expect(sub.snapshot.event.votingPhase).toBe('none');
	expect(sub.snapshot.voting.phase).toBe('none');
	expect(sub.snapshot.projects).toEqual([]);

	const project = async (p: Person, n: string, tagline?: string) => {
		const r = await name(p, slug, n, tagline);
		expect(r.status).toBe(200);
		return r.body.project as ProjectDTO;
	};
	const pa1 = await project(a1, 'Alpha One', 'The best');
	expect((await tv.next('project.updated')).project.name).toBe('Alpha One');
	expect(pa1).toMatchObject({ teamId: teamA.id, participantId: a1.pid, authorName: a1.name, tagline: 'The best' });
	const pa2 = await project(a2, 'Alpha Two');
	const pa3 = await project(a3, 'Alpha Three');
	const pb1 = await project(b1, 'Beta One');
	const pb2 = await project(b2, 'Beta Two');
	const pc1 = await project(c1, 'Gamma One');
	// unique per event, case-insensitive; editing your own keeps the id
	expect((await name(b3, slug, 'alpha one')).status).toBe(409);
	const renamed = await project(a1, 'Alpha One', '');
	expect(renamed.id).toBe(pa1.id);
	expect(renamed.tagline).toBeNull();
	expect((await me(a1, slug)).project!.id).toBe(pa1.id);
	expect((await snapshot(slug)).projects).toHaveLength(6);

	// nothing to vote on before start; only the manager can start
	expect((await vote(a1, slug, 'group', [pa2.id, pa3.id])).status).toBe(409);
	expect((await action(a1.c, event.id, 'start')).status).toBe(403);
	expect((await action(mgr, event.id, 'close-group')).status).toBe(409);

	const started = await action(mgr, event.id, 'start');
	expect(started.status).toBe(200);
	expect(started.body.event.votingPhase).toBe('group');
	expect((await tv.next('voting.updated')).voting.phase).toBe('group');
	expect((await tv.next('event.updated')).event.votingPhase).toBe('group');
	expect((await action(mgr, event.id, 'start')).status).toBe(409);
	expect((await name(a1, slug, 'Changed')).status).toBe(409);

	const v0 = started.body.voting;
	expect(v0.group.teamsTotal).toBe(2);
	expect(v0.group.teamsDone).toBe(0);
	const per = (id: string) => v0.group.perTeam.find((t: any) => t.teamId === id);
	expect(per(teamA.id)).toEqual({ teamId: teamA.id, cast: 0, eligible: 3 });
	expect(per(teamB.id)).toEqual({ teamId: teamB.id, cast: 0, eligible: 3 });
	expect(per(teamC.id)).toEqual({ teamId: teamC.id, cast: 0, eligible: 0 });
	expect(v0.pitches).toEqual([]);
	expect(v0.results).toBeUndefined();

	// rejections
	expect((await vote(a1, slug, 'group', [pa1.id, pa2.id, pa3.id])).status).toBe(422); // own project
	expect((await vote(a1, slug, 'group', [pa2.id])).status).toBe(422); // incomplete
	expect((await vote(a1, slug, 'group', [pa2.id, pa2.id])).status).toBe(422); // duplicate
	expect((await vote(a1, slug, 'group', [pa2.id, pb1.id])).status).toBe(422); // other team
	expect((await vote(a1, slug, 'pitch', [pa2.id, pa3.id])).status).toBe(409); // wrong round
	expect((await vote(c2, slug, 'group', [pc1.id])).status).toBe(403); // team C does not vote
	expect((await vote({ c: mgr, name: 'Host', pid: '' }, slug, 'group', [pa2.id])).status).toBe(403); // not a participant

	// team A: pa1 6 pts, pa2 5, pa3 4 (N = 3: first 3, second 2)
	const ok = await vote(a1, slug, 'group', [pa3.id, pa2.id]);
	expect(ok.status).toBe(200);
	expect(ok.body.voting.group.perTeam.find((t: any) => t.teamId === teamA.id).cast).toBe(1);
	expect((await tv.next('voting.updated')).voting.group.perTeam.find((t: any) => t.teamId === teamA.id).cast).toBe(1);
	// a changed ballot replaces the old one
	expect((await vote(a1, slug, 'group', [pa2.id, pa3.id])).body.voting.group.perTeam.find((t: any) => t.teamId === teamA.id).cast).toBe(1);
	expect((await me(a1, slug)).ballots).toEqual({ group: [pa2.id, pa3.id] });
	await vote(a2, slug, 'group', [pa1.id, pa3.id]);
	const aDone = await vote(a3, slug, 'group', [pa1.id, pa2.id]);
	expect(aDone.body.voting.group.teamsDone).toBe(1);
	expect(aDone.body.voting.phase).toBe('group');
	// no running scores while voting
	expect((await snapshot(slug)).voting.results).toBeUndefined();

	// team B: b3 has no project and ranks both; pb2 4 pts, pb1 3 pts
	await vote(b1, slug, 'group', [pb2.id]);
	await vote(b2, slug, 'group', [pb1.id]);
	const last = await vote(b3, slug, 'group', [pb2.id, pb1.id]);
	expect(last.status).toBe(200);
	expect(last.body.voting.phase).toBe('pitch');
	expect(last.body.voting.pitches.map((p: ProjectDTO) => p.id)).toEqual(
		teams.map((t) => (t.id === teamA.id ? pa1.id : t.id === teamB.id ? pb2.id : pc1.id))
	);
	expect(last.body.voting.pitch).toEqual({ cast: 0, eligible: 8 });
	expect(last.body.voting.results).toBeUndefined();
	const ev = await tv.next('event.updated');
	expect(ev.event.votingPhase).toBe('pitch');
	expect((await vote(b3, slug, 'group', [pb1.id, pb2.id])).status).toBe(409); // round closed

	// pitch round: authors cannot rank their own pitch
	expect((await vote(a1, slug, 'pitch', [pa1.id, pb2.id, pc1.id])).status).toBe(422);
	expect((await vote(a1, slug, 'pitch', [pb2.id, pc1.id])).status).toBe(200);
	await vote(b2, slug, 'pitch', [pa1.id, pc1.id]);
	await vote(a2, slug, 'pitch', [pb2.id, pa1.id, pc1.id]);
	await vote(b3, slug, 'pitch', [pb2.id, pc1.id, pa1.id]);
	const cast = await vote(c2, slug, 'pitch', [pb2.id, pa1.id, pc1.id]);
	expect(cast.body.voting.pitch).toEqual({ cast: 5, eligible: 8 });
	expect(cast.body.voting.results).toBeUndefined();

	// the manager closes the pitch round
	expect((await action(mgr, event.id, 'close-group')).status).toBe(409);
	const closed = await action(mgr, event.id, 'close-pitch');
	expect(closed.status).toBe(200);
	expect(closed.body.event.votingPhase).toBe('results');
	const results = closed.body.voting.results;
	expect(results.pitch[0]).toMatchObject({ projectId: pb2.id, rank: 1 });
	expect(results.pitch.map((r: any) => r.rank)).toEqual([1, 2, 3]);
	expect(results.group[teamA.id].map((r: any) => [r.projectId, r.points])).toEqual([
		[pa1.id, 6],
		[pa2.id, 5],
		[pa3.id, 4]
	]);
	expect(results.group[teamB.id][0]).toMatchObject({ projectId: pb2.id, points: 4 });
	expect(results.group[teamC.id]).toHaveLength(1);
	expect((await snapshot(slug)).voting.results.pitch[0].projectId).toBe(pb2.id);
	expect((await vote(a2, slug, 'pitch', [pb2.id, pc1.id, pa1.id])).status).toBe(409);
	expect((await action(mgr, event.id, 'close-pitch')).status).toBe(409);

	// reset clears ballots and results; projects stay and become editable again
	const reset = await action(mgr, event.id, 'reset');
	expect(reset.body.event.votingPhase).toBe('none');
	expect(reset.body.voting.results).toBeUndefined();
	expect((await me(a1, slug)).ballots).toEqual({});
	expect((await snapshot(slug)).projects).toHaveLength(6);
	expect((await name(a1, slug, 'Alpha Prime')).status).toBe(200);
	tv.close();
});

test('teams with a single project skip the group round entirely', async () => {
	const { event, people } = await setupEvent('Solo Jam', ['S1', 'S2', 'S3']);
	await mgr.post(`/api/events/${event.id}/launch`, { teamSize: 1, durationMin: 30, seed: 3 });
	const [s1, s2, s3] = people as [Person, Person, Person];
	expect((await action(mgr, event.id, 'start')).status).toBe(409); // no projects yet
	const p1 = (await name(s1, event.slug, 'Solo One')).body.project as ProjectDTO;
	const p2 = (await name(s2, event.slug, 'Solo Two')).body.project as ProjectDTO;

	// nobody votes in the group round, so start goes straight to pitches
	const started = await action(mgr, event.id, 'start');
	expect(started.body.event.votingPhase).toBe('pitch');
	expect(started.body.voting.group.teamsTotal).toBe(0);
	expect(started.body.voting.pitches.map((p: ProjectDTO) => p.id).sort()).toEqual([p1.id, p2.id].sort());
	// s3 has no project but is on a team: they rank both pitches
	expect(started.body.voting.pitch.eligible).toBe(3);
	expect((await vote(s1, event.slug, 'pitch', [p2.id])).status).toBe(200);
	expect((await vote(s3, event.slug, 'pitch', [p1.id, p2.id])).status).toBe(200);
	const closed = await action(mgr, event.id, 'close-pitch');
	// p1: 2 (s3), p2: 2 (s1) + 1 (s3) = 3
	expect(closed.body.voting.results.pitch.map((r: any) => [r.projectId, r.points])).toEqual([
		[p2.id, 3],
		[p1.id, 2]
	]);
});
