import { describe, expect, test } from 'bun:test';
import type { AnalyzeRoom, Point } from 'common';
import { analyzeFloorplan, boxToRect, fitZone, isLegacy, wallAxes } from '../src/ai/analyze';
import type { BuildInput } from '../src/ai/draft';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const canvas = { w: 1000, h: 500 };

const walls: [Point, Point][] = [
	// envelope
	[[0, 0], [1000, 0]],
	[[1000, 0], [1000, 500]],
	[[0, 500], [1000, 500]],
	[[0, 0], [0, 500]],
	// interior
	[[400, 0], [400, 500]],
	[[0, 250], [400, 250]],
	[[700, 0], [700, 200]]
];

const rooms: AnalyzeRoom[] = [
	{ shape: 'rect', points: [[0, 0], [400, 250]] },
	{ shape: 'rect', points: [[400, 500], [0, 250]] }, // unordered corners on purpose
	{ shape: 'polygon', points: [[400, 0], [1000, 0], [1000, 500], [400, 500]] },
	{ shape: 'rect', points: [[700, 0], [1000, 200]] }
];

const input: BuildInput = {
	imageRef: 'a'.repeat(32),
	project: 'V2 Event',
	date: '2026-10-24',
	canvas,
	crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.5 },
	rooms,
	walls
};

const zone = (name: string, kind: string, box: number[]) => ({ name, kind, box });

const reply = {
	rooms: [
		{ index: 1, name: 'Kitchen', kind: 'kitchen', confidence: 0.9, zones: [] },
		{ index: 2, name: 'Workshop', kind: 'work', confidence: 0.8, zones: [] },
		{
			index: 3,
			name: 'Open Space',
			kind: 'work',
			confidence: 0.7,
			zones: [
				zone('Desks North', 'work', [20, 410, 390, 690]),
				zone('Desks South', 'work', [600, 300, 980, 900]),
				zone('Lounge Corner', 'lounge', [500, 920, 700, 990]),
				zone('Speck', 'work', [0, 0, 5, 5])
			]
		},
		// room 4 is skipped by the model; bad and duplicate indices are ignored
		{ index: 99, name: 'Ghost', kind: 'work', confidence: 1, zones: [] },
		{ index: 1, name: 'Duplicate', kind: 'work', confidence: 1, zones: [] }
	],
	extraZones: [zone('Annex Tables', 'work', [0, 0, 100, 100])]
};

function mockFetch(...replies: (string | Error)[]) {
	const calls: any[] = [];
	const fn = (async (_url: string, init: RequestInit) => {
		calls.push(JSON.parse(String(init.body)));
		const r = replies.shift();
		if (r === undefined) throw new Error('no more replies');
		if (r instanceof Error) throw r;
		return Response.json({ choices: [{ message: { content: r } }] });
	}) as unknown as typeof fetch;
	return { fn, calls };
}
const cfg = (fn: typeof fetch, apiKey = 'sk-test') => ({ apiKey, model: 'any/model', fetch: fn });
const image = { bytes: JPEG, contentType: 'image/jpeg' };

