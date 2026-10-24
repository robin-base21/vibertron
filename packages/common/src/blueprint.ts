import { z } from 'zod';

// Blueprint scene graph. All coordinates are normalized to the canvas (default 1000x1000).

export const Point = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof Point>;

export const StationLayout = z.enum(['grid', 'row']);
export type StationLayout = z.infer<typeof StationLayout>;

export const Segment = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(60),
	shape: z.enum(['rect', 'polygon']),
	// rect: [[x, y], [x + w, y + h]]; polygon: >= 3 vertices
	points: z.array(Point).min(2),
	labelPos: Point,
	stations: z.object({
		count: z.number().int().min(0).max(500),
		layout: StationLayout,
		confirmed: z.boolean()
	}),
	// Set when AI suggested the segment; renderers show low values dashed with a "?" badge.
	confidence: z.number().min(0).max(1).optional()
});
export type Segment = z.infer<typeof Segment>;

export const Outline = z.object({
	id: z.string().min(1),
	kind: z.enum(['wall', 'room']),
	points: z.array(Point).min(2),
	closed: z.boolean().default(true),
	// Room name for non-work areas ("Kitchen", "WC"), drawn as a small label at the outline's center.
	label: z.string().min(1).max(60).optional()
});
export type Outline = z.infer<typeof Outline>;

/** A straight wall segment: the editable floorplan drawing under the segments. */
export const Wall = z.object({
	id: z.string().min(1),
	a: Point,
	b: Point
});
export type Wall = z.infer<typeof Wall>;

export const Blueprint = z.object({
	schemaVersion: z.literal(1),
	canvas: z.object({ w: z.number().positive(), h: z.number().positive() }),
	underlay: z
		.object({
			imageRef: z.string(),
			opacity: z.number().min(0).max(1),
			// Part of the source image the canvas maps to, as fractions of its width/height
			// (the building envelope). Absent: the whole image fills the canvas.
			crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }).optional()
		})
		.optional(),
	walls: z.array(Wall).default([]),
	outlines: z.array(Outline),
	segments: z.array(Segment),
	titleBlock: z.object({
		project: z.string(),
		date: z.string(),
		rev: z.string()
	})
});
export type Blueprint = z.infer<typeof Blueprint>;

export const LOW_CONFIDENCE = 0.6;

export function emptyBlueprint(project = 'Untitled', date = new Date().toISOString().slice(0, 10)): Blueprint {
	return {
		schemaVersion: 1,
		canvas: { w: 1000, h: 1000 },
		walls: [],
		outlines: [],
		segments: [],
		titleBlock: { project, date, rev: 'A' }
	};
}

export function stationId(segmentId: string, index: number): string {
	return `${segmentId}-${String(index + 1).padStart(2, '0')}`;
}

export function stationIds(segment: Segment): string[] {
	return Array.from({ length: segment.stations.count }, (_, i) => stationId(segment.id, i));
}

export function parseStationId(id: string): { segmentId: string; index: number } | null {
	const m = /^(.+)-(\d+)$/.exec(id);
	if (!m) return null;
	return { segmentId: m[1]!, index: Number(m[2]) - 1 };
}

export function totalStations(bp: Blueprint): number {
	return bp.segments.reduce((sum, s) => sum + s.stations.count, 0);
}

export function unconfirmedSegments(bp: Blueprint): Segment[] {
	return bp.segments.filter((s) => !s.stations.confirmed);
}

export function bounds(points: Point[]): { x: number; y: number; w: number; h: number } {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function centroid(points: Point[]): Point {
	const b = bounds(points);
	return [b.x + b.w / 2, b.y + b.h / 2];
}

/**
 * Station symbol centers inside a segment's bounding box (inset by `pad`). `top` reserves an extra
 * band at the top (renderers keep the segment label there so it never covers a station).
 */
export function stationPositions(segment: Segment, pad = 12, top = 0): Point[] {
	const n = segment.stations.count;
	if (n === 0) return [];
	const b = bounds(segment.points);
	const w = Math.max(b.w - pad * 2, 1);
	const h = Math.max(b.h - pad * 2 - top, 1);
	let cols: number;
	let rows: number;
	if (segment.stations.layout === 'row') {
		const horizontal = w >= h;
		cols = horizontal ? n : 1;
		rows = horizontal ? 1 : n;
	} else {
		cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
		rows = Math.ceil(n / cols);
	}
	const out: Point[] = [];
	for (let i = 0; i < n; i++) {
		const c = i % cols;
		const r = Math.floor(i / cols);
		out.push([b.x + pad + (w * (c + 0.5)) / cols, b.y + pad + top + (h * (r + 0.5)) / rows]);
	}
	return out;
}
