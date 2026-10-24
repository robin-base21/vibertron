import type { Blueprint, Point, Segment } from 'common';

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
 * Fit the server's draft onto the aspect-correct canvas from the contour pass.
 * Candidate polygons and outlines are already in canvas coordinates; AI-proposed rects use a
 * stretched 0..1000 square, so their short axis is rescaled. Keeps the current title block.
 */
export function fitDraft(draft: Blueprint, canvas: Blueprint['canvas'], titleBlock: Blueprint['titleBlock']): Blueprint {
	const sx = canvas.w / 1000;
	const sy = canvas.h / 1000;
	const segments = draft.segments.map((s): Segment => {
		const points =
			s.shape === 'rect'
				? s.points.map((p) => clampPt([p[0] * sx, p[1] * sy], canvas))
				: s.points.map((p) => clampPt(p, canvas));
		const labelPos = s.shape === 'rect' ? centroidOf(points) : clampPt(s.labelPos, canvas);
		return { ...s, points, labelPos };
	});
	return {
		...draft,
		canvas,
		outlines: draft.outlines.map((o) => ({ ...o, points: o.points.map((p) => clampPt(p, canvas)) })),
		segments,
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
