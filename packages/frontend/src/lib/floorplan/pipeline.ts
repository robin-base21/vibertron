import type { AnalyzeRoom, Point } from 'common';

// Floorplan CV pipeline (v2). Pure: takes an OpenCV.js instance and RGBA pixels, returns the
// building envelope, axis-aligned walls and room shapes in canvas coordinates. Shared by the
// worker and the bun fixture test, so no DOM APIs here.
//
// Steps: ink mask (colour, Otsu fallback) → long-line wall mask → envelope crop → wall vectors
// → rooms (free space between walls with door gaps bridged, furniture dropped) → orthogonal shapes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export interface Raster {
	data: ArrayLike<number>;
	width: number;
	height: number;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface FloorplanGeometry {
	/** Long side 1000, envelope aspect ratio. */
	canvas: { w: number; h: number };
	/** Envelope as fractions of the raster (the underlay crop). */
	crop: Rect;
	/** Envelope in raster pixels. */
	envelope: Rect;
	/** Axis-aligned wall segments in canvas coordinates. */
	walls: [Point, Point][];
	/** Rooms in canvas coordinates: rects as 2 corners, otherwise orthogonal polygons. */
	rooms: AnalyzeRoom[];
	stats: { inkMode: 'colour' | 'otsu'; doubleLine: boolean; furniture: number; components: number };
}

export const CANVAS_LONG_SIDE = 1000;
export const MAX_ROOMS = 80;
export const MAX_WALLS = 600;

/** Internal axis-aligned line in raster px: `c` is y for horizontal lines, x for vertical. */
interface Line {
	horizontal: boolean;
	c: number;
	s0: number;
	s1: number;
	/** Band thickness in px (perpendicular to the line). */
	thick: number;
}

// ---------------------------------------------------------------- 1. ink mask

function median(hist: Uint32Array, n: number): number {
	let acc = 0;
	for (let i = 0; i < hist.length; i++) {
		acc += hist[i]!;
		if (acc * 2 >= n) return i;
	}
	return hist.length - 1;
}

function otsu(hist: Uint32Array, n: number): number {
	let sum = 0;
	for (let i = 0; i < 256; i++) sum += i * hist[i]!;
	let sumB = 0;
	let wB = 0;
	let best = 0;
	let t = 128;
	for (let i = 0; i < 256; i++) {
		wB += hist[i]!;
		if (!wB) continue;
		const wF = n - wB;
		if (!wF) break;
		sumB += i * hist[i]!;
		const mB = sumB / wB;
		const mF = (sum - sumB) / wF;
		const between = wB * wF * (mB - mF) ** 2;
		if (between > best) {
			best = between;
			t = i;
		}
	}
	return t;
}

/**
 * Ink = strong luminance contrast against the (median) background and low saturation, which
 * removes coloured grids. Works for light-on-dark and dark-on-light plans. Falls back to Otsu on
 * luminance when the background isn't uniform or the colour rule finds implausibly little/much ink.
 */
export function inkMask(img: Raster): { mask: Uint8Array; mode: 'colour' | 'otsu' } {
	const n = img.width * img.height;
	const d = img.data;
	const lum = new Uint8Array(n);
	const sat = new Uint8Array(n); // 0..100
	const lumHist = new Uint32Array(256);
	const satHist = new Uint32Array(101);
	for (let i = 0; i < n; i++) {
		const r = d[i * 4]!;
		const g = d[i * 4 + 1]!;
		const b = d[i * 4 + 2]!;
		const mx = Math.max(r, g, b);
		const mn = Math.min(r, g, b);
		const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
		const s = mx ? Math.round(((mx - mn) / mx) * 100) : 0;
		lum[i] = l;
		sat[i] = s;
		lumHist[l]!++;
		satHist[s]!++;
	}
	const bgLum = median(lumHist, n);
	const bgSat = median(satHist, n) / 100;
	let near = 0;
	for (let l = Math.max(0, bgLum - 25); l <= Math.min(255, bgLum + 25); l++) near += lumHist[l]!;

	const mask = new Uint8Array(n);
	const lightInk = bgLum < 128;
	if (near / n >= 0.5) {
		const range = lightInk ? 255 - bgLum : bgLum;
		const thr = Math.max(35, Math.min(70, 0.45 * range));
		const satMax = Math.max(bgSat * 0.6, 0.25) * 100;
		let count = 0;
		for (let i = 0; i < n; i++) {
			const contrast = lightInk ? lum[i]! - bgLum : bgLum - lum[i]!;
			// dark ink has unreliable saturation; light ink on a coloured grid must be desaturated
			const lowSat = sat[i]! < satMax || (!lightInk && lum[i]! < 80);
			if (contrast > thr && lowSat) {
				mask[i] = 255;
				count++;
			}
		}
		if (count / n > 0.003 && count / n < 0.35) return { mask, mode: 'colour' };
	}

	const t = otsu(lumHist, n);
	const inkDark = bgLum > t;
	for (let i = 0; i < n; i++) mask[i] = (inkDark ? lum[i]! <= t : lum[i]! > t) ? 255 : 0;
	return { mask, mode: 'otsu' };
}

