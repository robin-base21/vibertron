/// <reference types="bun" />
import { expect, test } from 'bun:test';
import type { Point, Wall } from 'common';
import { orthoEnd, orthogonalize, snapToWalls, snapWallPoint } from './ortho';

const isOrtho = (pts: Point[]) => pts.every((a, i) => {
	const b = pts[(i + 1) % pts.length]!;
	return a[0] === b[0] || a[1] === b[1];
});

test('orthogonalize straightens a wobbly quad into a rect-like polygon', () => {
	const out = orthogonalize([[0, 0], [100, 4], [98, 60], [2, 58]])!;
	expect(isOrtho(out)).toBe(true);
	expect(out).toHaveLength(4);
});

test('orthogonalize keeps an L shape and closes the loop with a corner', () => {
	const out = orthogonalize([[0, 0], [100, 0], [100, 50], [50, 52], [48, 100], [0, 100]])!;
	expect(isOrtho(out)).toBe(true);
	expect(out).toHaveLength(6);
	const tri = orthogonalize([[0, 0], [100, 10], [10, 100]])!;
	expect(isOrtho(tri)).toBe(true);
});

const walls: Wall[] = [
	{ id: 'w1', a: [0, 0], b: [100, 0] },
	{ id: 'w2', a: [100, 0], b: [100, 100] }
];

test('snapWallPoint prefers endpoints, then lines, and skips the dragged wall', () => {
	expect(snapWallPoint([97, 3], walls, 8)).toEqual({ p: [100, 0], kind: 'endpoint' });
	expect(snapWallPoint([50, 5], walls, 8)).toEqual({ p: [50, 0], kind: 'line' });
	expect(snapWallPoint([50, 50], walls, 8).kind).toBeNull();
	expect(snapWallPoint([50, 5], walls, 8, 'w1').kind).toBeNull();
});

test('orthoEnd and snapToWalls', () => {
	expect(orthoEnd([0, 0], [50, 10])).toEqual([50, 0]);
	expect(orthoEnd([0, 0], [10, 50])).toEqual([0, 50]);
	expect(snapToWalls([96, 50], walls, 8)).toEqual({ p: [100, 50], x: true, y: false });
	expect(snapToWalls([96, 300], walls, 8).x).toBe(false);
});
