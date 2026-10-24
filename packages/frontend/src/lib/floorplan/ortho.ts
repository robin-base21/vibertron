import type { Point, Wall } from 'common';
import { polyArea, simplifyOrtho } from './pipeline';

// Orthogonal geometry for the editor: wall snapping and polygon clean-up. Pure, unit-tested.

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Makes every polygon edge horizontal or vertical (each keeps its dominant direction), then drops
 * duplicate and collinear vertices. Returns null when fewer than 4 vertices remain.
 */
export function orthogonalize(points: Point[]): Point[] | null {
	if (points.length < 3) return null;
	const out: Point[] = [[points[0]![0], points[0]![1]]];
	for (let i = 1; i < points.length; i++) {
		const prev = out[out.length - 1]!;
		const p = points[i]!;
		const dx = Math.abs(p[0] - prev[0]);
		const dy = Math.abs(p[1] - prev[1]);
		out.push(dx >= dy ? [p[0], prev[1]] : [prev[0], p[1]]);
	}
	// close the loop with one corner if the last point isn't aligned with the first; of the two
	// possible corners take the one that keeps more area (the other folds the shape back)
	const first = out[0]!;
	const last = out[out.length - 1]!;
	let simplified = simplifyOrtho(out);
	if (last[0] !== first[0] && last[1] !== first[1]) {
		const options = ([[first[0], last[1]], [last[0], first[1]]] as Point[]).map((c) => simplifyOrtho([...out, c]));
		simplified = options.reduce((m, o) => (Math.abs(polyArea(o)) > Math.abs(polyArea(m)) ? o : m));
	}
	return simplified.length >= 4 ? simplified : null;
}

export interface WallSnap {
	p: Point;
	/** What the point snapped to (null: nothing, the caller may grid-snap). */
	kind: 'endpoint' | 'line' | null;
}

/** Snap a wall end to another wall's endpoint, else onto another wall's line (within `tol`). */
export function snapWallPoint(p: Point, walls: Wall[], tol: number, excludeId?: string): WallSnap {
	let best: Point | null = null;
	let bestD = tol;
	for (const w of walls) {
		if (w.id === excludeId) continue;
		for (const e of [w.a, w.b]) {
			const d = dist(p, e);
			if (d <= bestD) {
				bestD = d;
				best = e;
			}
		}
	}
	if (best) return { p: [best[0], best[1]], kind: 'endpoint' };
	bestD = tol;
	let onLine: Point | null = null;
	for (const w of walls) {
		if (w.id === excludeId) continue;
		const dx = w.b[0] - w.a[0];
		const dy = w.b[1] - w.a[1];
		const len2 = dx * dx + dy * dy;
		if (!len2) continue;
		const t = ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / len2;
		if (t < 0 || t > 1) continue;
		const q: Point = [w.a[0] + t * dx, w.a[1] + t * dy];
		const d = dist(p, q);
		if (d <= bestD) {
			bestD = d;
			// keep exact coordinates on axis-aligned walls
			onLine = dx === 0 ? [w.a[0], q[1]] : dy === 0 ? [q[0], w.a[1]] : q;
		}
	}
	return onLine ? { p: onLine, kind: 'line' } : { p, kind: null };
}

/** Constrain `b` so the segment a→b is horizontal or vertical (whichever is closer). */
export function orthoEnd(a: Point, b: Point): Point {
	return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]];
}

/**
 * Snap each coordinate of a segment point to a parallel axis-aligned wall within `tol` whose span
 * covers the point. Returns which axes snapped so the caller can grid-snap the rest.
 */
export function snapToWalls(p: Point, walls: Wall[], tol: number): { p: Point; x: boolean; y: boolean } {
	let x = p[0];
	let y = p[1];
	let bx = tol;
	let by = tol;
	let sx = false;
	let sy = false;
	for (const w of walls) {
		if (w.a[0] === w.b[0]) {
			const lo = Math.min(w.a[1], w.b[1]) - tol;
			const hi = Math.max(w.a[1], w.b[1]) + tol;
			const d = Math.abs(p[0] - w.a[0]);
			if (p[1] >= lo && p[1] <= hi && d <= bx) {
				bx = d;
				x = w.a[0];
				sx = true;
			}
		} else if (w.a[1] === w.b[1]) {
			const lo = Math.min(w.a[0], w.b[0]) - tol;
			const hi = Math.max(w.a[0], w.b[0]) + tol;
			const d = Math.abs(p[1] - w.a[1]);
			if (p[0] >= lo && p[0] <= hi && d <= by) {
				by = d;
				y = w.a[1];
				sy = true;
			}
		}
	}
	return { p: [x, y], x: sx, y: sy };
}
