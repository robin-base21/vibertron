import { bounds, centroid, type Blueprint, type Outline, type Point, type Segment, type Wall } from 'common';
import { orthogonalize } from '$lib/floorplan/ortho';
import { normRect, uid } from '../geometry';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 800;

export type Tool = 'select' | 'rect' | 'polygon' | 'wall';
export type SelectKind = 'segment' | 'wall' | 'room';

/** Editor document: the blueprint plus selection and undo/redo history. */
export class Editor {
	bp: Blueprint = $state.raw(null as unknown as Blueprint);
	/** Selected segment (one of selectedId / selectedWallId / selectedRoomId is set at a time). */
	selectedId: string | null = $state(null);
	selectedWallId: string | null = $state(null);
	/** Selected labelled outline (non-work room). */
	selectedRoomId: string | null = $state(null);
	/** Selected vertex of the selected polygon segment (Delete removes it). */
	selectedVertex: number | null = $state(null);
	tool: Tool = $state('select');
	snap = $state(true);

	#past: string[] = $state([]);
	#future: string[] = $state([]);
	#lastKey: string | null = null;
	#lastAt = 0;

	constructor(bp: Blueprint) {
		this.bp = bp;
	}

	get selected(): Segment | null {
		return this.bp.segments.find((s) => s.id === this.selectedId) ?? null;
	}

	get selectedWall(): Wall | null {
		return this.bp.walls.find((w) => w.id === this.selectedWallId) ?? null;
	}

	get selectedRoom(): Outline | null {
		return this.bp.outlines.find((o) => o.id === this.selectedRoomId && o.label) ?? null;
	}

	select(kind: SelectKind | null, id: string | null = null) {
		this.selectedId = kind === 'segment' ? id : null;
		this.selectedWallId = kind === 'wall' ? id : null;
		this.selectedRoomId = kind === 'room' ? id : null;
		this.selectedVertex = null;
	}

	get canUndo() {
		return this.#past.length > 0;
	}

	get canRedo() {
		return this.#future.length > 0;
	}

	/**
	 * Record the current state before a change. Calls with the same `key` within a short window
	 * coalesce into one undo step (typing, +/- spam, markup edits).
	 */
	checkpoint(key?: string) {
		const now = Date.now();
		if (key && key === this.#lastKey && now - this.#lastAt < COALESCE_MS) {
			this.#lastAt = now;
			return;
		}
		this.#lastKey = key ?? null;
		this.#lastAt = now;
		this.#past = [...this.#past.slice(-HISTORY_LIMIT + 1), JSON.stringify(this.bp)];
		this.#future = [];
	}

	/** Replace the whole document as one undoable step. */
	apply(next: Blueprint, key?: string) {
		this.checkpoint(key);
		this.bp = next;
		this.#fixSelection();
	}

	/** Replace without recording history (live drag updates after a checkpoint). */
	set(next: Blueprint) {
		this.bp = next;
	}

	/** Load a fresh document and clear history. */
	reset(bp: Blueprint) {
		this.bp = bp;
		this.#past = [];
		this.#future = [];
		this.select(null);
	}

	undo() {
		const prev = this.#past.at(-1);
		if (!prev) return;
		this.#future = [...this.#future, JSON.stringify(this.bp)];
		this.#past = this.#past.slice(0, -1);
		this.#lastKey = null;
		this.bp = JSON.parse(prev);
		this.#fixSelection();
	}

	redo() {
		const next = this.#future.at(-1);
		if (!next) return;
		this.#past = [...this.#past, JSON.stringify(this.bp)];
		this.#future = this.#future.slice(0, -1);
		this.#lastKey = null;
		this.bp = JSON.parse(next);
		this.#fixSelection();
	}

