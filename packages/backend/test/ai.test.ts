import { describe, expect, test } from 'bun:test';
import type { Point } from 'common';
import { analyzeFloorplan, fallbackBlueprint } from '../src/ai/analyze';
import { blueprintFromAreas } from '../src/ai/analyze-v1';
import type { BuildInput } from '../src/ai/draft';
import { OPENROUTER_URL, extractJson } from '../src/ai/openrouter';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const square = (x: number, y: number, s: number): Point[] => [
	[x, y],
	[x + s, y],
	[x + s, y + s],
	[x, y + s]
];
// Legacy (v1) requests: candidates, no rooms.
const input = {
	candidates: [square(100, 100, 200), square(400, 100, 200), square(700, 700, 100)],
	outlines: [
		[
			[0, 0],
			[1000, 0]
		]
	],
	imageRef: 'a'.repeat(32),
	project: 'Test Event',
	date: '2026-10-24'
} satisfies BuildInput;

/** Mock fetch returning the given assistant contents in order; records request bodies. */
function mockFetch(...replies: (string | { status: number; body: string })[]) {
	const calls: any[] = [];
	const fn = (async (url: string, init: RequestInit) => {
		expect(url).toBe(OPENROUTER_URL);
		calls.push({ headers: init.headers, body: JSON.parse(String(init.body)) });
		const r = replies.shift();
		if (r === undefined) throw new Error('no more replies');
		if (typeof r !== 'string') return new Response(r.body, { status: r.status });
		return Response.json({ choices: [{ message: { content: r } }] });
	}) as unknown as typeof fetch;
	return { fn, calls };
}

const cfg = (f: typeof fetch) => ({ apiKey: 'sk-test', model: 'test/model', fetch: f });
const area = (o: Record<string, unknown>) => ({ polygonIndex: null, name: 'X', isWorkArea: true, suggestedStations: 4, confidence: 0.9, rect: null, ...o });

