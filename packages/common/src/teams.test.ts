import { expect, test } from 'bun:test';
import { emptyBlueprint, type Blueprint, type Segment } from './blueprint';
import { assignTeams, pairGroups, teamSizes } from './teams';

const seg = (id: string, count: number, confirmed = true): Segment => ({
	id,
	name: id,
	shape: 'rect',
	points: [[0, 0], [100, 100]],
	labelPos: [50, 50],
	stations: { count, layout: 'grid', confirmed }
});
const bp = (...segments: Segment[]): Blueprint => ({ ...emptyBlueprint(), segments });
const people = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

test('teamSizes balances', () => {
	expect(teamSizes(10, 4)).toEqual([4, 3, 3]);
	expect(teamSizes(8, 4)).toEqual([4, 4]);
	expect(teamSizes(0, 4)).toEqual([]);
});

test('pairGroups unions transitively', () => {
	const g = pairGroups(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c']]);
	expect(g.map((x) => x.sort())).toEqual([['a', 'b', 'c'], ['d']]);
});

test('assigns everyone, keeps pairs together, is deterministic', () => {
	const input = { participantIds: people(11), pairs: [['p0', 'p1'], ['p5', 'p9']] as [string, string][], teamSize: 4, blueprint: bp(seg('a', 8), seg('b', 6)), seed: 42 };
	const r = assignTeams(input);
	expect(r.ok).toBe(true);
	if (!r.ok) return;
	expect(r.teams.flatMap((t) => t.memberIds).sort()).toEqual(people(11).sort());
	expect(r.teams.length).toBe(3);
	const teamOf = (p: string) => r.teams.find((t) => t.memberIds.includes(p))!.index;
	expect(teamOf('p0')).toBe(teamOf('p1'));
	expect(teamOf('p5')).toBe(teamOf('p9'));
	const stations = r.teams.flatMap((t) => t.stationIds);
	expect(new Set(stations).size).toBe(11);
	for (const t of r.teams) expect(t.stationIds.every((s) => s.startsWith(t.segmentId + '-'))).toBe(true);
	expect(assignTeams(input)).toEqual(r);
});

test('capacity error', () => {
	const r = assignTeams({ participantIds: people(5), pairs: [], teamSize: 2, blueprint: bp(seg('a', 4)), seed: 1 });
	expect(r.ok === false && r.error).toBe('capacity');
});

test('team must fit in one segment', () => {
	const r = assignTeams({ participantIds: people(4), pairs: [], teamSize: 4, blueprint: bp(seg('a', 2), seg('b', 2)), seed: 1 });
	expect(r.ok === false && r.error).toBe('capacity');
});

test('unconfirmed segments block', () => {
	const r = assignTeams({ participantIds: people(2), pairs: [], teamSize: 2, blueprint: bp(seg('a', 4, false)), seed: 1 });
	expect(r.ok === false && r.error).toBe('invalid');
});
