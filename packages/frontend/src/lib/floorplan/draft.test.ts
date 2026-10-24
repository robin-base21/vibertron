/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { Blueprint, emptyBlueprint } from 'common';
import { applyDraft, fitDraft, localDraft } from './draft';
import type { FloorplanGeometry } from './pipeline';

const title = { project: 'P', date: '2026-10-24', rev: 'C' };

test('fitDraft takes the title block and clamps geometry to the canvas', () => {
	const draft: Blueprint = {
		...emptyBlueprint('Server'),
		canvas: { w: 1000, h: 625 },
		underlay: { imageRef: 'ref', opacity: 0.35 },
		outlines: [{ id: 'o1', kind: 'wall', points: [[0, 0], [1000, 700]], closed: false }],
		segments: [
			{ id: 's1', name: 'Hall', shape: 'rect', points: [[100, 125], [500, 375]], labelPos: [300, 250], stations: { count: 8, layout: 'grid', confirmed: false }, confidence: 0.9 },
			{ id: 's2', name: 'Lab', shape: 'polygon', points: [[600, 100], [900, 100], [900, 640]], labelPos: [750, 630], stations: { count: 4, layout: 'grid', confirmed: false } }
		]
	};
	const out = fitDraft(draft, title);
	expect(out.canvas).toEqual({ w: 1000, h: 625 });
	expect(out.titleBlock).toEqual(title);
	expect(out.segments[0]!.points).toEqual(draft.segments[0]!.points);
	expect(out.segments[0]!.confidence).toBe(0.9);
	expect(out.segments[1]!.points[2]).toEqual([900, 625]);
	expect(out.segments[1]!.labelPos).toEqual([750, 625]);
	expect(out.outlines[0]!.points[1]).toEqual([1000, 625]);
	expect(out.underlay?.imageRef).toBe('ref');
	expect(Blueprint.safeParse(out).success).toBe(true);
});

const geometry: FloorplanGeometry = {
	canvas: { w: 1000, h: 500 },
	crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
	envelope: { x: 10, y: 10, w: 80, h: 80 },
	walls: [[[0, 0], [1000, 0]]],
	rooms: [
		{ shape: 'rect', points: [[0, 0], [100, 100]] },
		{ shape: 'polygon', points: [[200, 0], [400, 0], [400, 200], [300, 200], [300, 100], [200, 100]] }
	],
	stats: { inkMode: 'colour', doubleLine: true, furniture: 0, components: 2 }
};

test('localDraft builds a valid v2 blueprint from the CV geometry', () => {
	const bp = localDraft(geometry, title, 'img');
	expect(Blueprint.safeParse(bp).success).toBe(true);
	expect(bp.walls).toEqual([{ id: 'w1', a: [0, 0], b: [1000, 0] }]);
	expect(bp.segments.map((s) => [s.name, s.shape])).toEqual([['Area 1', 'rect'], ['Area 2', 'polygon']]);
	expect(bp.segments[0]!.labelPos).toEqual([50, 50]);
	expect(bp.segments[0]!.stations).toEqual({ count: 0, layout: 'grid', confirmed: false });
	expect(bp.underlay).toEqual({ imageRef: 'img', opacity: 0.35, crop: geometry.crop });
	expect(localDraft(geometry, title).underlay).toBeUndefined();
});

test('applyDraft keeps current walls or segments rescaled onto the draft canvas', () => {
	const current: Blueprint = {
		...emptyBlueprint('Mine'),
		canvas: { w: 1000, h: 1000 },
		walls: [{ id: 'w9', a: [0, 500], b: [1000, 500] }],
		outlines: [{ id: 'r1', kind: 'room', points: [[0, 0], [10, 0], [10, 10]], closed: true, label: 'WC' }],
		segments: [{ id: 'mine', name: 'Mine', shape: 'rect', points: [[0, 0], [500, 1000]], labelPos: [250, 500], stations: { count: 3, layout: 'row', confirmed: true } }]
	};
	const draft = { ...localDraft(geometry, title, 'img'), outlines: [{ id: 'r1', kind: 'room' as const, points: [[0, 0], [5, 0], [5, 5]] as [number, number][], closed: true, label: 'Kitchen' }] };

	const all = applyDraft(current, draft, { walls: true, segments: true });
	expect(all.walls).toEqual(draft.walls);
	expect(all.segments).toEqual(draft.segments);
	expect(all.titleBlock).toEqual(current.titleBlock);
	expect(all.underlay?.crop).toEqual(geometry.crop);

	const wallsOnly = applyDraft(current, draft, { walls: true, segments: false });
	expect(wallsOnly.segments[0]!.points).toEqual([[0, 0], [500, 500]]);
	expect(wallsOnly.outlines.map((o) => o.label)).toEqual(['WC']);

	const segsOnly = applyDraft(current, draft, { walls: false, segments: true });
	expect(segsOnly.walls).toEqual([{ id: 'w9', a: [0, 250], b: [1000, 250] }]);
	expect(segsOnly.outlines.map((o) => o.label)).toEqual(['Kitchen']);
	expect(Blueprint.safeParse(segsOnly).success).toBe(true);
});
