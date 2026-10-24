import { ROOM_MARK_BASE, type AnalyzeRoom, type Point } from 'common';

// The Set-of-Marks image for the vision model: the cropped building with every CV room outlined
// and numbered (rooms[i] carries the number i + ROOM_MARK_BASE). Drawn in canvas coordinates, so
// the model's 0..1000 boxes map straight back onto the canvas.

/** Room outline as a closed polygon (rects expanded to their 4 corners). */
export function roomPolygon(room: AnalyzeRoom): Point[] {
	if (room.shape === 'polygon' && room.points.length > 2) return room.points;
	const [[x0, y0], [x1, y1]] = room.points as [Point, Point];
	return [
		[Math.min(x0, x1), Math.min(y0, y1)],
		[Math.max(x0, x1), Math.min(y0, y1)],
		[Math.max(x0, x1), Math.max(y0, y1)],
		[Math.min(x0, x1), Math.max(y0, y1)]
	];
}

export function insidePolygon(p: Point, poly: Point[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i]!;
		const [xj, yj] = poly[j]!;
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

function edgeDistance(p: Point, poly: Point[]): number {
	let best = Infinity;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [ax, ay] = poly[j]!;
		const [bx, by] = poly[i]!;
		const dx = bx - ax;
		const dy = by - ay;
		const len2 = dx * dx + dy * dy || 1;
		const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
		best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
	}
	return best;
}

/**
 * Where a room's number goes: the sampled interior point farthest from the outline (works for
 * L/U shapes whose centroid lies outside), plus that clearance as a size hint.
 */
export function labelSpot(poly: Point[]): { at: Point; clearance: number } {
	const xs = poly.map((p) => p[0]);
	const ys = poly.map((p) => p[1]);
	const x0 = Math.min(...xs);
	const y0 = Math.min(...ys);
	const w = Math.max(...xs) - x0;
	const h = Math.max(...ys) - y0;
	let at: Point = [x0 + w / 2, y0 + h / 2];
	let clearance = insidePolygon(at, poly) ? edgeDistance(at, poly) : -1;
	const N = 24;
	for (let i = 0; i <= N; i++) {
		for (let j = 0; j <= N; j++) {
			const p: Point = [x0 + (w * (i + 0.5)) / (N + 1), y0 + (h * (j + 0.5)) / (N + 1)];
			if (!insidePolygon(p, poly)) continue;
			const d = edgeDistance(p, poly);
			if (d > clearance + 0.5) {
				clearance = d;
				at = p;
			}
		}
	}
	return { at, clearance: Math.max(clearance, 0) };
}

const OUTLINE = '#ff2d55';
const BADGE = '#ffd60a';

/**
 * Draws the marked image onto a 2D context of size canvas.w × canvas.h. `source` is the full
 * (downscaled) image, `crop` the envelope in its pixels.
 */
export function drawMarked(
	ctx: OffscreenCanvasRenderingContext2D,
	source: CanvasImageSource,
	crop: { x: number; y: number; w: number; h: number },
	canvas: { w: number; h: number },
	rooms: AnalyzeRoom[]
): void {
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, canvas.w, canvas.h);
	ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.w, canvas.h);
	// dim the plan a little so the marks stand out on any colour scheme
	ctx.fillStyle = 'rgba(0,0,0,0.25)';
	ctx.fillRect(0, 0, canvas.w, canvas.h);

	const long = Math.max(canvas.w, canvas.h);
	ctx.lineJoin = 'miter';
	ctx.lineWidth = Math.max(2, long / 300);
	ctx.strokeStyle = OUTLINE;
	const polys = rooms.map(roomPolygon);
	for (const poly of polys) {
		ctx.beginPath();
		poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
		ctx.closePath();
		ctx.stroke();
	}

	polys.forEach((poly, i) => {
		const { at, clearance } = labelSpot(poly);
		const label = String(i + ROOM_MARK_BASE);
		const fs = Math.round(Math.max(long / 40, Math.min(long / 14, clearance * 0.9)));
		ctx.font = `700 ${fs}px sans-serif`;
		const w = Math.max(ctx.measureText(label).width + fs * 0.5, fs * 1.2);
		const h = fs * 1.2;
		ctx.fillStyle = BADGE;
		ctx.strokeStyle = '#000';
		ctx.lineWidth = Math.max(2, fs / 12);
		ctx.fillRect(at[0] - w / 2, at[1] - h / 2, w, h);
		ctx.strokeRect(at[0] - w / 2, at[1] - h / 2, w, h);
		ctx.fillStyle = '#000';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, at[0], at[1] + fs * 0.05);
	});
}
