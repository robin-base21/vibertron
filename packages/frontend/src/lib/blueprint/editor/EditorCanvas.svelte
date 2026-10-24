<script lang="ts">
	import { bounds, type Outline, type Point, type Segment, type Wall } from 'common';
	import Blueprint from '../Blueprint.svelte';
	import { labelAnchor, normRect, pointsAttr, roomLabels, segmentVertices, snap } from '../geometry';
	import { FONT_LABEL, FONT_MONO } from '../types';
	import { orthoEnd, snapToWalls, snapWallPoint } from '$lib/floorplan/ortho';
	import { refitLabel, translateRoom, translateSegment, translateWall, type Editor } from './editor.svelte';

	interface Props {
		editor: Editor;
		showUnderlay?: boolean;
		invert?: boolean;
		class?: string;
	}

	let { editor, showUnderlay = true, invert = false, class: className = '' }: Props = $props();

	type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
	type Drag =
		| { kind: 'move'; id: string; start: Point; orig: Segment; moved: boolean }
		| { kind: 'label'; id: string; start: Point; orig: Segment; moved: boolean }
		| { kind: 'rect-handle'; id: string; handle: Handle; orig: Segment; moved: boolean }
		| { kind: 'vertex'; id: string; index: number; orig: Segment; moved: boolean }
		| { kind: 'wall-move'; id: string; start: Point; orig: Wall; moved: boolean }
		| { kind: 'wall-end'; id: string; end: 'a' | 'b'; orig: Wall; moved: boolean }
		| { kind: 'room-move'; id: string; start: Point; orig: Outline; moved: boolean }
		| { kind: 'draw-rect'; start: Point; current: Point }
		| { kind: 'draw-wall'; start: Point; current: Point };

	/** Snap distance in CSS px. */
	const SNAP_PX = 8;

	let svg = $state<SVGSVGElement>();
	let drag = $state.raw<Drag | null>(null);
	let polyPoints = $state<Point[]>([]);
	let hover = $state<Point | null>(null);
	/** Wall tool: where the next click lands, and whether it is on another wall. */
	let wallHover = $state<{ p: Point; snapped: boolean } | null>(null);
	let renaming = $state<{ kind: 'segment' | 'room'; id: string; value: string } | null>(null);

	const bp = $derived(editor.bp);
	const selected = $derived(editor.selected);
	const selectedWall = $derived(editor.selectedWall);
	const selectedRoom = $derived(editor.selectedRoom);
	const rooms = $derived(roomLabels(bp.outlines));

	function rawPoint(e: { clientX: number; clientY: number }): Point {
		const ctm = svg?.getScreenCTM();
		if (!ctm) return [0, 0];
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		return [Math.max(0, Math.min(bp.canvas.w, p.x)), Math.max(0, Math.min(bp.canvas.h, p.y))];
	}

	/** Canvas units per CSS px. */
	function unit(): number {
		const a = svg?.getScreenCTM()?.a;
		return a ? 1 / a : 1;
	}

	/** Grid snap only (moves): Alt or Snap off disables it. */
	function gridPoint(e: PointerEvent | MouseEvent): Point {
		const p = rawPoint(e);
		return editor.snap && !e.altKey ? [snap(p[0]), snap(p[1])] : p;
	}

	/** Segment geometry: edges snap to nearby walls, the other axis to the grid. Alt: no snapping. */
	function segPoint(e: PointerEvent | MouseEvent): Point {
		const raw = rawPoint(e);
		if (e.altKey || !editor.snap) return raw;
		const s = snapToWalls(raw, bp.walls, SNAP_PX * unit());
		return [s.x ? s.p[0] : snap(raw[0]), s.y ? s.p[1] : snap(raw[1])];
	}

	/**
	 * Wall ends: orthogonal to `from` unless Alt; snap to other walls' endpoints/lines, else the grid.
	 */
	function wallPoint(e: PointerEvent | MouseEvent, from?: Point, excludeId?: string): { p: Point; snapped: boolean } {
		const raw = rawPoint(e);
		const free = e.altKey;
		const p = from && !free ? orthoEnd(from, raw) : raw;
		const s = editor.snap ? snapWallPoint(p, bp.walls, SNAP_PX * unit(), excludeId) : { p, kind: null };
		if (s.kind) {
			if (!from || free) return { p: s.p, snapped: true };
			// keep the wall straight: only the free coordinate follows the snap
			return { p: p[1] === from[1] ? [s.p[0], from[1]] : [from[0], s.p[1]], snapped: true };
		}
		if (!editor.snap || free) return { p, snapped: false };
		if (!from) return { p: [snap(p[0]), snap(p[1])], snapped: false };
		return { p: p[1] === from[1] ? [snap(p[0]), from[1]] : [from[0], snap(p[1])], snapped: false };
	}

	function rectHandles(s: Segment): { h: Handle; p: Point }[] {
		const [a, b] = s.points as [Point, Point];
		const mx = (a[0] + b[0]) / 2;
		const my = (a[1] + b[1]) / 2;
		return [
			{ h: 'nw', p: [a[0], a[1]] },
			{ h: 'n', p: [mx, a[1]] },
			{ h: 'ne', p: [b[0], a[1]] },
			{ h: 'e', p: [b[0], my] },
			{ h: 'se', p: [b[0], b[1]] },
			{ h: 's', p: [mx, b[1]] },
			{ h: 'sw', p: [a[0], b[1]] },
			{ h: 'w', p: [a[0], my] }
		];
	}

	const cursorFor: Record<Handle, string> = {
		nw: 'nwse-resize',
		se: 'nwse-resize',
		ne: 'nesw-resize',
		sw: 'nesw-resize',
		n: 'ns-resize',
		s: 'ns-resize',
		e: 'ew-resize',
		w: 'ew-resize'
	};

	function onBackgroundDown(e: PointerEvent) {
		if (e.button !== 0) return;
		if (renaming) commitRename();
		if (editor.tool !== 'polygon') polyPoints = [];
		if (editor.tool === 'rect') {
			const p = segPoint(e);
			drag = { kind: 'draw-rect', start: p, current: p };
		} else if (editor.tool === 'polygon') {
			addPolyPoint(segPoint(e));
		} else if (editor.tool === 'wall') {
			const p = wallPoint(e).p;
			drag = { kind: 'draw-wall', start: p, current: p };
		} else {
			editor.select(null);
		}
	}

	// Switching tools abandons a half-drawn polygon.
	const draft = $derived(editor.tool === 'polygon' ? polyPoints : []);

	function onSegmentDown(e: PointerEvent, s: Segment) {
		if (e.button !== 0 || editor.tool !== 'select') return onBackgroundDown(e);
		e.stopPropagation();
		if (renaming && renaming.id !== s.id) commitRename();
		if (editor.selectedId !== s.id) editor.select('segment', s.id);
		else editor.selectedVertex = null;
		drag = { kind: 'move', id: s.id, start: gridPoint(e), orig: s, moved: false };
	}

	function onLabelDown(e: PointerEvent, s: Segment) {
		if (e.button !== 0 || editor.tool !== 'select') return onBackgroundDown(e);
		e.stopPropagation();
		editor.select('segment', s.id);
		drag = { kind: 'label', id: s.id, start: gridPoint(e), orig: s, moved: false };
	}

	function onHandleDown(e: PointerEvent, s: Segment, handle: Handle) {
		if (e.button !== 0) return;
		e.stopPropagation();
		drag = { kind: 'rect-handle', id: s.id, handle, orig: s, moved: false };
	}

	function onVertexDown(e: PointerEvent, s: Segment, index: number) {
		if (e.button !== 0) return;
		e.stopPropagation();
		// Alt+click removes a vertex (keeping at least 3); a plain click selects it for Delete.
		if (e.altKey && s.points.length > 3) {
			editor.deleteVertex(s.id, index);
			return;
		}
		editor.selectedVertex = index;
		drag = { kind: 'vertex', id: s.id, index, orig: s, moved: false };
	}

	/** Double-click on a polygon edge inserts a vertex there (and selects it). */
	function onEdgeDblClick(e: MouseEvent, s: Segment, index: number) {
		e.stopPropagation();
		const p = segPoint(e);
		editor.updateSegment(s.id, (seg) => ({
			...seg,
			points: [...seg.points.slice(0, index + 1), p, ...seg.points.slice(index + 1)]
		}));
		editor.selectedVertex = index + 1;
	}

	function onWallDown(e: PointerEvent, w: Wall) {
		if (e.button !== 0 || editor.tool !== 'select') return onBackgroundDown(e);
		e.stopPropagation();
		if (renaming) commitRename();
		editor.select('wall', w.id);
		drag = { kind: 'wall-move', id: w.id, start: gridPoint(e), orig: w, moved: false };
	}

	function onWallEndDown(e: PointerEvent, w: Wall, end: 'a' | 'b') {
		if (e.button !== 0) return;
		e.stopPropagation();
		drag = { kind: 'wall-end', id: w.id, end, orig: w, moved: false };
	}

	function onRoomDown(e: PointerEvent, o: Outline) {
		if (e.button !== 0 || editor.tool !== 'select') return onBackgroundDown(e);
		e.stopPropagation();
		if (renaming && renaming.id !== o.id) commitRename();
		editor.select('room', o.id);
		drag = { kind: 'room-move', id: o.id, start: gridPoint(e), orig: o, moved: false };
	}

	function markMoved(d: { moved: boolean }) {
		if (!d.moved) {
			editor.checkpoint();
			d.moved = true;
		}
	}

	function delta(start: Point, p: Point): [number, number] {
		return [p[0] - start[0], p[1] - start[1]];
	}

	function onWindowMove(e: PointerEvent) {
		if (editor.tool === 'polygon' && polyPoints.length) hover = segPoint(e);
		if (editor.tool === 'wall' && !drag && svg?.matches(':hover')) wallHover = wallPoint(e);
		const d = drag;
		if (!d) return;
		switch (d.kind) {
			case 'draw-rect':
				drag = { ...d, current: segPoint(e) };
				return;
			case 'draw-wall': {
				const r = wallPoint(e, d.start);
				wallHover = r;
				drag = { ...d, current: r.p };
				return;
			}
			case 'move':
			case 'label':
			case 'wall-move':
			case 'room-move': {
				const [dx, dy] = delta(d.start, gridPoint(e));
				if (!d.moved && dx === 0 && dy === 0) return;
				markMoved(d);
				if (d.kind === 'move') editor.patchSegment(d.id, () => translateSegment(d.orig, dx, dy));
				// Labels live in the segment's top band, so only the horizontal position is free.
				else if (d.kind === 'label') editor.patchSegment(d.id, (s) => ({ ...s, labelPos: [d.orig.labelPos[0] + dx, d.orig.labelPos[1]] }));
				else if (d.kind === 'wall-move') editor.patchWall(d.id, () => translateWall(d.orig, dx, dy));
				else editor.patchRoom(d.id, () => translateRoom(d.orig, dx, dy));
				return;
			}
			case 'rect-handle': {
				markMoved(d);
				const p = segPoint(e);
				const [a, b] = d.orig.points as [Point, Point];
				let [x0, y0] = a;
				let [x1, y1] = b;
				if (d.handle.includes('w')) x0 = p[0];
				if (d.handle.includes('e')) x1 = p[0];
				if (d.handle.includes('n')) y0 = p[1];
				if (d.handle.includes('s')) y1 = p[1];
				const next = { ...d.orig, points: normRect([x0, y0], [x1, y1]) };
				editor.patchSegment(d.id, () => refitLabel(d.orig, next));
				return;
			}
			case 'vertex': {
				markMoved(d);
				const p = segPoint(e);
				editor.patchSegment(d.id, (s) => ({ ...s, points: s.points.map((q, i) => (i === d.index ? p : q)) }));
				return;
			}
			case 'wall-end': {
				markMoved(d);
				const fixed = d.end === 'a' ? d.orig.b : d.orig.a;
				const p = wallPoint(e, fixed, d.id).p;
				editor.patchWall(d.id, (w) => ({ ...w, [d.end]: p }));
				return;
			}
		}
	}

	function onWindowUp() {
		const d = drag;
		drag = null;
		if (d?.kind === 'draw-rect') {
			const [a, b] = normRect(d.start, d.current);
			if (b[0] - a[0] >= 10 && b[1] - a[1] >= 10) {
				editor.addSegment('rect', [a, b]);
				editor.tool = 'select';
			}
		} else if (d?.kind === 'draw-wall') {
			// the Wall tool stays active so walls can be drawn one after another
			if (Math.hypot(d.current[0] - d.start[0], d.current[1] - d.start[1]) >= 5) editor.addWall(d.start, d.current);
		} else if (d?.kind === 'wall-end' && d.moved) {
			// a wall dragged down to (almost) nothing is removed
			const w = editor.selectedWall;
			if (w && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 2) editor.deleteWall(w.id);
		}
	}

	function addPolyPoint(p: Point) {
		const last = polyPoints.at(-1);
		if (last && last[0] === p[0] && last[1] === p[1]) return;
		// Clicking the first point closes the shape.
		const first = polyPoints[0];
		if (first && polyPoints.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) < 8) {
			closePolygon();
			return;
		}
		polyPoints = [...polyPoints, p];
	}

	function closePolygon() {
		const pts = polyPoints.filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1]![0], p[1] - all[i - 1]![1]) > 2);
		polyPoints = [];
		hover = null;
		if (pts.length >= 3) {
			editor.addSegment('polygon', pts);
			editor.tool = 'select';
		}
	}

	export function cancelDrawing(): boolean {
		wallHover = null;
		if (polyPoints.length || drag) {
			polyPoints = [];
			hover = null;
			drag = null;
			return true;
		}
		return false;
	}

	/** Inline rename of the selected segment or room (or the given one). */
	export function startRename(id = editor.selectedId ?? editor.selectedRoomId) {
		const s = bp.segments.find((x) => x.id === id);
		if (s) {
			renaming = { kind: 'segment', id: s.id, value: s.name };
			return;
		}
		const o = bp.outlines.find((x) => x.id === id && x.label);
		if (o) renaming = { kind: 'room', id: o.id, value: o.label! };
	}

	function commitRename() {
		const r = renaming;
		renaming = null;
		if (!r) return;
		const name = r.value.trim().slice(0, 60);
		if (!name) return;
		if (r.kind === 'room') {
			const o = bp.outlines.find((x) => x.id === r.id);
			if (o && name !== o.label) editor.renameRoom(r.id, name);
			return;
		}
		const s = bp.segments.find((x) => x.id === r.id);
		if (s && name !== s.name) editor.updateSegment(r.id, (seg) => ({ ...seg, name }));
	}

	function onDblClick(e: MouseEvent) {
		if (editor.tool === 'polygon') {
			e.preventDefault();
			closePolygon();
		}
	}

	function focusSelect(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	/** Where the inline rename input goes: a segment's label band or a room's label spot. */
	const renameBox = $derived.by(() => {
		if (!renaming) return null;
		if (renaming.kind === 'segment') {
			const s = bp.segments.find((x) => x.id === renaming!.id);
			if (!s) return null;
			const a = labelAnchor(s);
			return { x: a.x, y: a.nameY, fs: a.fs, w: Math.max(160, bounds(s.points).w) };
		}
		const r = rooms.find((x) => x.outline.id === renaming!.id);
		if (!r) return null;
		return { x: r.at[0], y: r.at[1], fs: Math.max(r.size, 14), w: Math.max(140, bounds(r.outline.points).w) };
	});
</script>

<svelte:window onpointermove={onWindowMove} onpointerup={onWindowUp} onpointercancel={onWindowUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={['touch-none', editor.tool !== 'select' && 'cursor-crosshair', className]}
	ondblclick={onDblClick}
	onpointerleave={() => (wallHover = drag ? wallHover : null)}
>
	<Blueprint
		blueprint={bp}
		bind:svg
		{showUnderlay}
		{invert}
		selectedSegmentId={editor.selectedId ?? undefined}
		selectedWallId={editor.selectedWallId ?? undefined}
		selectedRoomId={editor.selectedRoomId ?? undefined}
		hideLabelFor={renaming?.id}
		class="h-full w-full"
	>
		{#snippet overlay(ctx)}
			{@const hs = 7 * ctx.u}
			{@const sel = editor.tool === 'select'}
			<!-- Oversized so drags can start in the letterbox margin; points are clamped to the canvas. -->
			<rect
				x={-bp.canvas.w * 10}
				y={-bp.canvas.h * 10}
				width={bp.canvas.w * 21}
				height={bp.canvas.h * 21}
				fill="transparent"
				onpointerdown={onBackgroundDown}
				role="presentation"
			/>
			{#each rooms as r (r.outline.id)}
				<polygon
					points={pointsAttr(r.outline.points)}
					fill="transparent"
					class={sel ? 'cursor-move' : ''}
					data-room-id={r.outline.id}
					onpointerdown={(e) => onRoomDown(e, r.outline)}
					ondblclick={() => sel && startRename(r.outline.id)}
					role="presentation"
				/>
			{/each}
			{#each bp.segments as s (s.id)}
				<polygon
					points={pointsAttr(segmentVertices(s))}
					fill="transparent"
					stroke="transparent"
					stroke-width={10 * ctx.u}
					class={sel ? 'cursor-move' : ''}
					onpointerdown={(e) => onSegmentDown(e, s)}
					ondblclick={() => sel && startRename(s.id)}
					role="presentation"
				/>
			{/each}
			{#each bp.walls as w (w.id)}
				<line
					x1={w.a[0]}
					y1={w.a[1]}
					x2={w.b[0]}
					y2={w.b[1]}
					stroke="transparent"
					stroke-width={9 * ctx.u}
					stroke-linecap="round"
					class={sel ? 'cursor-move' : ''}
					data-wall-id={w.id}
					onpointerdown={(e) => onWallDown(e, w)}
					role="presentation"
				/>
			{/each}
			{#each bp.segments as s (s.id)}
				{@const a = labelAnchor(s)}
				{@const fs = a.fs}
				{@const w = Math.max(s.name.length, 3) * fs * 0.62}
				<rect
					x={a.x - w / 2}
					y={a.nameY - fs * 0.65}
					width={w}
					height={fs * 1.3}
					fill="transparent"
					class={sel ? 'cursor-grab' : ''}
					onpointerdown={(e) => onLabelDown(e, s)}
					ondblclick={() => sel && startRename(s.id)}
					role="presentation"
				/>
			{/each}
			{#each rooms as r (r.outline.id)}
				{@const fs = Math.max(r.size, 11 * ctx.u)}
				{@const w = Math.max(r.outline.label!.length, 3) * fs * 0.62}
				<rect
					x={r.at[0] - w / 2}
					y={r.at[1] - fs * 0.65}
					width={w}
					height={fs * 1.3}
					fill="transparent"
					class={sel ? 'cursor-move' : ''}
					onpointerdown={(e) => onRoomDown(e, r.outline)}
					ondblclick={() => sel && startRename(r.outline.id)}
					role="presentation"
				/>
			{/each}

			{#if selected && sel}
				{@const verts = segmentVertices(selected)}
				<polygon
					points={pointsAttr(verts)}
					fill="none"
					stroke={ctx.accent}
					stroke-width={1 * ctx.u}
					stroke-dasharray="{4 * ctx.u} {3 * ctx.u}"
					pointer-events="none"
				/>
				{#if selected.shape === 'rect'}
					{#each rectHandles(selected) as { h, p } (h)}
						<rect
							x={p[0] - hs / 2}
							y={p[1] - hs / 2}
							width={hs}
							height={hs}
							fill={ctx.bg}
							stroke={ctx.accent}
							stroke-width={1.5 * ctx.u}
							style:cursor={cursorFor[h]}
							onpointerdown={(e) => onHandleDown(e, selected, h)}
							role="presentation"
						/>
					{/each}
				{:else}
					{#each verts as p, i (i)}
						{@const q = verts[(i + 1) % verts.length]!}
						<line
							x1={p[0]}
							y1={p[1]}
							x2={q[0]}
							y2={q[1]}
							stroke="transparent"
							stroke-width={8 * ctx.u}
							class="cursor-copy"
							data-edge={i}
							ondblclick={(e) => onEdgeDblClick(e, selected, i)}
							onpointerdown={(e) => onSegmentDown(e, selected)}
							role="presentation"
						/>
					{/each}
					{#each verts as p, i (i)}
						<rect
							x={p[0] - hs / 2}
							y={p[1] - hs / 2}
							width={hs}
							height={hs}
							fill={editor.selectedVertex === i ? ctx.accent : ctx.bg}
							stroke={ctx.accent}
							stroke-width={1.5 * ctx.u}
							class="cursor-pointer"
							data-vertex={i}
							onpointerdown={(e) => onVertexDown(e, selected, i)}
							role="presentation"
						/>
					{/each}
				{/if}
			{/if}

			{#if selectedRoom && sel}
				<polygon
					points={pointsAttr(selectedRoom.points)}
					fill="none"
					stroke={ctx.accent}
					stroke-width={1 * ctx.u}
					pointer-events="none"
				/>
			{/if}

			{#if selectedWall && sel}
				{#each ['a', 'b'] as const as end (end)}
					{@const p = selectedWall[end]}
					<circle
						cx={p[0]}
						cy={p[1]}
						r={hs * 0.65}
						fill={ctx.bg}
						stroke={ctx.accent}
						stroke-width={1.5 * ctx.u}
						class="cursor-pointer"
						data-wall-end={end}
						onpointerdown={(e) => onWallEndDown(e, selectedWall, end)}
						role="presentation"
					/>
				{/each}
			{/if}

			{#if drag?.kind === 'draw-rect'}
				{@const [a, b] = normRect(drag.start, drag.current)}
				<rect
					x={a[0]}
					y={a[1]}
					width={b[0] - a[0]}
					height={b[1] - a[1]}
					fill={ctx.accent}
					fill-opacity="0.15"
					stroke={ctx.accent}
					stroke-width={1.5 * ctx.u}
					pointer-events="none"
				/>
				<text
					x={b[0]}
					y={b[1] + 4 * ctx.u}
					font-family={FONT_MONO}
					font-size={11 * ctx.u}
					text-anchor="end"
					dominant-baseline="hanging"
					fill={ctx.accent}
					pointer-events="none">{Math.round(b[0] - a[0])}×{Math.round(b[1] - a[1])}</text
				>
			{/if}

			{#if drag?.kind === 'draw-wall'}
				<line
					x1={drag.start[0]}
					y1={drag.start[1]}
					x2={drag.current[0]}
					y2={drag.current[1]}
					stroke={ctx.accent}
					stroke-width={2.4 * ctx.u}
					stroke-linecap="square"
					pointer-events="none"
				/>
				<text
					x={drag.current[0] + 6 * ctx.u}
					y={drag.current[1] + 6 * ctx.u}
					font-family={FONT_MONO}
					font-size={11 * ctx.u}
					dominant-baseline="hanging"
					fill={ctx.accent}
					pointer-events="none"
					>{Math.round(Math.hypot(drag.current[0] - drag.start[0], drag.current[1] - drag.start[1]))}</text
				>
			{/if}

			{#if editor.tool === 'wall' && wallHover}
				{@const p = wallHover.p}
				<g pointer-events="none" stroke={ctx.accent} stroke-width={1.2 * ctx.u} fill="none">
					{#if wallHover.snapped}
						<circle cx={p[0]} cy={p[1]} r={5 * ctx.u} />
					{/if}
					<line x1={p[0] - 8 * ctx.u} y1={p[1]} x2={p[0] + 8 * ctx.u} y2={p[1]} />
					<line x1={p[0]} y1={p[1] - 8 * ctx.u} x2={p[0]} y2={p[1] + 8 * ctx.u} />
				</g>
			{/if}

			{#if draft.length}
				<polyline
					points={pointsAttr(hover ? [...draft, hover] : draft)}
					fill={ctx.accent}
					fill-opacity="0.1"
					stroke={ctx.accent}
					stroke-width={1.5 * ctx.u}
					pointer-events="none"
				/>
				{#each draft as p, i (i)}
					<rect
						x={p[0] - hs / 2}
						y={p[1] - hs / 2}
						width={hs}
						height={hs}
						fill={i === 0 ? ctx.accent : ctx.bg}
						stroke={ctx.accent}
						stroke-width={1.5 * ctx.u}
						pointer-events="none"
					/>
				{/each}
			{/if}

			{#if renaming && renameBox}
				{@const b = renameBox}
				<foreignObject x={b.x - b.w / 2} y={b.y - b.fs} width={b.w} height={b.fs * 2}>
					<input
						class="h-full w-full border border-bp-accent bg-black text-center text-white uppercase outline-none"
						style:font-family={FONT_LABEL}
						style:font-size="{b.fs}px"
						style:letter-spacing="0.08em"
						maxlength="60"
						bind:value={renaming.value}
						onblur={commitRename}
						onpointerdown={(e) => e.stopPropagation()}
						onkeydown={(e) => {
							e.stopPropagation();
							if (e.key === 'Enter') commitRename();
							if (e.key === 'Escape') renaming = null;
						}}
						{@attach focusSelect}
					/>
				</foreignObject>
			{/if}
		{/snippet}
	</Blueprint>
</div>
