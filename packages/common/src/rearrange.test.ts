import { describe, expect, test } from 'bun:test';
import { emptyBlueprint, type Blueprint, type Segment } from './blueprint';
import { applyTeamMove, newTeamSeat, seatInTeam, suggestTeam, type PlacedTeam } from './rearrange';

const segment = (id: string, count: number): Segment => ({
	id,
	name: id.toUpperCase(),
	shape: 'rect',
	points: [
		[0, 0],
		[100, 100]
	],
	labelPos: [50, 50],
	stations: { count, layout: 'row', confirmed: true }
});

const bp: Blueprint = { ...emptyBlueprint(), segments: [segment('a', 6), segment('b', 5)] };

const team = (id: string, segmentId: string, seats: [string, number][]): PlacedTeam => ({
	id,
	segmentId,
	members: seats.map(([participantId, i]) => ({ participantId, stationId: `${segmentId}-${String(i).padStart(2, '0')}` }))
});

// a: t1 on 01-02, t2 on 03-04, 05-06 free. b: t3 on 01 and 03 (02, 04, 05 free).
const teams = [
	team('t1', 'a', [
		['p1', 1],
		['p2', 2]
	]),
	team('t2', 'a', [
		['p3', 3],
		['p4', 4]
	]),
	team('t3', 'b', [
		['p5', 1],
		['p6', 3]
	])
];

describe('applyTeamMove: member', () => {
	test('joins the target team at its nearest free station and leaves the old one', () => {
		const r = applyTeamMove(bp, teams, { kind: 'member', participantId: 'p1', teamId: 't2' });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const [from, to] = r.teams;
		expect(from!.members.map((m) => m.participantId)).toEqual(['p2']);
		expect(to!.members).toContainEqual({ participantId: 'p1', stationId: 'a-05' });
	});

	test('can cross segments', () => {
		const r = applyTeamMove(bp, teams, { kind: 'member', participantId: 'p4', teamId: 't3' });
		expect(r.ok && r.teams[1]!.members.map((m) => m.stationId)).toEqual(['b-01', 'b-02', 'b-03']);
	});

	test('never empties a team', () => {
		const solo = [...teams, team('t4', 'b', [['p7', 5]])];
		const r = applyTeamMove(bp, solo, { kind: 'member', participantId: 'p7', teamId: 't3' });
		expect(r).toEqual({ ok: false, message: 'A team needs at least one member' });
	});

	test('fails when the target segment is full', () => {
		const full = [team('x', 'a', [['q1', 1], ['q2', 2], ['q3', 3], ['q4', 4], ['q5', 5], ['q6', 6]]), team('y', 'b', [['q7', 1], ['q8', 2]])];
		const r = applyTeamMove(bp, full, { kind: 'member', participantId: 'q7', teamId: 'x' });
		expect(r).toEqual({ ok: false, message: 'A has no free station' });
	});

	test('same team is a no-op', () => {
		expect(applyTeamMove(bp, teams, { kind: 'member', participantId: 'p1', teamId: 't1' })).toEqual({ ok: true, teams: [] });
	});
});

describe('applyTeamMove: swap', () => {
	test('two people trade team and station, sizes unchanged', () => {
		const r = applyTeamMove(bp, teams, { kind: 'swap', participantId: 'p1', withParticipantId: 'p6' });
		expect(r.ok && r.teams).toEqual([
			{ id: 't1', segmentId: 'a', members: [{ participantId: 'p6', stationId: 'a-01' }, { participantId: 'p2', stationId: 'a-02' }] },
			{ id: 't3', segmentId: 'b', members: [{ participantId: 'p5', stationId: 'b-01' }, { participantId: 'p1', stationId: 'b-03' }] }
		]);
	});

	test('teammates swapping is a no-op', () => {
		expect(applyTeamMove(bp, teams, { kind: 'swap', participantId: 'p1', withParticipantId: 'p2' })).toEqual({ ok: true, teams: [] });
	});
});

describe('applyTeamMove: team', () => {
	test('takes a contiguous run of free stations, keeping member order', () => {
		const r = applyTeamMove(bp, teams, { kind: 'team', teamId: 't1', segmentId: 'b' });
		expect(r.ok && r.teams).toEqual([
			{
				id: 't1',
				segmentId: 'b',
				members: [
					{ participantId: 'p1', stationId: 'b-04' },
					{ participantId: 'p2', stationId: 'b-05' }
				]
			}
		]);
	});

	test('frees its old stations for the next move', () => {
		const r = applyTeamMove(bp, teams, { kind: 'team', teamId: 't3', segmentId: 'a' });
		expect(r.ok && r.teams[0]!.members.map((m) => m.stationId)).toEqual(['a-05', 'a-06']);
	});

	test('fails when the segment has too few free stations', () => {
		const big = [...teams, team('t4', 'b', [['p7', 2], ['p8', 4]])];
		const r = applyTeamMove(bp, big, { kind: 'team', teamId: 't2', segmentId: 'b' });
		expect(r).toEqual({ ok: false, message: 'B has 1 free station, the team needs 2' });
	});

	test('unknown segment fails', () => {
		expect(applyTeamMove(bp, teams, { kind: 'team', teamId: 't1', segmentId: 'zz' }).ok).toBe(false);
	});
});

describe('late arrivals', () => {
	const placed = teams.map((t, i) => ({ ...t, position: i }));

	test('seatInTeam: nearest free station in the team area, null when full', () => {
		expect(seatInTeam(bp, teams, 't2')).toBe('a-05');
		expect(seatInTeam(bp, teams, 't3')).toBe('b-02');
		const full = [team('x', 'a', [['q1', 1], ['q2', 2], ['q3', 3], ['q4', 4], ['q5', 5], ['q6', 6]])];
		expect(seatInTeam(bp, full, 'x')).toBeNull();
	});

	test('newTeamSeat: the area with the most room', () => {
		expect(newTeamSeat(bp, teams)).toEqual({ segmentId: 'b', stationId: 'b-02' });
		expect(newTeamSeat({ ...bp, segments: [segment('a', 2)] }, [team('x', 'a', [['q1', 1], ['q2', 2]])])).toBeNull();
	});

	test("suggestTeam: a friend's team first, else the smallest team with room", () => {
		expect(suggestTeam(bp, placed)).toBe('t1');
		expect(suggestTeam(bp, placed, ['p6'])).toBe('t3');
		const small = [...placed, { ...team('t4', 'b', [['p7', 5]]), position: 3 }];
		expect(suggestTeam(bp, small)).toBe('t4');
		// No room anywhere: suggest a new team.
		const tiny = { ...bp, segments: [segment('a', 4), segment('b', 3)] };
		const fullTeams = [
			{ ...team('t1', 'a', [['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4]]), position: 0 },
			{ ...team('t3', 'b', [['p5', 1], ['p6', 2], ['p7', 3]]), position: 1 }
		];
		expect(suggestTeam(tiny, fullTeams)).toBeNull();
	});
});