describe('analyze v2', () => {
	test('request: image, numbered room list in model space, strict model-agnostic schema', async () => {
		const { fn, calls } = mockFetch(JSON.stringify(reply));
		await analyzeFloorplan(cfg(fn), image, input);
		const body = calls[0];
		expect(body.model).toBe('any/model');
		expect(body.response_format.json_schema.strict).toBe(true);
		expect(body.response_format.json_schema.name).toBe('floorplan_rooms');
		const schema = body.response_format.json_schema.schema;
		expect(schema.required).toEqual(['rooms', 'extraZones']);
		expect(schema.properties.rooms.items.properties.kind.enum).toContain('toilet');
		expect(JSON.stringify(schema)).not.toContain('suggestedStations');
		const [text, img] = body.messages[1].content;
		// canvas 1000x500 -> model space stretches y by 2; boxes are [ymin, xmin, ymax, xmax]
		expect(text.text).toContain('1: box [0,0,500,400]');
		expect(text.text).toContain('2: box [500,0,1000,400]');
		expect(text.text).toContain('3: box [0,400,1000,1000]');
		expect(img.image_url.url).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
		expect(body.messages[0].content).toContain('Do not count seats');
	});

	test('draft: segments, zone clamping + wall snapping, labelled outlines, walls, crop', async () => {
		const { fn } = mockFetch(JSON.stringify(reply));
		const result = await analyzeFloorplan(cfg(fn), image, input);
		expect(result.source).toBe('ai');
		const bp = result.blueprint;
		expect(bp.canvas).toEqual(canvas);
		expect(bp.underlay).toEqual({ imageRef: input.imageRef, opacity: 0.35, crop: input.crop });
		expect(bp.walls).toHaveLength(7);
		expect(bp.walls[4]).toEqual({ id: 'w5', a: [400, 0], b: [400, 500] });

		expect(bp.segments.map((s) => [s.id, s.name, s.shape, s.points, s.confidence])).toEqual([
			// work room without zones -> room geometry (corners normalized)
			['s1', 'Workshop', 'rect', [[0, 250], [400, 500]], 0.8],
			// x0 410 -> wall x=400, x1 690 -> wall x=700, y0 10 -> wall y=0; y1 195 has no wall in range
			['s2', 'Desks North', 'rect', [[400, 0], [700, 195]], 0.7],
			// x0 300 clamped into the room (400); y1 490 -> envelope wall y=500
			['s3', 'Desks South', 'rect', [[400, 300], [900, 500]], 0.7],
			// extra zone: no room, low confidence
			['s4', 'Annex Tables', 'rect', [[0, 0], [100, 50]], 0.5]
		]);
		expect(bp.segments.every((s) => s.stations.count === 0 && !s.stations.confirmed && s.stations.layout === 'grid')).toBe(true);

		expect(bp.outlines).toEqual([
			{ id: 'o1', kind: 'room', closed: true, label: 'Kitchen', points: [[0, 0], [400, 0], [400, 250], [0, 250]] },
			// lounge zone: x1 990 snaps to the envelope wall x=1000
			{ id: 'o2', kind: 'room', closed: true, label: 'Lounge Corner', points: [[920, 250], [1000, 250], [1000, 350], [920, 350]] },
			// room 4 was skipped by the model: unlabelled outline
			{ id: 'o3', kind: 'room', closed: true, points: [[700, 0], [1000, 0], [1000, 200], [700, 200]] }
		]);
	});

	test('non-work room with work zones keeps its label and yields zone segments', async () => {
		const r = {
			rooms: [{ index: 1, name: 'Atrium', kind: 'lounge', confidence: 0.6, zones: [zone('Hack Tables', 'work', [100, 450, 800, 950])] }],
			extraZones: []
		};
		const { fn } = mockFetch(JSON.stringify(r));
		const bp = (await analyzeFloorplan(cfg(fn), image, { ...input, rooms: [rooms[2]!] })).blueprint;
		expect(bp.segments.map((s) => [s.name, s.points])).toEqual([['Hack Tables', [[450, 50], [950, 400]]]]);
		expect(bp.outlines.map((o) => o.label)).toEqual(['Atrium']);
	});

	test('fallback: no key or AI error -> every room is "Area N", walls kept', async () => {
		const nokey = mockFetch();
		const r1 = await analyzeFloorplan(cfg(nokey.fn, ''), image, input);
		expect(nokey.calls).toHaveLength(0);
		expect(r1.source).toBe('fallback');
		expect(r1.warning).toContain('detected rooms');
		expect(r1.blueprint.segments.map((s) => [s.name, s.shape])).toEqual([
			['Area 1', 'rect'],
			['Area 2', 'rect'],
			['Area 3', 'polygon'],
			['Area 4', 'rect']
		]);
		expect(r1.blueprint.segments[1]!.points).toEqual([[0, 250], [400, 500]]);
		expect(r1.blueprint.walls).toHaveLength(7);
		expect(r1.blueprint.underlay!.crop).toEqual(input.crop!);

		const broken = mockFetch(new Error('network down'));
		const r2 = await analyzeFloorplan(cfg(broken.fn), image, input);
		expect(r2.source).toBe('fallback');
		expect(r2.blueprint.segments).toHaveLength(4);

		// invalid twice (zones box with 3 numbers) -> fallback after one retry
		const bad = JSON.stringify({ rooms: [{ index: 1, name: 'X', kind: 'work', confidence: 1, zones: [zone('Z', 'work', [1, 2, 3])] }], extraZones: [] });
		const invalid = mockFetch(bad, bad);
		const r3 = await analyzeFloorplan(cfg(invalid.fn), image, input);
		expect(invalid.calls).toHaveLength(2);
		expect(r3.source).toBe('fallback');
	});

	test('no rooms at all: v2 prompt asks for extraZones only', async () => {
		const { fn, calls } = mockFetch(JSON.stringify({ rooms: [], extraZones: [zone('Hall', 'work', [100, 100, 900, 900])] }));
		const r = await analyzeFloorplan(cfg(fn), image, { ...input, rooms: [], walls: [] });
		expect(calls[0].messages[1].content[0].text).toContain('no rooms were detected');
		expect(r.blueprint.segments[0]).toMatchObject({ name: 'Hall', points: [[100, 50], [900, 450]] });
	});

	test('legacy detection and geometry helpers', () => {
		expect(isLegacy({ ...input, rooms: [], candidates: [[[0, 0], [1, 0], [1, 1]]] })).toBe(true);
		expect(isLegacy(input)).toBe(false);
		expect(isLegacy({ ...input, rooms: [] })).toBe(false);
		expect(boxToRect([900, 800, 100, 200], canvas)).toEqual({ x0: 200, y0: 50, x1: 800, y1: 450 });
		const axes = wallAxes([[[0, 0], [3, 400]], [[0, 0], [300, 300]]], canvas);
		expect(axes.vertical).toHaveLength(1); // near-vertical accepted, diagonal ignored
		expect(axes.horizontal).toHaveLength(0);
		// a wall whose span does not overlap the zone does not attract it
		const far = wallAxes([[[105, 400], [105, 500]]], canvas);
		expect(fitZone({ x0: 100, y0: 0, x1: 300, y1: 100 }, far, { x0: 0, y0: 0, x1: 1000, y1: 500 }, canvas)!.x0).toBe(100);
	});
});
