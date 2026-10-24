import { expect, test } from 'bun:test';
import { emptyBlueprint, type Blueprint } from './blueprint';
import { parseMarkup, serializeMarkup } from './markup';

const src = `title "Vibeathon #3" date 2026-10-24 rev B
# comment
segment "Hall A" rect 100,100 300x200 stations 12 grid
segment "Lounge" poly 500,100 800,100 800,400 600,400 stations 6 row unconfirmed confidence 0.4
`;

test('parses markup', () => {
	const r = parseMarkup(src);
	expect(r.ok).toBe(true);
	if (!r.ok) return;
	const [a, b] = r.blueprint.segments;
	expect(r.blueprint.titleBlock).toEqual({ project: 'Vibeathon #3', date: '2026-10-24', rev: 'B' });
	expect(a!.id).toBe('seg_hall_a');
	expect(a!.points).toEqual([[100, 100], [400, 300]]);
	expect(a!.labelPos).toEqual([250, 200]);
	expect(b!.shape).toBe('polygon');
	expect(b!.stations).toEqual({ count: 6, layout: 'row', confirmed: false });
	expect(b!.confidence).toBe(0.4);
});

test('round-trips losslessly', () => {
	const r = parseMarkup(src);
	if (!r.ok) throw new Error('parse failed');
	const again = parseMarkup(serializeMarkup(r.blueprint), r.blueprint);
	expect(again).toEqual(r);
});

test('preserves outlines and underlay from base', () => {
	const base: Blueprint = {
		...emptyBlueprint(),
		underlay: { imageRef: 'abc', opacity: 0.3 },
		outlines: [{ id: 'o1', kind: 'wall', points: [[0, 0], [10, 0]], closed: false }]
	};
	const r = parseMarkup(src, base);
	expect(r.ok && r.blueprint.underlay?.imageRef).toBe('abc');
	expect(r.ok && r.blueprint.outlines.length).toBe(1);
});

test('reports errors with line numbers', () => {
	const r = parseMarkup('segment "X" rect 1,1 stations 2 grid\nbogus\nsegment "Y" poly 1,1 2,2 stations 1 grid');
	expect(r.ok).toBe(false);
	if (r.ok) return;
	expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
});

test('dedupes generated ids and quotes names', () => {
	const r = parseMarkup('segment "A \\"x\\"" rect 0,0 10x10 stations 1 grid\nsegment "A \\"x\\"" rect 0,0 10x10 stations 1 grid');
	expect(r.ok).toBe(true);
	if (!r.ok) return;
	expect(r.blueprint.segments.map((s) => s.id)).toEqual(['seg_a_x', 'seg_a_x_2']);
	expect(r.blueprint.segments[0]!.name).toBe('A "x"');
	const again = parseMarkup(serializeMarkup(r.blueprint));
	expect(again.ok && again.blueprint.segments[0]!.name).toBe('A "x"');
});