describe('openrouter + analyze', () => {
	test('extractJson handles fences and prose', () => {
		expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
	});

	test('maps areas to an unconfirmed blueprint', async () => {
		const reply = JSON.stringify({
			areas: [
				area({ polygonIndex: 0, name: 'Hall A', suggestedStations: 12, confidence: 0.92 }),
				area({ polygonIndex: 1, name: 'Kitchen', isWorkArea: false, suggestedStations: 0 }),
				area({ polygonIndex: 2, name: 'Hall A', suggestedStations: 6, confidence: 0.4 }),
				area({ polygonIndex: 7, name: 'Ghost' }),
				area({ name: 'Annex', rect: { x: 900, y: 50, w: 300, h: 100 }, suggestedStations: 8, confidence: 1.4 })
			]
		});
		const { fn, calls } = mockFetch(reply);
		const result = await analyzeFloorplan(cfg(fn), { bytes: PNG, contentType: 'image/png' }, input);
		expect(result.source).toBe('ai');
		expect(result.warning).toBeUndefined();

		const sent = calls[0].body;
		expect(sent.model).toBe('test/model');
		expect(sent.response_format.type).toBe('json_schema');
		expect(sent.response_format.json_schema.strict).toBe(true);
		const parts = sent.messages[1].content;
		expect(parts[0].text).toContain('0: [[100,100],[300,100],[300,300],[100,300]]');
		expect(parts[1].image_url.url).toStartWith('data:image/png;base64,');
		expect(calls[0].headers.Authorization).toBe('Bearer sk-test');

		const bp = result.blueprint;
		expect(bp.underlay).toEqual({ imageRef: input.imageRef, opacity: 0.35 });
		expect(bp.outlines).toEqual([{ id: 'o1', kind: 'wall', points: input.outlines[0]!, closed: false }]);
		expect(bp.titleBlock).toEqual({ project: 'Test Event', date: '2026-10-24', rev: 'A' });
		expect(bp.segments.map((s) => s.name)).toEqual(['Hall A', 'Hall A 2', 'Annex']);
		const [a, b, c] = bp.segments;
		expect(a).toMatchObject({ id: 's1', shape: 'polygon', points: input.candidates[0], labelPos: [200, 200], confidence: 0.92 });
		expect(a!.stations).toEqual({ count: 12, layout: 'grid', confirmed: false });
		expect(b!.confidence).toBe(0.4);
		// rect clamped to the canvas, confidence clamped to 1
		expect(c).toMatchObject({ shape: 'rect', points: [[900, 50], [1000, 150]], confidence: 1 });
	});

	test('retries once with validation errors', async () => {
		const { fn, calls } = mockFetch('{"areas":[{"name":"Hall"}]}', JSON.stringify({ areas: [area({ polygonIndex: 0, name: 'Hall' })] }));
		const result = await analyzeFloorplan(cfg(fn), { bytes: PNG, contentType: 'image/png' }, input);
		expect(result.source).toBe('ai');
		expect(calls).toHaveLength(2);
		const retryMsgs = calls[1].body.messages;
		expect(retryMsgs.at(-2)).toEqual({ role: 'assistant', content: '{"areas":[{"name":"Hall"}]}' });
		expect(retryMsgs.at(-1).content).toContain('isWorkArea');
	});

	test('falls back after two invalid replies, on HTTP errors, and without a key', async () => {
		const bad = mockFetch('nope', 'still nope');
		const r1 = await analyzeFloorplan(cfg(bad.fn), { bytes: PNG, contentType: 'image/png' }, input);
		expect(r1.source).toBe('fallback');
		expect(r1.warning).toContain('AI analysis failed');
		expect(r1.blueprint.segments.map((s) => s.name)).toEqual(['Area 1', 'Area 2', 'Area 3']);
		expect(r1.blueprint.segments.every((s) => !s.stations.confirmed && s.confidence === undefined)).toBe(true);

		const http = mockFetch({ status: 502, body: 'bad gateway' });
		const r2 = await analyzeFloorplan(cfg(http.fn), { bytes: PNG, contentType: 'image/png' }, input);
		expect(r2.source).toBe('fallback');
		expect(r2.warning).toContain('502');

		const nokey = mockFetch();
		const r3 = await analyzeFloorplan({ apiKey: '', model: 'x', fetch: nokey.fn }, { bytes: PNG, contentType: 'image/png' }, input);
		expect(r3.source).toBe('fallback');
		expect(nokey.calls).toHaveLength(0);
	});

	test('builds on a non-square canvas: prompt in model space, rects scaled back', async () => {
		const wide = { ...input, canvas: { w: 1000, h: 500 }, candidates: [square(100, 50, 200)] };
		const reply = JSON.stringify({
			areas: [
				area({ polygonIndex: 0, name: 'Hall' }),
				area({ name: 'Annex', rect: { x: 500, y: 200, w: 300, h: 400 } }),
				area({ name: 'Edge', rect: { x: 900, y: 900, w: 200, h: 200 } })
			]
		});
		const { fn, calls } = mockFetch(reply);
		const result = await analyzeFloorplan(cfg(fn), { bytes: PNG, contentType: 'image/png' }, wide);
		// candidates go to the model stretched to the 0..1000 square
		expect(calls[0].body.messages[1].content[0].text).toContain('0: [[100,100],[300,100],[300,500],[100,500]]');
		const bp = result.blueprint;
		expect(bp.canvas).toEqual({ w: 1000, h: 500 });
		const [hall, annex, edge] = bp.segments;
		// polygons stay in canvas coordinates
		expect(hall!.points).toEqual(wide.candidates[0]!);
		// rects scale from the square onto the canvas and clamp to it
		expect(annex!.points).toEqual([[500, 100], [800, 300]]);
		expect(annex!.labelPos).toEqual([650, 200]);
		expect(edge!.points).toEqual([[900, 450], [1000, 500]]);
		expect(fallbackBlueprint(wide).canvas).toEqual({ w: 1000, h: 500 });
	});

	test('pure mapping helpers', () => {
		expect(fallbackBlueprint({ ...input, candidates: [] }).segments).toEqual([]);
		// the same polygon is never used twice
		const bp = blueprintFromAreas([area({ polygonIndex: 0, name: 'A' }), area({ polygonIndex: 0, name: 'B' })] as any, input);
		expect(bp.segments).toHaveLength(1);
	});
});