// ---------------------------------------------------------------- 4. wall vectors

/**
 * Run-length scan of a single-orientation line mask: runs in consecutive rows (or columns) that
 * overlap form a band, and each band becomes one line through its middle.
 */
function scanLines(mask: Uint8Array, W: number, H: number, horizontal: boolean, env: Rect, minRun: number): Line[] {
	const pad = Math.round(minRun / 4);
	const c0 = Math.max(0, (horizontal ? env.y : env.x) - pad);
	const c1 = Math.min((horizontal ? H : W) - 1, (horizontal ? env.y + env.h : env.x + env.w) + pad);
	const s0 = Math.max(0, (horizontal ? env.x : env.y) - pad);
	const s1 = Math.min((horizontal ? W : H) - 1, (horizontal ? env.x + env.w : env.y + env.h) + pad);
	const at = horizontal ? (c: number, s: number) => mask[c * W + s]! : (c: number, s: number) => mask[s * W + c]!;

	interface Band {
		c0: number;
		c1: number;
		a: number;
		b: number;
		la: number;
		lb: number;
	}
	let active: Band[] = [];
	const out: Line[] = [];
	const close = (band: Band) => {
		out.push({ horizontal, c: (band.c0 + band.c1) / 2, s0: band.a, s1: band.b, thick: band.c1 - band.c0 + 1 });
	};
	for (let c = c0; c <= c1; c++) {
		const runs: [number, number][] = [];
		let start = -1;
		for (let s = s0; s <= s1 + 1; s++) {
			const on = s <= s1 && at(c, s) > 0;
			if (on && start < 0) start = s;
			else if (!on && start >= 0) {
				if (s - start >= minRun) runs.push([start, s - 1]);
				start = -1;
			}
		}
		const next: Band[] = [];
		const used = new Set<Band>();
		for (const [a, b] of runs) {
			const band = active.find((x) => !used.has(x) && Math.min(b, x.lb) - Math.max(a, x.la) > 0.5 * Math.min(b - a, x.lb - x.la));
			if (band) {
				used.add(band);
				band.c1 = c;
				band.a = Math.min(band.a, a);
				band.b = Math.max(band.b, b);
				band.la = a;
				band.lb = b;
				next.push(band);
			} else {
				next.push({ c0: c, c1: c, a, b, la: a, lb: b });
			}
		}
		for (const x of active) if (!used.has(x)) close(x);
		active = next;
	}
	for (const x of active) close(x);
	return out;
}

/** Merge collinear lines (|Δc| ≤ tolC) that overlap or leave a gap ≤ gap. */
export function mergeLines(lines: Line[], tolC: number, gap: number): Line[] {
	let cur = lines.map((l) => ({ ...l }));
	let changed = true;
	while (changed) {
		changed = false;
		cur.sort((p, q) => p.c - q.c || p.s0 - q.s0);
		const out: Line[] = [];
		for (const l of cur) {
			const m = out.find((o) => o.horizontal === l.horizontal && Math.abs(o.c - l.c) <= tolC && l.s0 <= o.s1 + gap && l.s1 >= o.s0 - gap);
			if (m) {
				const lm = m.s1 - m.s0 + 1;
				const ll = l.s1 - l.s0 + 1;
				m.c = (m.c * lm + l.c * ll) / (lm + ll);
				m.s0 = Math.min(m.s0, l.s0);
				m.s1 = Math.max(m.s1, l.s1);
				m.thick = Math.max(m.thick, l.thick);
				changed = true;
			} else out.push(l);
		}
		cur = out;
	}
	return cur;
}

/**
 * Double-line walls: parallel lines at most `maxGap` apart that overlap by half the shorter one
 * become one wall through their middle (spanning both). `ratio` is the paired share of the total
 * line length, which tells whether the plan draws walls as double lines at all.
 */
