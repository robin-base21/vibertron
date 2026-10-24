/// <reference types="bun" />
import { expect, test } from 'bun:test';
import {
	canvasFor,
	downscaleFactor,
	filterContours,
	isFrameBorder,
	MAX_CANDIDATES,
	normalizer,
	polygonArea,
	unflatten,
	type Pt
} from './geometry';

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
	[x, y],
	[x + w, y],
	[x + w, y + h],
	[x, y + h]
];

test('downscaleFactor caps the long side and never upscales', () => {
	expect(downscaleFactor(3200, 1600)).toBe(0.5);
	expect(downscaleFactor(1000, 4000)).toBe(0.4);
	expect(downscaleFactor(800, 600)).toBe(1);
});

test('canvasFor keeps the aspect ratio with a 1000 long side', () => {
	expect(canvasFor(1600, 1000)).toEqual({ w: 1000, h: 625 });
	expect(canvasFor(900, 1800)).toEqual({ w: 500, h: 1000 });
	expect(canvasFor(500, 500)).toEqual({ w: 1000, h: 1000 });
});

test('normalizer scales to canvas units and clamps', () => {
	const n = normalizer(1600, 1000);
	expect(n([800, 500])).toEqual([500, 312.5]);
	expect(n([1600, 1000])).toEqual([1000, 625]);
	expect(n([-5, 2000])).toEqual([0, 625]);
});

test('polygonArea and unflatten', () => {
	expect(polygonArea(rect(0, 0, 10, 20))).toBe(200);
	expect(unflatten([1, 2, 3, 4])).toEqual([
		[1, 2],
		[3, 4]
	]);
});

test('isFrameBorder detects page-sized contours', () => {
	expect(isFrameBorder(rect(2, 2, 996, 996), 1000, 1000)).toBe(true);
	expect(isFrameBorder(rect(100, 2, 800, 996), 1000, 1000)).toBe(false);
});

test('filterContours drops tiny, huge and frame contours, dedupes wall pairs, sorts largest first', () => {
	const r = filterContours(
		[
			{ points: rect(0, 0, 1000, 800) }, // frame border
			{ points: rect(50, 50, 400, 300) }, // room A outer
			{ points: rect(56, 56, 388, 288) }, // room A inner (other side of the wall) -> dup
			{ points: rect(500, 50, 450, 500) }, // room B (largest)
			{ points: rect(600, 600, 4, 4) }, // speck
			{ points: rect(100, 500, 300, 6) }, // sliver: outline but not a room
			{ points: [[10, 700], [600, 700]] } // open wall line
		],
		{ w: 1000, h: 800 }
	);
	expect(r.canvas).toEqual({ w: 1000, h: 800 });
	expect(r.candidates.length).toBe(2);
	expect(r.candidates[0]).toEqual(rect(500, 50, 450, 500));
	expect(r.candidates[1]).toEqual(rect(50, 50, 400, 300));
	// Outlines keep the sliver and the wall line but not the speck or the frame.
	expect(r.outlines.length).toBe(5);
	expect(r.outlines.some((o) => o.length === 2)).toBe(true);
	expect(r.outlines.every((o) => !(o[0]![0] === 0 && o[0]![1] === 0 && o.length === 4 && o[2]![0] === 1000))).toBe(true);
});

test('filterContours caps candidates and normalizes coordinates', () => {
	const many = Array.from({ length: 150 }, (_, i) => ({
		points: rect((i % 15) * 195 + 5, Math.floor(i / 15) * 155 + 10, 180 + (i % 7), 140)
	}));
	const r = filterContours(many, { w: 3000, h: 1600 });
	expect(r.candidates.length).toBe(MAX_CANDIDATES);
	expect(r.canvas.w).toBe(1000);
	for (const c of r.candidates) for (const [x, y] of c) expect(x <= 1000 && y <= r.canvas.h).toBe(true);
	const areas = r.candidates.map(polygonArea);
	// Sorted on pixel area; allow for rounding after normalization.
	for (let i = 1; i < areas.length; i++) expect(areas[i]! <= areas[i - 1]! * 1.01).toBe(true);
});
