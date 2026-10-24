/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import cvImport from '@techstark/opencv-js';
import { runPipeline, simplifyOrtho, traceCells } from './pipeline';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCv(): Promise<any> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cv: any = cvImport;
	if (cv instanceof Promise) return await cv;
	if (cv.Mat) return cv;
	await new Promise<void>((resolve) => (cv.onRuntimeInitialized = resolve));
	return cv;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test('traceCells outlines an L shape without diagonals', () => {
	// 3x2 grid with the top-right cell empty
	const loop = traceCells(Uint8Array.from([1, 1, 0, 1, 1, 1]), 3, 2);
	expect(loop).toHaveLength(6);
	for (let i = 0; i < loop.length; i++) {
		const a = loop[i]!;
		const b = loop[(i + 1) % loop.length]!;
		expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
	}
});

test('simplifyOrtho never introduces a diagonal', () => {
	// duplicate vertex next to a collinear one used to collapse into a diagonal
	expect(simplifyOrtho([[5, 0], [0, 0], [0, 0], [0, 7], [5, 7]])).toEqual([[5, 0], [0, 0], [0, 7], [5, 7]]);
});

test('blue-grid fixture: envelope, walls and rooms', async () => {
	const cv = await loadCv();
	const png = PNG.sync.read(readFileSync(new URL('./fixtures/blue-grid.png', import.meta.url)));
	const r = runPipeline(cv, png);

	// envelope ≈ (110,110,1075,569) px ±1%
	const e = r.envelope;
	expect(near(e.x, 110, 0.01 * png.width)).toBe(true);
	expect(near(e.y, 110, 0.01 * png.height)).toBe(true);
	expect(near(e.w, 1075, 0.01 * 1075)).toBe(true);
	expect(near(e.h, 569, 0.01 * 569)).toBe(true);
	expect(Math.max(r.canvas.w, r.canvas.h)).toBe(1000);
	expect(r.crop.x).toBeCloseTo(e.x / png.width, 5);

	// ≥ 20 axis-aligned walls inside the canvas
	expect(r.walls.length).toBeGreaterThanOrEqual(20);
	for (const [a, b] of r.walls) {
		expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
		for (const p of [a, b]) {
			expect(p[0]).toBeGreaterThanOrEqual(0);
			expect(p[0]).toBeLessThanOrEqual(r.canvas.w);
			expect(p[1]).toBeGreaterThanOrEqual(0);
			expect(p[1]).toBeLessThanOrEqual(r.canvas.h);
		}
	}

	// ≥ 4 rooms, all rects or orthogonal polygons
	expect(r.rooms.length).toBeGreaterThanOrEqual(4);
	const s = Math.max(e.w, e.h) / 1000;
	const toPx = (x: number, y: number) => [e.x + x * s, e.y + y * s] as const;
	for (const room of r.rooms) {
		if (room.shape === 'rect') {
			expect(room.points).toHaveLength(2);
			continue;
		}
		expect(room.points.length).toBeGreaterThanOrEqual(4);
		for (let i = 0; i < room.points.length; i++) {
			const a = room.points[i]!;
			const b = room.points[(i + 1) % room.points.length]!;
			expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
		}
	}

	// the top-left dining table (~209,192 172x115 px) is not a room
	const table = { x: 209, y: 192, w: 172, h: 115 };
	for (const room of r.rooms) {
		const xs = room.points.map((p) => toPx(p[0], p[1])[0]);
		const ys = room.points.map((p) => toPx(p[0], p[1])[1]);
		const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
		const sameAsTable = near(b.x, table.x, 25) && near(b.y, table.y, 25) && near(b.w, table.w, 35) && near(b.h, table.h, 35);
		expect(sameAsTable).toBe(false);
	}
}, 20_000);