	#fixSelection() {
		if (this.selectedId && !this.bp.segments.some((s) => s.id === this.selectedId)) this.selectedId = null;
		if (this.selectedWallId && !this.selectedWall) this.selectedWallId = null;
		if (this.selectedRoomId && !this.selectedRoom) this.selectedRoomId = null;
		const s = this.selected;
		if (this.selectedVertex !== null && (!s || s.shape !== 'polygon' || this.selectedVertex >= s.points.length)) this.selectedVertex = null;
	}

	/** Immutable segment update, live (no checkpoint). */
	patchSegment(id: string, fn: (s: Segment) => Segment) {
		this.bp = { ...this.bp, segments: this.bp.segments.map((s) => (s.id === id ? fn(s) : s)) };
	}

	updateSegment(id: string, fn: (s: Segment) => Segment, key?: string) {
		this.checkpoint(key);
		this.patchSegment(id, fn);
	}

	addSegment(shape: Segment['shape'], points: Point[]): Segment {
		const n = this.bp.segments.length + 1;
		let name = `Area ${n}`;
		for (let k = n; this.bp.segments.some((s) => s.name === name); k++) name = `Area ${k + 1}`;
		const pts = shape === 'rect' ? normRect(points[0]!, points[1]!) : points;
		const seg: Segment = {
			id: uid(),
			name,
			shape,
			points: pts,
			labelPos: centroid(pts),
			stations: { count: 4, layout: 'grid', confirmed: false }
		};
		this.checkpoint();
		this.bp = { ...this.bp, segments: [...this.bp.segments, seg] };
		this.select('segment', seg.id);
		return seg;
	}

	deleteSegment(id: string) {
		this.checkpoint();
		this.bp = { ...this.bp, segments: this.bp.segments.filter((s) => s.id !== id) };
		this.#fixSelection();
	}

	/** Remove one polygon vertex (a polygon keeps at least 3). */
	deleteVertex(id: string, index: number) {
		const s = this.bp.segments.find((x) => x.id === id);
		if (!s || s.shape !== 'polygon' || s.points.length <= 3) return;
		this.updateSegment(id, (seg) => ({ ...seg, points: seg.points.filter((_, i) => i !== index) }));
		this.selectedVertex = null;
	}

	/** Polygon → its bounding rect. */
	convertToRect(id: string) {
		const s = this.bp.segments.find((x) => x.id === id);
		if (!s || s.shape === 'rect') return;
		const b = bounds(s.points);
		this.updateSegment(id, (seg) => refitLabel(seg, { ...seg, shape: 'rect', points: [[b.x, b.y], [b.x + b.w, b.y + b.h]] }));
		this.selectedVertex = null;
	}

	/** Polygon → axis-aligned edges only (a rect when 4 vertices remain). */
	orthogonalize(id: string): boolean {
		const s = this.bp.segments.find((x) => x.id === id);
		if (!s || s.shape === 'rect') return false;
		const pts = orthogonalize(s.points);
		if (!pts) return false;
		this.updateSegment(id, (seg) => {
			if (pts.length === 4) {
				const b = bounds(pts);
				return refitLabel(seg, { ...seg, shape: 'rect', points: [[b.x, b.y], [b.x + b.w, b.y + b.h]] });
			}
			return refitLabel(seg, { ...seg, points: pts });
		});
		this.selectedVertex = null;
		return true;
	}

	// ---- walls

	addWall(a: Point, b: Point): Wall {
		const wall: Wall = { id: uid('w'), a, b };
		this.checkpoint();
		this.bp = { ...this.bp, walls: [...this.bp.walls, wall] };
		return wall;
	}

	/** Immutable wall update, live (no checkpoint). */
	patchWall(id: string, fn: (w: Wall) => Wall) {
		this.bp = { ...this.bp, walls: this.bp.walls.map((w) => (w.id === id ? fn(w) : w)) };
	}

	updateWall(id: string, fn: (w: Wall) => Wall, key?: string) {
		this.checkpoint(key);
		this.patchWall(id, fn);
	}

	deleteWall(id: string) {
		this.checkpoint();
		this.bp = { ...this.bp, walls: this.bp.walls.filter((w) => w.id !== id) };
		this.#fixSelection();
	}

	// ---- labelled rooms (outlines with a label)

	patchRoom(id: string, fn: (o: Outline) => Outline) {
		this.bp = { ...this.bp, outlines: this.bp.outlines.map((o) => (o.id === id ? fn(o) : o)) };
	}

	updateRoom(id: string, fn: (o: Outline) => Outline, key?: string) {
		this.checkpoint(key);
		this.patchRoom(id, fn);
	}

	renameRoom(id: string, label: string, key?: string) {
		const name = label.trim().slice(0, 60);
		if (!name) return;
		this.updateRoom(id, (o) => ({ ...o, label: name }), key);
	}

	deleteRoom(id: string) {
		this.checkpoint();
		this.bp = { ...this.bp, outlines: this.bp.outlines.filter((o) => o.id !== id) };
		this.#fixSelection();
	}

	/** Confirm a segment's count; the manager's confirmation also clears the AI confidence marker. */
	setConfirmed(id: string, confirmed: boolean) {
		this.updateSegment(id, (s) => withConfirmed(s, confirmed));
	}

	confirmAll() {
		this.checkpoint();
		this.bp = { ...this.bp, segments: this.bp.segments.map((s) => withConfirmed(s, true)) };
	}

	setUnderlayOpacity(opacity: number) {
		if (!this.bp.underlay) return;
		this.checkpoint('underlay-opacity');
		this.bp = { ...this.bp, underlay: { ...this.bp.underlay, opacity } };
	}

	setTitle(patch: Partial<Blueprint['titleBlock']>) {
		this.checkpoint('title');
		this.bp = { ...this.bp, titleBlock: { ...this.bp.titleBlock, ...patch } };
	}
}

function withConfirmed(s: Segment, confirmed: boolean): Segment {
	const { confidence: _drop, ...rest } = s;
	return confirmed ? { ...rest, stations: { ...s.stations, confirmed } } : { ...s, stations: { ...s.stations, confirmed } };
}

export function translateSegment(s: Segment, dx: number, dy: number): Segment {
	return {
		...s,
		points: s.points.map(([x, y]) => [x + dx, y + dy] as Point),
		labelPos: [s.labelPos[0] + dx, s.labelPos[1] + dy]
	};
}

/** Keep the label at the same relative position inside the (changed) bounding box. */
export function refitLabel(before: Segment, after: Segment): Segment {
	const a = bounds(before.points);
	const b = bounds(after.points);
	const fx = a.w ? (before.labelPos[0] - a.x) / a.w : 0.5;
	const fy = a.h ? (before.labelPos[1] - a.y) / a.h : 0.5;
	return { ...after, labelPos: [b.x + fx * b.w, b.y + fy * b.h] };
}

export function translateWall(w: Wall, dx: number, dy: number): Wall {
	return { ...w, a: [w.a[0] + dx, w.a[1] + dy], b: [w.b[0] + dx, w.b[1] + dy] };
}

export function translateRoom(o: Outline, dx: number, dy: number): Outline {
	return { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy] as Point) };
}
