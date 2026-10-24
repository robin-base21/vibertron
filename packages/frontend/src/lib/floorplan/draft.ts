import { centroid, type Blueprint, type Point } from 'common';
import type { FloorplanGeometry } from './pipeline';

// Turning detection/analyze output into a draft blueprint for the editor. Pure, unit-tested.

type Canvas = Blueprint['canvas'];

const clampPt = (p: Point, c: Canvas): Point => [Math.max(0, Math.min(c.w, p[0])), Math.max(0, Math.min(c.h, p[1]))];

/**
 * Prepare the server's draft for the editor: keep the current title block and clamp all geometry
 * to the canvas (the server builds on the canvas we send with the analyze request).
 */
export function fitDraft(draft: Blueprint, titleBlock: Blueprint['titleBlock']): Blueprint {
	const canvas = draft.canvas;
	return {
		...draft,
		walls: draft.walls.map((w) => ({ ...w, a: clampPt(w.a, canvas), b: clampPt(w.b, canvas) })),
		outlines: draft.outlines.map((o) => ({ ...o, points: o.points.map((p) => clampPt(p, canvas)) })),
		segments: draft.segments.map((s) => ({
			...s,
			points: s.points.map((p) => clampPt(p, canvas)),
			labelPos: clampPt(s.labelPos, canvas)
		})),
		titleBlock
	};
}

/** Client-side draft when the analyze request fails or there's no backend: rooms become "Area N". */
export function localDraft(geometry: FloorplanGeometry, titleBlock: Blueprint['titleBlock'], imageRef?: string): Blueprint {
	return {
		schemaVersion: 1,
		canvas: geometry.canvas,
		...(imageRef ? { underlay: { imageRef, opacity: 0.35, crop: geometry.crop } } : {}),
		walls: geometry.walls.map(([a, b], i) => ({ id: `w${i + 1}`, a, b })),
		outlines: [],
		segments: geometry.rooms.map((r, i) => ({
			id: `s${i + 1}`,
			name: `Area ${i + 1}`,
			shape: r.shape,
			points: r.points,
			labelPos: centroid(r.points),
			stations: { count: 0, layout: 'grid', confirmed: false }
		})),
		titleBlock
	};
}

export interface ApplyOptions {
	/** Take the draft's walls and decorative outlines (else keep the current ones). */
	walls: boolean;
	/** Take the draft's segments and labelled rooms (else keep the current ones). */
	segments: boolean;
}

/**
 * The blueprint after accepting an import. The draft's canvas and underlay always win; whatever the
 * manager keeps from the current blueprint is rescaled onto the draft canvas.
 */
export function applyDraft(current: Blueprint, draft: Blueprint, opts: ApplyOptions): Blueprint {
	const sx = draft.canvas.w / current.canvas.w;
	const sy = draft.canvas.h / current.canvas.h;
	const sc = (p: Point): Point => clampPt([Math.round(p[0] * sx * 10) / 10, Math.round(p[1] * sy * 10) / 10], draft.canvas);
	const kept = {
		walls: current.walls.map((w) => ({ ...w, a: sc(w.a), b: sc(w.b) })),
		decorative: current.outlines.filter((o) => !o.label).map((o) => ({ ...o, points: o.points.map(sc) })),
		rooms: current.outlines.filter((o) => o.label).map((o) => ({ ...o, points: o.points.map(sc) })),
		segments: current.segments.map((s) => ({ ...s, points: s.points.map(sc), labelPos: sc(s.labelPos) }))
	};
	const draftDecorative = draft.outlines.filter((o) => !o.label);
	const draftRooms = draft.outlines.filter((o) => o.label);
	const outlines = [...(opts.walls ? draftDecorative : kept.decorative), ...(opts.segments ? draftRooms : kept.rooms)].map((o) => ({ ...o }));
	// outline ids must stay unique when mixing both sources
	const seen = new Set<string>();
	for (const o of outlines) {
		let id = o.id;
		for (let n = 2; seen.has(id); n++) id = `${o.id}_${n}`;
		o.id = id;
		seen.add(id);
	}
	return {
		...draft,
		walls: opts.walls ? draft.walls : kept.walls,
		outlines,
		segments: opts.segments ? draft.segments : kept.segments,
		titleBlock: current.titleBlock
	};
}
