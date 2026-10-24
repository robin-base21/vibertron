import type { Blueprint, Point } from 'common';

// Turning contour/analyze output into a draft blueprint for the editor. Pure, unit-tested.

const clampPt = (p: Point, c: Blueprint['canvas']): Point => [
	Math.max(0, Math.min(c.w, p[0])),
	Math.max(0, Math.min(c.h, p[1]))
];

function centroidOf(points: Point[]): Point {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * Prepare the server's draft for the editor: keep the current title block and clamp all geometry
 * to the canvas (the server builds on the canvas we send with the analyze request).
 */
export function fitDraft(draft: Blueprint, titleBlock: Blueprint['titleBlock']): Blueprint {
	const canvas = draft.canvas;
	return {
		...draft,
		outlines: draft.outlines.map((o) => ({ ...o, points: o.points.map((p) => clampPt(p, canvas)) })),
		segments: draft.segments.map((s) => ({
			...s,
			points: s.points.map((p) => clampPt(p, canvas)),
			labelPos: clampPt(s.labelPos, canvas)
		})),
		titleBlock
	};
}

/** Client-side fallback when the analyze request itself fails: candidates become unnamed areas. */
export function localDraft(
	run: { canvas: Blueprint['canvas']; candidates: Point[][]; outlines: Point[][] },
	titleBlock: Blueprint['titleBlock'],
	imageRef?: string
): Blueprint {
	return {
		schemaVersion: 1,
		canvas: run.canvas,
		walls: [],
		...(imageRef ? { underlay: { imageRef, opacity: 0.35 } } : {}),
		outlines: run.outlines.map((points, i) => ({ id: `o${i + 1}`, kind: 'wall', points, closed: points.length > 2 })),
		segments: run.candidates.map((points, i) => ({
			id: `s${i + 1}`,
			name: `Area ${i + 1}`,
			shape: 'polygon',
			points,
			labelPos: centroidOf(points),
			stations: { count: 0, layout: 'grid', confirmed: false }
		})),
		titleBlock
	};
}
