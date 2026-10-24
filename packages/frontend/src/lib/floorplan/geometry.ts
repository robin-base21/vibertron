// Pure geometry for the floorplan contour pass. No OpenCV or DOM here, so it is unit-testable
// with `bun test` and shared by the worker.

export type Pt = [number, number];

export const MAX_SIDE = 1600;
export const MAX_CANDIDATES = 80;
export const MAX_OUTLINES = 400;
export const CANVAS_LONG_SIDE = 1000;

export interface ContourInput {
	points: Pt[];
	/** Index of the parent contour from RETR_TREE (-1 for top level). */
	parent?: number;
}

export interface ContourResult {
	canvas: { w: number; h: number };
	candidates: Pt[][];
	outlines: Pt[][];
}

/** Scale factor that brings the longest image side down to `max` (never upscales). */
export function downscaleFactor(w: number, h: number, max = MAX_SIDE): number {
	const long = Math.max(w, h);
	return long > max ? max / long : 1;
}

/** Canvas size for an image: the long side is 1000, the short side keeps the aspect ratio. */
export function canvasFor(w: number, h: number): { w: number; h: number } {
	if (w >= h) return { w: CANVAS_LONG_SIDE, h: Math.max(1, Math.round((CANVAS_LONG_SIDE * h) / w)) };
	return { w: Math.max(1, Math.round((CANVAS_LONG_SIDE * w) / h)), h: CANVAS_LONG_SIDE };
}

export function polygonArea(pts: Pt[]): number {
	let a = 0;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
	return Math.abs(a / 2);
}

export function bbox(pts: Pt[]) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of pts) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function perimeter(pts: Pt[], closed = true): number {
	let p = 0;
	const n = closed ? pts.length : pts.length - 1;
	for (let i = 0; i < n; i++) {
		const a = pts[i]!;
		const b = pts[(i + 1) % pts.length]!;
		p += Math.hypot(b[0] - a[0], b[1] - a[1]);
	}
	return p;
}

/** True when the contour hugs the image frame (the paper edge or a full-page border). */
export function isFrameBorder(pts: Pt[], w: number, h: number, margin = 0.02): boolean {
	const b = bbox(pts);
	const mx = w * margin;
	const my = h * margin;
	return b.x <= mx && b.y <= my && b.x + b.w >= w - mx && b.y + b.h >= h - my;
}

function iou(a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>): number {
	const x0 = Math.max(a.x, b.x);
	const y0 = Math.max(a.y, b.y);
	const x1 = Math.min(a.x + a.w, b.x + b.w);
	const y1 = Math.min(a.y + a.h, b.y + b.h);
	const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
	const union = a.w * a.h + b.w * b.h - inter;
	return union > 0 ? inter / union : 0;
}

export interface FilterOptions {
	/** Image size in pixels (after downscaling). */
	w: number;
	h: number;
	/** Fraction of the image area below which a room candidate is dropped. */
	minRoomArea?: number;
	/** Fraction of the image area above which a contour is dropped. */
	maxArea?: number;
	/** Outlines shorter than this fraction of the image diagonal are dropped. */
	minOutlineLength?: number;
}

/**
 * Turn raw contours (pixel coords, already approxPolyDP-simplified) into room candidates and
 * wall outlines, normalized to the canvas. Candidates: closed, room-sized polygons, deduped
 * (RETR_TREE returns both sides of a thick wall), largest first. Outlines: every non-trivial
 * contour, longest first.
 */
export function filterContours(contours: ContourInput[], opts: FilterOptions): ContourResult {
	const { w, h } = opts;
	const imgArea = w * h;
	const minRoom = (opts.minRoomArea ?? 0.004) * imgArea;
	const maxArea = (opts.maxArea ?? 0.9) * imgArea;
	const minLen = (opts.minOutlineLength ?? 0.02) * Math.hypot(w, h);

	const kept = contours
		.map((c) => ({ ...c, area: polygonArea(c.points), box: bbox(c.points), len: perimeter(c.points) }))
		.filter((c) => c.points.length >= 2 && c.area <= maxArea && !isFrameBorder(c.points, w, h));

	const rooms = kept
		.filter((c) => c.points.length >= 3 && c.area >= minRoom)
		// Reject slivers (wall segments traced as thin closed shapes).
		.filter((c) => Math.min(c.box.w, c.box.h) >= Math.max(w, h) * 0.02 && c.area >= 0.35 * c.box.w * c.box.h)
		.sort((a, b) => b.area - a.area);

	const candidates: typeof rooms = [];
	for (const r of rooms) {
		const dup = candidates.some((c) => iou(c.box, r.box) > 0.85 && Math.min(c.area, r.area) / Math.max(c.area, r.area) > 0.8);
		if (!dup) candidates.push(r);
		if (candidates.length >= MAX_CANDIDATES) break;
	}

	const outlines = kept
		.filter((c) => c.len >= minLen)
		.sort((a, b) => b.len - a.len)
		.slice(0, MAX_OUTLINES);

	const canvas = canvasFor(w, h);
	const toCanvas = normalizer(w, h, canvas);
	return {
		canvas,
		candidates: candidates.map((c) => c.points.map(toCanvas)),
		outlines: outlines.map((c) => c.points.map(toCanvas))
	};
}

/** Pixel -> canvas coordinates, rounded to 0.1 units and clamped to the canvas. */
export function normalizer(w: number, h: number, canvas = canvasFor(w, h)) {
	const s = canvas.w / w;
	const r = (v: number, max: number) => Math.round(Math.max(0, Math.min(max, v)) * 10) / 10;
	return ([x, y]: Pt): Pt => [r(x * s, canvas.w), r(y * s, canvas.h)];
}

/** Flat Int32 contour data (OpenCV `Mat.data32S`) -> points. */
export function unflatten(data: ArrayLike<number>): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i + 1 < data.length; i += 2) out.push([data[i]!, data[i + 1]!]);
	return out;
}
