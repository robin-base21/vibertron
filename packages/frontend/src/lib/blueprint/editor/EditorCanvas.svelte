<script lang="ts">
	import { bounds, type Point, type Segment } from 'common';
	import Blueprint from '../Blueprint.svelte';
	import { labelAnchor, normRect, pointsAttr, segmentVertices, snapPoint } from '../geometry';
	import { FONT_LABEL } from '../types';
	import { refitLabel, translateSegment, type Editor } from './editor.svelte';

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
		| { kind: 'draw-rect'; start: Point; current: Point };

	let svg = $state<SVGSVGElement>();
	let drag = $state.raw<Drag | null>(null);
	let polyPoints = $state<Point[]>([]);
	let hover = $state<Point | null>(null);
	let renaming = $state<{ id: string; value: string } | null>(null);

	const bp = $derived(editor.bp);
	const selected = $derived(editor.selected);

	function toCanvas(e: { clientX: number; clientY: number }, doSnap = true): Point {
		const ctm = svg?.getScreenCTM();
		if (!ctm) return [0, 0];
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		const raw: Point = [
			Math.max(0, Math.min(bp.canvas.w, p.x)),
			Math.max(0, Math.min(bp.canvas.h, p.y))
		];
		return doSnap && editor.snap ? snapPoint(raw) : raw;
	}

	/** Alt disables snapping while dragging. */
	const pt = (e: PointerEvent | MouseEvent) => toCanvas(e, !e.altKey);

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
		const p = pt(e);
		if (editor.tool !== 'polygon') polyPoints = [];
		if (editor.tool === 'rect') {
			drag = { kind: 'draw-rect', start: p, current: p };
		} else if (editor.tool === 'polygon') {
			addPolyPoint(p);
		} else {
			editor.selectedId = null;
		}
	}

	// Switching tools abandons a half-drawn polygon.
	const draft = $derived(editor.tool === 'polygon' ? polyPoints : []);

	function onSegmentDown(e: PointerEvent, s: Segment) {
		if (e.button !== 0 || editor.tool !== 'select') return onBackgroundDown(e);
		e.stopPropagation();
		if (renaming && renaming.id !== s.id) commitRename();
		editor.selectedId = s.id;
		drag = { kind: 'move', id: s.id, start: pt(e), orig: s, moved: false };
	}

	function onLabelDown(e: PointerEvent, s: Segment) {
		if (e.button !== 0 || editor.tool !== 'select') return onBackgroundDown(e);
		e.stopPropagation();
		editor.selectedId = s.id;
		drag = { kind: 'label', id: s.id, start: pt(e), orig: s, moved: false };
	}

	function onHandleDown(e: PointerEvent, s: Segment, handle: Handle) {
		if (e.button !== 0) return;
		e.stopPropagation();
		drag = { kind: 'rect-handle', id: s.id, handle, orig: s, moved: false };
	}

	function onVertexDown(e: PointerEvent, s: Segment, index: number) {
		if (e.button !== 0) return;
		e.stopPropagation();
		// Alt+click removes a vertex (keeping at least 3).
		if (e.altKey && s.points.length > 3) {
			editor.updateSegment(s.id, (seg) => ({ ...seg, points: seg.points.filter((_, i) => i !== index) }));
			return;
		}
		drag = { kind: 'vertex', id: s.id, index, orig: s, moved: false };
	}

	/** Double-click on a polygon edge inserts a vertex there. */
	function onEdgeDblClick(e: MouseEvent, s: Segment, index: number) {
		e.stopPropagation();
		const p = pt(e);
		editor.updateSegment(s.id, (seg) => ({
			...seg,
			points: [...seg.points.slice(0, index + 1), p, ...seg.points.slice(index + 1)]
		}));
	}

	function markMoved(d: Exclude<Drag, { kind: 'draw-rect' }>) {
		if (!d.moved) {
			editor.checkpoint();
			d.moved = true;
		}
	}

	function onWindowMove(e: PointerEvent) {
		if (editor.tool === 'polygon' && polyPoints.length) hover = pt(e);
		const d = drag;
		if (!d) return;
		const p = pt(e);
		switch (d.kind) {
			case 'draw-rect':
				drag = { ...d, current: p };
				return;
			case 'move': {
				const dx = p[0] - d.start[0];
				const dy = p[1] - d.start[1];
				if (!d.moved && dx === 0 && dy === 0) return;
				markMoved(d);
				editor.patchSegment(d.id, () => translateSegment(d.orig, dx, dy));
				return;
			}
			case 'label': {
				const dx = p[0] - d.start[0];
				const dy = p[1] - d.start[1];
				if (!d.moved && dx === 0 && dy === 0) return;
				markMoved(d);
				// Labels live in the segment's top band, so only the horizontal position is free.
				editor.patchSegment(d.id, (s) => ({ ...s, labelPos: [d.orig.labelPos[0] + dx, d.orig.labelPos[1]] }));
				return;
			}
			case 'rect-handle': {
				markMoved(d);
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
				editor.patchSegment(d.id, (s) => ({
					...s,
					points: s.points.map((q, i) => (i === d.index ? p : q))
				}));
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
		if (polyPoints.length || drag) {
			polyPoints = [];
			hover = null;
			drag = null;
			return true;
		}
		return false;
	}

	export function startRename(id = editor.selectedId) {
		const s = bp.segments.find((x) => x.id === id);
		if (s) renaming = { id: s.id, value: s.name };
	}

	function commitRename() {
		const r = renaming;
		renaming = null;
		if (!r) return;
		const name = r.value.trim().slice(0, 60);
		const s = bp.segments.find((x) => x.id === r.id);
		if (s && name && name !== s.name) editor.updateSegment(r.id, (seg) => ({ ...seg, name }));
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

	const renamingSeg = $derived(renaming ? bp.segments.find((s) => s.id === renaming!.id) : undefined);
</script>

<svelte:window onpointermove={onWindowMove} onpointerup={onWindowUp} onpointercancel={onWindowUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={['touch-none', editor.tool !== 'select' && 'cursor-crosshair', className]}
	ondblclick={onDblClick}
>
	<Blueprint
		blueprint={bp}
		bind:svg
		{showUnderlay}
		{invert}
		selectedSegmentId={editor.selectedId ?? undefined}
		hideLabelFor={renaming?.id}
		class="h-full w-full"
	>
		{#snippet overlay(ctx)}
			{@const hs = 7 * ctx.u}
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
			{#each bp.segments as s (s.id)}
				<polygon
					points={pointsAttr(segmentVertices(s))}
					fill="transparent"
					stroke="transparent"
					stroke-width={10 * ctx.u}
					class={editor.tool === 'select' ? 'cursor-move' : ''}
					onpointerdown={(e) => onSegmentDown(e, s)}
					ondblclick={() => editor.tool === 'select' && startRename(s.id)}
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
					class={editor.tool === 'select' ? 'cursor-grab' : ''}
					onpointerdown={(e) => onLabelDown(e, s)}
					ondblclick={() => editor.tool === 'select' && startRename(s.id)}
					role="presentation"
				/>
			{/each}

			{#if selected && editor.tool === 'select'}
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
							fill={ctx.bg}
							stroke={ctx.accent}
							stroke-width={1.5 * ctx.u}
							class="cursor-pointer"
							onpointerdown={(e) => onVertexDown(e, selected, i)}
							role="presentation"
						/>
					{/each}
				{/if}
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
					font-family="'IBM Plex Mono', monospace"
					font-size={11 * ctx.u}
					text-anchor="end"
					dominant-baseline="hanging"
					fill={ctx.accent}
					pointer-events="none">{Math.round(b[0] - a[0])}×{Math.round(b[1] - a[1])}</text
				>
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

			{#if renaming && renamingSeg}
				{@const a = labelAnchor(renamingSeg)}
				{@const fs = a.fs}
				{@const w = Math.max(160, bounds(renamingSeg.points).w)}
				<foreignObject x={a.x - w / 2} y={a.nameY - fs} width={w} height={fs * 2}>
					<input
						class="h-full w-full border border-bp-accent bg-black text-center text-white uppercase outline-none"
						style:font-family={FONT_LABEL}
						style:font-size="{fs}px"
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