export function pairWalls(lines: Line[], maxGap: number, minThick: number): { walls: Line[]; ratio: number } {
	const len = (l: Line) => l.s1 - l.s0;
	const used = new Set<Line>();
	const walls: Line[] = [];
	let total = 0;
	for (const l of lines) {
		total += len(l);
		// thick bands are walls on their own (solid walls, or double lines the close already fused)
		if (l.thick >= minThick) {
			used.add(l);
			walls.push({ ...l });
		}
	}
	for (const a of lines) {
		for (const b of lines) {
			if (a === b || a.horizontal !== b.horizontal || b.c <= a.c || b.c - a.c > maxGap) continue;
			const overlap = Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0);
			if (overlap < 0.5 * Math.min(len(a), len(b))) continue;
			used.add(a);
			used.add(b);
			walls.push({ horizontal: a.horizontal, c: (a.c + b.c) / 2, s0: Math.min(a.s0, b.s0), s1: Math.max(a.s1, b.s1), thick: b.c - a.c });
		}
	}
	let pairedLen = 0;
	for (const l of used) pairedLen += len(l);
	return { walls, ratio: total ? pairedLen / total : 0 };
}

/**
 * Stairs: runs of ≥ 4 parallel lines with the same extent and regular small spacing (the treads).
 * They'd otherwise pair up into a stack of fake walls.
 */
export function dropStairs(lines: Line[], maxStep: number, tol: number): Line[] {
	const drop = new Set<Line>();
	const sorted = [...lines].sort((p, q) => p.c - q.c);
	for (const l of sorted) {
		if (drop.has(l)) continue;
		const run = [l];
		for (const m of sorted) {
			const last = run[run.length - 1]!;
			if (m.horizontal !== l.horizontal || m.c <= last.c) continue;
			if (m.c - last.c > maxStep) break;
			if (Math.abs(m.s0 - l.s0) <= tol && Math.abs(m.s1 - l.s1) <= tol) run.push(m);
		}
		if (run.length >= 4) for (const r of run) drop.add(r);
	}
	return lines.filter((l) => !drop.has(l));
}

/**
 * Door gaps to close for room detection (never emitted as walls): gaps up to `maxGap` between
 * collinear lines, and free line ends that stop up to `maxGap` short of a perpendicular line.
 */
export function doorBridges(lines: Line[], tolC: number, snapTol: number, maxGap: number): Line[] {
	const out: Line[] = [];
	const touches = (l: Line, v: number) =>
		lines.some((p) => p.horizontal !== l.horizontal && Math.abs(p.c - v) <= snapTol && l.c >= p.s0 - snapTol && l.c <= p.s1 + snapTol);
	for (const l of lines) {
		for (const dir of [-1, 1] as const) {
			const end = dir < 0 ? l.s0 : l.s1;
			if (touches(l, end)) continue;
			let best = maxGap + 1;
			// collinear neighbour beyond this end
			for (const m of lines) {
				if (m === l || m.horizontal !== l.horizontal || Math.abs(m.c - l.c) > tolC) continue;
				const gap = dir > 0 ? m.s0 - end : end - m.s1;
				if (gap > 0 && gap < best) best = gap;
			}
			// perpendicular line ahead
			for (const p of lines) {
				if (p.horizontal === l.horizontal || l.c < p.s0 - snapTol || l.c > p.s1 + snapTol) continue;
				const gap = dir > 0 ? p.c - end : end - p.c;
				if (gap > 0 && gap < best) best = gap;
			}
			if (best <= maxGap) {
				const s0 = dir > 0 ? end : end - best;
				out.push({ horizontal: l.horizontal, c: l.c, s0, s1: s0 + best, thick: 1 });
			}
		}
	}
	return out;
}

/** Splits each line where a perpendicular line meets or crosses it (T/X junctions). */
export function splitAtJunctions(lines: Line[], tol: number, minPiece: number): Line[] {
	const out: Line[] = [];
	for (const l of lines) {
		const cuts = lines
			.filter((p) => p.horizontal !== l.horizontal && l.c >= p.s0 - tol && l.c <= p.s1 + tol && p.c > l.s0 + minPiece && p.c < l.s1 - minPiece)
			.map((p) => p.c)
			.sort((a, b) => a - b);
		let s0 = l.s0;
		for (const c of [...cuts, l.s1]) {
			if (c - s0 >= minPiece || c === l.s1) {
				if (c - s0 > 0) out.push({ ...l, s0, s1: c });
				s0 = c;
			}
		}
	}
	return out;
}

