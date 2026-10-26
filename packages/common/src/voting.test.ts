import { expect, test } from 'bun:test';
import { groupEligibleVoters, hashSeed, pitchEligibleVoters, tally, validateRanking, type VoteProject } from './voting';

const proj = (id: string, participantId: string, teamId = 't1'): VoteProject => ({ id, participantId, teamId });

test('validateRanking requires an exact permutation', () => {
	expect(validateRanking(['b', 'a'], ['a', 'b'])).toBeNull();
	expect(validateRanking(['a'], ['a', 'b'])).not.toBeNull();
	expect(validateRanking(['a', 'a'], ['a', 'b'])).not.toBeNull();
	expect(validateRanking(['a', 'x'], ['a', 'b'])).not.toBeNull();
	expect(validateRanking([], [])).not.toBeNull();
});

test('group eligibility: teams with fewer than two projects do not vote', () => {
	expect(groupEligibleVoters(['p1', 'p2'], [proj('a', 'p1')])).toEqual([]);
	expect(groupEligibleVoters(['p1', 'p2'], [])).toEqual([]);
	expect(groupEligibleVoters(['p1', 'p2', 'p3'], [proj('a', 'p1'), proj('b', 'p2')])).toEqual(['p1', 'p2', 'p3']);
});

test('pitch eligibility: everyone votes once there are two pitches, own pitch included', () => {
	expect(pitchEligibleVoters(['p1', 'p2'], [proj('a', 'p1')])).toEqual([]);
	expect(pitchEligibleVoters(['p1', 'p2', 'p3'], [proj('a', 'p1'), proj('b', 'p2')])).toEqual(['p1', 'p2', 'p3']);
});

test('tally uses a fixed Borda scale', () => {
	// 3 projects: positions earn 3, 2, 1.
	const rows = tally(['a', 'b', 'c'], [['b', 'c', 'a'], ['a', 'b', 'c'], ['b', 'a', 'c']], 1);
	expect(rows.map((r) => [r.projectId, r.points, r.firsts, r.rank])).toEqual([
		['b', 3 + 2 + 3, 2, 1],
		['a', 1 + 3 + 2, 1, 2],
		['c', 2 + 1 + 1, 0, 3]
	]);
	expect(rows.every((r) => !r.tieBrokenByDraw)).toBe(true);
});

test('tally breaks ties by first places, then a reproducible draw', () => {
	// All on 8 points; a has two firsts, b and c one each (b/c decided by draw).
	const byFirsts = tally(['a', 'b', 'c'], [['a', 'b', 'c'], ['a', 'c', 'b'], ['c', 'b', 'a'], ['b', 'c', 'a']], 7);
	expect(byFirsts.map((r) => r.points)).toEqual([8, 8, 8]);
	expect(byFirsts[0]!.projectId).toBe('a');
	expect(byFirsts.map((r) => r.tieBrokenByDraw)).toEqual([false, true, true]);

	// Team of two, each voting for themselves: a tie decided by the draw.
	const pair = tally(['a', 'b'], [['a', 'b'], ['b', 'a']], 42);
	expect(pair.every((r) => r.tieBrokenByDraw)).toBe(true);
	expect(tally(['b', 'a'], [['b', 'a'], ['a', 'b']], 42).map((r) => r.projectId)).toEqual(pair.map((r) => r.projectId));
	const winners = new Set(Array.from({ length: 20 }, (_, s) => tally(['a', 'b'], [['a', 'b'], ['b', 'a']], s)[0]!.projectId));
	expect(winners.size).toBe(2);
});

test('hashSeed is stable and spreads', () => {
	expect(hashSeed(1, 'team')).toBe(hashSeed(1, 'team'));
	expect(hashSeed(1, 'team')).not.toBe(hashSeed(2, 'team'));
	expect(hashSeed(null, 'x')).toBe(hashSeed(undefined, 'x'));
});
