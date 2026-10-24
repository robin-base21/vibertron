/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { Blueprint, emptyBlueprint } from 'common';
import { fitDraft, localDraft } from './draft';

const title = { project: 'P', date: '2026-10-24', rev: 'C' };

test('fitDraft rescales AI rects to the canvas, keeps polygons, takes the title block', () => {
	const draft: Blueprint = {
		...emptyBlueprint('Server'),
		underlay: { imageRef: 'ref', opacity: 0.35 },
		outlines: [{ id: 'o1', kind: 'wall', points: [[0, 0], [1000, 700]], closed: false }],
		segments: [
			{ id: 's1', name: 'Hall', shape: 'rect', points: [[100, 200], [500, 600]], labelPos: [300, 400], stations: { count: 8, layout: 'grid', confirmed: false }, confidence: 0.9 },
			{ id: 's2', name: 'Lab', shape: 'polygon', points: [[600, 100], [900, 100], [900, 400]], labelPos: [750, 250], stations: { count: 4, layout: 'grid', confirmed: false } }
		]
	};
	const out = fitDraft(draft, { w: 1000, h: 625 }, title);
	expect(out.canvas).toEqual({ w: 1000, h: 625 });
	expect(out.titleBlock).toEqual(title);
	expect(out.segments[0]!.points).toEqual([[100, 125], [500, 375]]);
	expect(out.segments[0]!.labelPos).toEqual([300, 250]);
	expect(out.segments[0]!.confidence).toBe(0.9);
	expect(out.segments[1]!.points).toEqual(draft.segments[1]!.points);
	expect(out.outlines[0]!.points[1]).toEqual([1000, 625]);
	expect(out.underlay?.imageRef).toBe('ref');
	expect(Blueprint.safeParse(out).success).toBe(true);
});

test('localDraft builds a valid blueprint from contours', () => {
	const bp = localDraft(
		{ canvas: { w: 1000, h: 500 }, candidates: [[[0, 0], [100, 0], [100, 100], [0, 100]]], outlines: [[[0, 0], [10, 10]]] },
		title,
		'img'
	);
	expect(Blueprint.safeParse(bp).success).toBe(true);
	expect(bp.segments[0]!.labelPos).toEqual([50, 50]);
	expect(bp.segments[0]!.stations.confirmed).toBe(false);
	expect(bp.outlines[0]!.closed).toBe(false);
	expect(bp.underlay).toEqual({ imageRef: 'img', opacity: 0.35 });
	expect(localDraft({ canvas: { w: 1, h: 1 }, candidates: [], outlines: [] }, title).underlay).toBeUndefined();
});
