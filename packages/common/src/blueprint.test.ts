import { expect, test } from 'bun:test';
import { stationPositions, type Segment } from './blueprint';

const seg = (count: number, layout: 'grid' | 'row' = 'grid'): Segment => ({
	id: 's',
	name: 'S',
	shape: 'rect',
	points: [[0, 0], [200, 100]],
	labelPos: [100, 50],
	stations: { count, layout, confirmed: true }
});

test('stationPositions lays out inside the padded box', () => {
	const pts = stationPositions(seg(2, 'row'), 10);
	expect(pts).toEqual([[55, 50], [145, 50]]);
});

test('stationPositions top inset reserves a band above the stations', () => {
	const pts = stationPositions(seg(2, 'row'), 10, 30);
	// rows start below pad + top: y = 10 + 30 + (100 - 20 - 30) / 2
	expect(pts).toEqual([[55, 65], [145, 65]]);
	for (const p of stationPositions(seg(12), 10, 30)) expect(p[1]).toBeGreaterThan(40);
	expect(stationPositions(seg(0), 10, 30)).toEqual([]);
});
