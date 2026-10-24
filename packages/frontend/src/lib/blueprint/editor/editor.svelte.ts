import { bounds, centroid, type Blueprint, type Point, type Segment } from 'common';
import { normRect, uid } from '../geometry';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 800;

export type Tool = 'select' | 'rect' | 'polygon';

/** Editor document: the blueprint plus selection and undo/redo history. */
export class Editor {
	bp: Blueprint = $state.raw(null as unknown as Blueprint);
	selectedId: string | null = $state(null);
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
		if (this.selectedId && !next.segments.some((s) => s.id === this.selectedId)) this.selectedId = null;
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
		this.selectedId = null;
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
		this.selectedId = seg.id;
		return seg;
	}

	deleteSegment(id: string) {
		this.checkpoint();
		this.bp = { ...this.bp, segments: this.bp.segments.filter((s) => s.id !== id) };
		if (this.selectedId === id) this.selectedId = null;
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
