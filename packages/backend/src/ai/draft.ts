import { centroid, type AnalyzeBody, type AnalyzeRoom, type Blueprint, type Outline, type Point, type Segment } from 'common';

// Shared helpers for building draft blueprints from the analyze request (v1 and v2).

export interface Canvas {
	w: number;
	h: number;
}

export interface BuildInput {
	imageRef: string;
	project: string;
	date?: string;
	/** Canvas all geometry uses; defaults to 1000x1000. */
	canvas?: Canvas;
	/** Building envelope as fractions of the original image (v2). */
	crop?: AnalyzeBody['crop'];
	/** v2: CV rooms in canvas coordinates, numbered on the marked image (see ROOM_MARK_BASE). */
	rooms?: AnalyzeRoom[];
	/** v2: wall segments in canvas coordinates. */
	walls?: [Point, Point][];
	/** Legacy v1: candidate polygons in canvas coordinates. */
	candidates?: Point[][];
	/** Legacy v1: decorative outlines. */
	outlines?: Point[][];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (p: Point): Point => [Math.round(p[0]), Math.round(p[1])];
export const canvasOf = (input: BuildInput): Canvas => input.canvas ?? { w: 1000, h: 1000 };

/** Canvas coordinates -> the 0..1000 (per axis) space of the image the model sees. */
export function toModelSpace(points: Point[], canvas: Canvas): Point[] {
	return points.map(([x, y]) => [(x * 1000) / canvas.w, (y * 1000) / canvas.h]);
}

export function baseBlueprint(input: BuildInput): Blueprint {
	const underlay: NonNullable<Blueprint['underlay']> = { imageRef: input.imageRef, opacity: 0.35 };
	if (input.crop) underlay.crop = input.crop;
	return {
		schemaVersion: 1,
		canvas: canvasOf(input),
		underlay,
		walls: (input.walls ?? []).map(([a, b], i) => ({ id: `w${i + 1}`, a: round(a), b: round(b) })),
		outlines: (input.outlines ?? []).map(
			(points, i): Outline => ({ id: `o${i + 1}`, kind: 'wall', points: points.map(round), closed: points.length > 2 })
		),
		segments: [],
		titleBlock: { project: input.project, date: input.date ?? new Date().toISOString().slice(0, 10), rev: 'A' }
	};
}

export function makeSegment(id: string, name: string, shape: Segment['shape'], points: Point[], count = 0, confidence?: number): Segment {
	const s: Segment = { id, name, shape, points, labelPos: round(centroid(points)), stations: { count, layout: 'grid', confirmed: false } };
	if (confidence !== undefined) s.confidence = confidence;
	return s;
}

/** Room geometry as segment geometry: rects normalized to [[x0,y0],[x1,y1]], polygons rounded. */
export function roomGeometry(room: AnalyzeRoom): { shape: Segment['shape']; points: Point[] } {
	if (room.shape === 'rect' || room.points.length === 2) {
		const b = rectOf(room.points);
		return { shape: 'rect', points: [round([b.x0, b.y0]), round([b.x1, b.y1])] };
	}
	return { shape: 'polygon', points: room.points.map(round) };
}

/** Room geometry as a closed outline polygon (rects expanded to 4 corners). */
export function roomPolygon(room: AnalyzeRoom): Point[] {
	const g = roomGeometry(room);
	if (g.shape === 'polygon') return g.points;
	const [[x0, y0], [x1, y1]] = g.points as [Point, Point];
	return [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1]
	];
}

export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export function rectOf(points: Point[]): Rect {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Returns a function that de-duplicates names case-insensitively ("Hall", "Hall 2", ...). */
export function nameDeduper() {
	const used = new Map<string, number>();
	return (name: string) => {
		const key = name.toLowerCase();
		const n = (used.get(key) ?? 0) + 1;
		used.set(key, n);
		return n === 1 ? name : `${name.slice(0, 56)} ${n}`;
	};
}
