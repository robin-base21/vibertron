import { bounds, stationIds, stationPositions, type Outline, type Point, type Segment, type TeamDTO } from 'common';
import { labelSpot } from '../floorplan/marked';

// Pure drawing helpers shared by the read-only renderer and the editor.

export const GRID = 10;

export const snap = (v: number, step = GRID) => Math.round(v / step) * step;
export const snapPoint = (p: Point, step = GRID): Point => [snap(p[0], step), snap(p[1], step)];

/** Vertices of a segment as a closed polygon (rects expand to 4 corners). */
export function segmentVertices(s: Segment): Point[] {
	if (s.shape === 'rect') {
		const [a, b] = s.points as [Point, Point];
		return [
			[a[0], a[1]],
			[b[0], a[1]],
			[b[0], b[1]],
			[a[0], b[1]]
		];
	}
	return s.points;
}

export const pointsAttr = (pts: Point[]) => pts.map((p) => `${p[0]},${p[1]}`).join(' ');

/** Rect from two arbitrary corners -> [[minX,minY],[maxX,maxY]]. */
export function normRect(a: Point, b: Point): [Point, Point] {
	return [
		[Math.min(a[0], b[0]), Math.min(a[1], b[1])],
		[Math.max(a[0], b[0]), Math.max(a[1], b[1])]
	];
}

export function labelSize(s: Segment): number {
	const b = bounds(s.points);
	const byWidth = (b.w * 1.5) / Math.max(s.name.length, 4);
	return Math.max(9, Math.min(26, byWidth, b.h * 0.16));
}

/** Height of the band at the top of a segment that holds its label (name + count). */
export function labelBand(s: Segment): number {
	const b = bounds(s.points);
	return Math.min(b.h * 0.45, labelSize(s) * 1.55 + 6);
}

/** Where the label is drawn: centred in the top band, horizontally at labelPos.x (clamped). */
export function labelAnchor(s: Segment): { x: number; nameY: number; countY: number; fs: number } {
	const b = bounds(s.points);
	const fs = labelSize(s);
	const x = Math.max(b.x + 4, Math.min(b.x + b.w - 4, s.labelPos[0]));
	const nameY = b.y + 4 + fs * 0.5;
	return { x, nameY, countY: nameY + fs * 0.55, fs };
}

export interface StationGlyph {
	id: string;
	index: number;
	pos: Point;
}

export function stationGlyphs(s: Segment): StationGlyph[] {
	const ids = stationIds(s);
	return stationPositions(s, 12, labelBand(s)).map((pos, i) => ({ id: ids[i]!, index: i, pos }));
}

/** Distance between neighbouring station centers (for symbol sizing). */
export function stationSpacing(s: Segment, glyphs: StationGlyph[]): number {
	const b = bounds(s.points);
	if (glyphs.length < 2) return Math.min(b.w, b.h) / 2;
	const p0 = glyphs[0]!.pos;
	let d = Infinity;
	for (let i = 1; i < glyphs.length; i++) {
		const p = glyphs[i]!.pos;
		d = Math.min(d, Math.hypot(p[0] - p0[0], p[1] - p0[1]));
	}
	return d;
}

export const stationSymbolSize = (spacing: number) => Math.max(3, Math.min(16, spacing * 0.42));

type Box = { x: number; y: number; w: number; h: number };

export interface TeamPlacement {
	team: TeamDTO;
	label: string;
	/** One box per row of the team's stations (a team can wrap onto the next row). */
	boxes: Box[];
	stationIds: Set<string>;
}

/** Boxes around each team's stations in its segment, padded by the symbol size. */
export function teamPlacements(segments: Segment[], teams: TeamDTO[]): TeamPlacement[] {
	const byId = new Map(segments.map((s) => [s.id, s]));
	const out: TeamPlacement[] = [];
	for (const team of teams) {
		const seg = byId.get(team.segmentId);
		if (!seg) continue;
		const glyphs = stationGlyphs(seg);
		const ids = new Set(team.members.map((m) => m.stationId));
		const pts = glyphs.filter((g) => ids.has(g.id)).map((g) => g.pos);
		if (!pts.length) continue;
		const pad = stationSymbolSize(stationSpacing(seg, glyphs)) * 0.9;
		const rows = new Map<number, Point[]>();
		for (const p of pts) {
			const key = Math.round(p[1] * 10);
			rows.set(key, [...(rows.get(key) ?? []), p]);
		}
		const boxes = [...rows.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([, row]) => {
				const b = bounds(row);
				return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
			});
		out.push({ team, label: team.codename || team.name, boxes, stationIds: ids });
	}
	return out;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i]!;
		const [xj, yj] = poly[j]!;
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

export function uid(prefix = 'seg'): string {
	return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RoomLabel {
	outline: Outline;
	at: Point;
	/** Font size in canvas units (before the renderer's minimum). */
	size: number;
}

/** Labelled outlines (non-work rooms) with a label spot inside each. */
export function roomLabels(outlines: Outline[]): RoomLabel[] {
	return outlines
		.filter((o) => o.label && o.points.length > 2)
		.map((o) => {
			const { at, clearance } = labelSpot(o.points);
			return { outline: o, at, size: Math.max(8, Math.min(20, clearance * 0.45)) };
		});
}