/** Snap line ends onto perpendicular lines they nearly touch (T and L junctions). */
export function snapJunctions(lines: Line[], tol: number): void {
	for (const l of lines) {
		for (const end of ['s0', 's1'] as const) {
			let best: Line | null = null;
			let bestD = tol + 1;
			for (const p of lines) {
				if (p.horizontal === l.horizontal) continue;
				if (l.c < p.s0 - tol || l.c > p.s1 + tol) continue;
				const dd = Math.abs(p.c - l[end]);
				if (dd < bestD) {
					bestD = dd;
					best = p;
				}
			}
			if (best) {
				l[end] = best.c;
				best.s0 = Math.min(best.s0, l.c);
				best.s1 = Math.max(best.s1, l.c);
			}
		}
	}
}

// ---------------------------------------------------------------- 5. rooms

/** Traces the outline of a cell grid (row-major, 1 = in) as the largest rectilinear loop. */
export function traceCells(cells: Uint8Array, cw: number, ch: number): Point[] {
	const inCell = (x: number, y: number) => x >= 0 && y >= 0 && x < cw && y < ch && cells[y * cw + x] === 1;
	// directed boundary edges, interior on the right (clockwise on screen)
	const edges = new Map<string, Point[]>();
	const add = (a: Point, b: Point) => {
		const k = `${a[0]},${a[1]}`;
		const list = edges.get(k);
		if (list) list.push(b);
		else edges.set(k, [b]);
	};
	for (let y = 0; y < ch; y++) {
		for (let x = 0; x < cw; x++) {
			if (!inCell(x, y)) continue;
			if (!inCell(x, y - 1)) add([x, y], [x + 1, y]);
			if (!inCell(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
			if (!inCell(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
			if (!inCell(x - 1, y)) add([x, y + 1], [x, y]);
		}
	}
	let best: Point[] = [];
	let bestArea = 0;
	while (edges.size) {
		const [k0, list0] = edges.entries().next().value as [string, Point[]];
		const start = k0.split(',').map(Number) as Point;
		const loop: Point[] = [start];
		let prev = start;
		let cur = list0.shift()!;
		if (!list0.length) edges.delete(k0);
		let guard = 0;
		while ((cur[0] !== start[0] || cur[1] !== start[1]) && guard++ < 1e6) {
			loop.push(cur);
			const k = `${cur[0]},${cur[1]}`;
			const list = edges.get(k);
			if (!list) break;
			// at a pinch point prefer turning right, which keeps diagonal neighbours apart
			const dx = cur[0] - prev[0];
			const dy = cur[1] - prev[1];
			let idx = list.findIndex((p) => p[0] - cur[0] === -dy && p[1] - cur[1] === dx);
			if (idx < 0) idx = 0;
			const nxt = list.splice(idx, 1)[0]!;
			if (!list.length) edges.delete(k);
			prev = cur;
			cur = nxt;
		}
		const a = Math.abs(polyArea(loop));
		if (a > bestArea) {
			bestArea = a;
			best = loop;
		}
	}
	return simplifyOrtho(best);
}

export function polyArea(pts: Point[]): number {
	let a = 0;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
	return a / 2;
}

/** Drops duplicate and collinear vertices of a rectilinear loop (one at a time, so no diagonals appear). */
export function simplifyOrtho(pts: Point[]): Point[] {
	const cur = pts.slice();
	let i = 0;
	let guard = 0;
	while (cur.length > 3 && guard++ < 4 * pts.length + 8) {
		let removed = false;
		for (let k = 0; k < cur.length && cur.length > 3; k++) {
			const j = (i + k) % cur.length;
			const p = cur[(j - 1 + cur.length) % cur.length]!;
			const c = cur[j]!;
			const n = cur[(j + 1) % cur.length]!;
			const dup = c[0] === p[0] && c[1] === p[1];
			const collinear = (p[0] === c[0] && c[0] === n[0]) || (p[1] === c[1] && c[1] === n[1]);
			if (dup || collinear) {
				cur.splice(j, 1);
				i = Math.max(0, j - 1);
				removed = true;
				break;
			}
		}
		if (!removed) break;
	}
	return cur;
}

/**
 * Removes small jogs from a rectilinear loop: edge coordinates closer than `tol` are clustered
 * (snapping to wall coordinates when given), then degenerate edges vanish.
 */
export function regularize(pts: Point[], tol: number, snapX: (x: number, a: number, b: number) => number, snapY: (y: number, a: number, b: number) => number): Point[] {
	let poly = simplifyOrtho(pts);
	for (let iter = 0; iter < 6 && poly.length > 4; iter++) {
		const n = poly.length;
		// edge i runs poly[i] → poly[i+1]; rectilinear, so it's either vertical or horizontal
		const xs: { v: number; w: number; i: number }[] = [];
		const ys: { v: number; w: number; i: number }[] = [];
		for (let i = 0; i < n; i++) {
			const a = poly[i]!;
			const b = poly[(i + 1) % n]!;
			if (a[0] === b[0]) xs.push({ v: snapX(a[0], Math.min(a[1], b[1]), Math.max(a[1], b[1])), w: Math.abs(b[1] - a[1]), i });
			else ys.push({ v: snapY(a[1], Math.min(a[0], b[0]), Math.max(a[0], b[0])), w: Math.abs(b[0] - a[0]), i });
		}
		const cluster = (vals: typeof xs) => {
			const sorted = [...vals].sort((p, q) => p.v - q.v);
			const map = new Map<number, number>();
			let group: typeof xs = [];
			const flush = () => {
				// the longest edge of the group wins (it's the real wall, the rest are jogs)
				const lead = group.reduce((m, g) => (g.w > m.w ? g : m), group[0]!);
				for (const g of group) map.set(g.i, lead.v);
				group = [];
			};
			for (const v of sorted) {
				if (group.length && v.v - group[group.length - 1]!.v > tol) flush();
				group.push(v);
			}
			if (group.length) flush();
			return map;
		};
		const mx = cluster(xs);
		const my = cluster(ys);
		// vertex i sits between edge i-1 and edge i: one vertical, one horizontal
		const next: Point[] = poly.map((p, i) => {
			const ePrev = (i - 1 + n) % n;
			const x = mx.get(i) ?? mx.get(ePrev) ?? p[0];
			const y = my.get(i) ?? my.get(ePrev) ?? p[1];
			return [x, y];
		});
		const simplified = simplifyOrtho(next);
		if (simplified.length === poly.length && simplified.every((p, i) => p[0] === poly[i]![0] && p[1] === poly[i]![1])) break;
		poly = simplified;
	}
	return poly;
}

// ---------------------------------------------------------------- pipeline

export function runPipeline(cv: CV, img: Raster, onStage: (stage: string, pct: number) => void = () => {}): FloorplanGeometry {
	const W = img.width;
	const H = img.height;
	const mats: { delete(): void }[] = [];
	const track = <T extends { delete(): void }>(m: T) => (mats.push(m), m);
	const kernel = (w: number, h: number) => track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(w, h)));
	try {
		onStage('Extracting ink', 40);
		const { mask, mode } = inkMask(img);
		const ink = track(new cv.Mat(H, W, cv.CV_8UC1));
		ink.data.set(mask);

		// 2. Wall mask: long horizontal/vertical runs only; close to fuse double-line walls.
		onStage('Finding walls', 55);
		const L = Math.max(15, Math.round(Math.max(W, H) * 0.045));
		const t = Math.max(3, Math.round(Math.max(W, H) * 0.006)) | 1;
		const horiz = track(new cv.Mat());
		const vert = track(new cv.Mat());
		const walls = track(new cv.Mat());
		cv.morphologyEx(ink, horiz, cv.MORPH_OPEN, kernel(L, 1));
		cv.morphologyEx(ink, vert, cv.MORPH_OPEN, kernel(1, L));
		cv.morphologyEx(horiz, horiz, cv.MORPH_CLOSE, kernel(t, t));
		cv.morphologyEx(vert, vert, cv.MORPH_CLOSE, kernel(t, t));
		cv.bitwise_or(horiz, vert, walls);

		// 3. Envelope: the largest external contour of the wall mask.
		const cs = track(new cv.MatVector());
		const hi = track(new cv.Mat());
		const scratch = track(walls.clone());
		cv.findContours(scratch, cs, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
		let env: Rect = { x: 0, y: 0, w: W, h: H };
		let bestA = 0;
		for (let i = 0; i < cs.size(); i++) {
			const c = cs.get(i);
			const r = cv.boundingRect(c);
			c.delete();
			if (r.width * r.height > bestA) {
				bestA = r.width * r.height;
				env = { x: r.x, y: r.y, w: r.width, h: r.height };
			}
		}
		if (env.w < W * 0.15 || env.h < H * 0.15) env = { x: 0, y: 0, w: W, h: H };
		const envLong = Math.max(env.w, env.h);

		// 4. Walls → vectors.
		onStage('Vectorizing walls', 70);
		const tolC = t * 1.5;
		const snapTol = Math.max(t * 2, envLong * 0.012);
		const minWall = envLong * 0.02;
		const pairGap = Math.max(t * 2.5, envLong * 0.016);
		let lines = [
			...scanLines(horiz.data, W, H, true, env, Math.round(L / 2)),
			...scanLines(vert.data, W, H, false, env, Math.round(L / 2))
		];
		lines = dropStairs(mergeLines(lines, t / 2, t), pairGap * 1.5, t);
		const paired = pairWalls(lines, pairGap, Math.max(5, t * 0.6));
		const doubleLine = paired.ratio >= 0.4;
		// Plans drawn with double-line walls: single lines inside are furniture, drop them.
		if (doubleLine) lines = paired.walls;
		lines = mergeLines(lines, tolC, t);
		snapJunctions(lines, snapTol);
		lines = mergeLines(lines, tolC, t);
		const inEnv = (l: Line) =>
			l.horizontal
				? l.c >= env.y - t && l.c <= env.y + env.h + t
				: l.c >= env.x - t && l.c <= env.x + env.w + t;
		lines = lines
			.filter(inEnv)
			.map((l) => {
				const [lo, hi2] = l.horizontal ? [env.x, env.x + env.w] : [env.y, env.y + env.h];
				return { ...l, s0: Math.max(lo, l.s0), s1: Math.min(hi2, l.s1) };
			})
			.filter((l) => l.s1 - l.s0 >= minWall);

		// 5. Rooms: free space between the vector walls plus door bridges (gaps in a straight wall,
		// or a wall end short of a perpendicular wall), inside the envelope.
		onStage('Finding rooms', 82);
		const doorMax = envLong * 0.075;
		const bridges = doorBridges(lines, tolC, snapTol, doorMax);
		const vec = track(new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0)));
		const vd = vec.data as Uint8Array;
		const half = Math.floor(t / 2);
		for (const l of [...lines, ...bridges]) {
			for (let s = Math.round(l.s0) - half; s <= Math.round(l.s1) + half; s++) {
				for (let o = -half; o <= half; o++) {
					const x = l.horizontal ? s : Math.round(l.c) + o;
					const y = l.horizontal ? Math.round(l.c) + o : s;
					if (x >= 0 && y >= 0 && x < W && y < H) vd[y * W + x] = 255;
				}
			}
		}
		// seal hairline leaks; rooms are grown back by g afterwards
		const g = t;
		const closed = track(new cv.Mat());
		cv.dilate(vec, closed, kernel(t, t));
		const free = track(new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0)));
		const fd = free.data as Uint8Array;
		const cd = closed.data as Uint8Array;
		for (let y = env.y; y < env.y + env.h; y++) {
			for (let x = env.x; x < env.x + env.w; x++) fd[y * W + x] = cd[y * W + x] ? 0 : 255;
		}
		const labels = track(new cv.Mat());
		const stats = track(new cv.Mat());
		const cents = track(new cv.Mat());
		const nl: number = cv.connectedComponentsWithStats(free, labels, stats, cents, 4, cv.CV_32S);
		const lab = labels.data32S as Int32Array;
		const envArea = env.w * env.h;

		interface Comp {
			l: number;
			x: number;
			y: number;
			w: number;
			h: number;
			area: number;
		}
		const comps: Comp[] = [];
		for (let l = 1; l < nl; l++) {
			const area = stats.intAt(l, 4);
			if (area < envArea * 0.004) continue;
			comps.push({ l, x: stats.intAt(l, 0), y: stats.intAt(l, 1), w: stats.intAt(l, 2), h: stats.intAt(l, 3), area });
		}

		// Furniture (single-line plans only; double-line plans lost it with the unpaired lines): a
		// small component inside a bigger one's bbox whose surrounding ring lies mostly in it.
		const byLabel = new Map(comps.map((c) => [c.l, c]));
		const ringOff = 2 * g + Math.max(4, Math.round(t / 2));
		const nested = new Set<number>();
		for (const c of doubleLine ? [] : comps) {
			if (c.area > envArea * 0.035) continue;
			const x0 = c.x - ringOff;
			const y0 = c.y - ringOff;
			const x1 = c.x + c.w - 1 + ringOff;
			const y1 = c.y + c.h - 1 + ringOff;
			const counts = new Map<number, number>();
			let total = 0;
			const visit = (x: number, y: number) => {
				total++;
				if (x < 0 || y < 0 || x >= W || y >= H) return;
				const v = lab[y * W + x]!;
				if (v > 0 && v !== c.l) counts.set(v, (counts.get(v) ?? 0) + 1);
			};
			for (let x = x0; x <= x1; x++) {
				visit(x, y0);
				visit(x, y1);
			}
			for (let y = y0 + 1; y < y1; y++) {
				visit(x0, y);
				visit(x1, y);
			}
			for (const [v, k] of counts) {
				const host = byLabel.get(v);
				const inside = host && c.x >= host.x && c.y >= host.y && c.x + c.w <= host.x + host.w && c.y + c.h <= host.y + host.h;
				if (inside && host.area > c.area * 4 && k / total >= 0.5) nested.add(c.l);
			}
		}

		// Drop wall lines that only outline furniture.
		const furniture = comps
			.filter((c) => nested.has(c.l))
			.map((c) => ({ x: c.x - g - snapTol, y: c.y - g - snapTol, w: c.w + 2 * (g + snapTol), h: c.h + 2 * (g + snapTol) }));
		const within = (f: Rect, x: number, y: number) => x >= f.x && y >= f.y && x <= f.x + f.w && y <= f.y + f.h;
		lines = lines.filter((l) => {
			const a: Point = l.horizontal ? [l.s0, l.c] : [l.c, l.s0];
			const b: Point = l.horizontal ? [l.s1, l.c] : [l.c, l.s1];
			return !furniture.some((f) => within(f, ...a) && within(f, ...b));
		});

		const snapAxis = (horizontal: boolean) => (v: number, a: number, b: number) => {
			let best = v;
			let bestD = g + t + snapTol;
			for (const l of lines) {
				if (l.horizontal !== horizontal || Math.min(b, l.s1) - Math.max(a, l.s0) <= 0) continue;
				const dd = Math.abs(l.c - v);
				if (dd < bestD) {
					bestD = dd;
					best = l.c;
				}
			}
			return best;
		};
		const snapX = snapAxis(false);
		const snapY = snapAxis(true);

		// 5b. Shapes: rasterize each room to coarse cells, fill holes, grow back by the dilation
		// radius and trace a rectilinear outline (no diagonals by construction).
		const cell = Math.max(2, Math.round(envLong * 0.006));
		const grow = Math.max(1, Math.round(g / cell));
		const pxRooms: { shape: 'rect' | 'polygon'; points: Point[] }[] = [];
		for (const c of comps) {
			if (nested.has(c.l)) continue;
			const pad = grow + 1;
			const cw = Math.ceil(c.w / cell) + 2 * pad;
			const ch = Math.ceil(c.h / cell) + 2 * pad;
			const ox = c.x - pad * cell;
			const oy = c.y - pad * cell;
			const counts = new Uint16Array(cw * ch);
			for (let y = c.y; y < c.y + c.h; y++) {
				for (let x = c.x; x < c.x + c.w; x++) {
					if (lab[y * W + x] === c.l) counts[Math.floor((y - oy) / cell) * cw + Math.floor((x - ox) / cell)]!++;
				}
			}
			let cells = new Uint8Array(cw * ch);
			for (let i = 0; i < cells.length; i++) cells[i] = counts[i]! * 2 >= cell * cell ? 1 : 0;
			// fill holes: everything not reachable from the border is inside
			const outside = new Uint8Array(cw * ch);
			const stack: number[] = [0];
			outside[0] = 1;
			while (stack.length) {
				const i = stack.pop()!;
				const x = i % cw;
				const y = (i - x) / cw;
				for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
					if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
					const j = ny * cw + nx;
					if (!outside[j] && !cells[j]) {
						outside[j] = 1;
						stack.push(j);
					}
				}
			}
			let filled = 0;
			for (let i = 0; i < cells.length; i++) {
				cells[i] = outside[i] ? 0 : 1;
				filled += cells[i]!;
			}
			// grow (square dilation in cells)
			const grown = new Uint8Array(cw * ch);
			for (let y = 0; y < ch; y++) {
				for (let x = 0; x < cw; x++) {
					if (!cells[y * cw + x]) continue;
					for (let yy = Math.max(0, y - grow); yy <= Math.min(ch - 1, y + grow); yy++) {
						for (let xx = Math.max(0, x - grow); xx <= Math.min(cw - 1, x + grow); xx++) grown[yy * cw + xx] = 1;
					}
				}
			}
			cells = grown;
			const loop = traceCells(cells, cw, ch).map(([x, y]): Point => [ox + x * cell, oy + y * cell]);
			if (loop.length < 4) continue;
			let poly = regularize(loop, Math.max(cell * 2, envLong * 0.016), snapX, snapY);
			const xs = poly.map((p) => p[0]);
			const ys = poly.map((p) => p[1]);
			let bx0 = Math.min(...xs);
			let bx1 = Math.max(...xs);
			let by0 = Math.min(...ys);
			let by1 = Math.max(...ys);
			const bboxCells = (Math.ceil(c.w / cell) + 0.0001) * Math.ceil(c.h / cell);
			if (poly.length <= 4 || filled / bboxCells >= 0.92) {
				bx0 = snapX(bx0, by0, by1);
				bx1 = snapX(bx1, by0, by1);
				by0 = snapY(by0, bx0, bx1);
				by1 = snapY(by1, bx0, bx1);
				if (bx1 - bx0 < cell || by1 - by0 < cell) continue;
				pxRooms.push({ shape: 'rect', points: [[bx0, by0], [bx1, by1]] });
			} else {
				poly = simplifyOrtho(poly);
				if (poly.length < 4) continue;
				pxRooms.push({ shape: 'polygon', points: poly });
			}
		}

		// Final walls: drop short free-floating lines (desks, shelves), split at junctions so every
		// wall runs between two junctions/ends (what the editor snaps to).
		const touchesAny = (l: Line, v: number) =>
			lines.some((p) => p !== l && p.horizontal !== l.horizontal && Math.abs(p.c - v) <= snapTol && l.c >= p.s0 - snapTol && l.c <= p.s1 + snapTol);
		const crossedBy = (l: Line) =>
			lines.some((p) => p.horizontal !== l.horizontal && p.c > l.s0 + t && p.c < l.s1 - t && l.c >= p.s0 - snapTol && l.c <= p.s1 + snapTol);
		lines = lines.filter((l) => l.s1 - l.s0 >= envLong * 0.1 || touchesAny(l, l.s0) || touchesAny(l, l.s1) || crossedBy(l));
		lines = splitAtJunctions(lines, snapTol, Math.max(t, minWall / 2));

		// Canvas mapping: the envelope fills the canvas, long side 1000.
		onStage('Finishing', 95);
		const s = CANVAS_LONG_SIDE / envLong;
		const canvas = { w: Math.max(1, Math.round(env.w * s)), h: Math.max(1, Math.round(env.h * s)) };
		const toX = (x: number) => Math.max(0, Math.min(canvas.w, Math.round((x - env.x) * s)));
		const toY = (y: number) => Math.max(0, Math.min(canvas.h, Math.round((y - env.y) * s)));
		const toC = (p: Point): Point => [toX(p[0]), toY(p[1])];

		const seen = new Set<string>();
		const wallsOut: [Point, Point][] = [];
		for (const l of lines) {
			const a: Point = l.horizontal ? [toX(l.s0), toY(l.c)] : [toX(l.c), toY(l.s0)];
			const b: Point = l.horizontal ? [toX(l.s1), toY(l.c)] : [toX(l.c), toY(l.s1)];
			const k = `${a}|${b}`;
			if ((a[0] === b[0] && a[1] === b[1]) || seen.has(k)) continue;
			seen.add(k);
			wallsOut.push([a, b]);
		}

		const rooms: AnalyzeRoom[] = pxRooms
			.map((r) => ({ shape: r.shape, points: simplifyOrtho(r.points.map(toC)) }))
			.filter((r) => (r.shape === 'rect' ? r.points.length === 2 : r.points.length >= 4))
			// reading order, so the numbers on the marked image are easy to follow
			.sort((p, q) => {
				const [px, py] = minCorner(p.points);
				const [qx, qy] = minCorner(q.points);
				return Math.abs(py - qy) > canvas.h * 0.05 ? py - qy : px - qx;
			})
			.slice(0, MAX_ROOMS);

		return {
			canvas,
			crop: { x: env.x / W, y: env.y / H, w: env.w / W, h: env.h / H },
			envelope: env,
			walls: wallsOut.slice(0, MAX_WALLS),
			rooms,
			stats: { inkMode: mode, doubleLine, furniture: nested.size, components: comps.length }
		};
	} finally {
		for (const m of mats) m.delete();
	}
}

function minCorner(points: Point[]): Point {
	return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
}
