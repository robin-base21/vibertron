<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Blueprint, TeamDTO } from 'common';
	import { pointsAttr, teamPlacements } from './geometry';
	import SegmentShape from './SegmentShape.svelte';
	import TeamTag from './TeamTag.svelte';
	import TitleBlock from './TitleBlock.svelte';
	import { underlayUrl } from './api';
	import { roomLabels } from './geometry';
	import { ACCENT, FONT_LABEL, INK, PAPER, secondary, wallStroke, type RenderCtx } from './types';

	interface Props {
		blueprint: Blueprint;
		teams?: TeamDTO[];
		highlightStationId?: string;
		highlightSegmentId?: string;
		highlightTeamId?: string;
		/** Editor selection, drawn like a highlight. */
		selectedSegmentId?: string;
		/** Editor selection of a wall / labelled room outline. */
		selectedWallId?: string;
		selectedRoomId?: string;
		/** Hide a segment's or room's label (while it is being renamed inline). */
		hideLabelFor?: string;
		showUnderlay?: boolean;
		showTitleBlock?: boolean;
		invert?: boolean;
		class?: string;
		svg?: SVGSVGElement;
		/** Extra layer drawn on top (editor handles). */
		overlay?: Snippet<[RenderCtx]>;
	}

	let {
		blueprint,
		teams = [],
		highlightStationId,
		highlightSegmentId,
		highlightTeamId,
		selectedSegmentId,
		selectedWallId,
		selectedRoomId,
		hideLabelFor,
		showUnderlay = false,
		showTitleBlock = true,
		invert = false,
		class: className = '',
		svg = $bindable(),
		overlay
	}: Props = $props();

	const uid = $props.id();

	let boxW = $state(0);
	let boxH = $state(0);

	const cw = $derived(blueprint.canvas.w);
	const ch = $derived(blueprint.canvas.h);
	/** Rendered CSS px per canvas unit. */
	const scale = $derived.by(() => {
		if (!boxW) return 1;
		const sx = boxW / cw;
		return boxH ? Math.min(sx, boxH / ch) : sx;
	});
	const ctx: RenderCtx = $derived({
		u: 1 / scale,
		boost: Math.min(2.2, Math.max(1, (scale * cw) / 1500)),
		fg: invert ? PAPER : INK,
		bg: invert ? '#ffffff' : PAPER,
		accent: ACCENT
	});
	const placements = $derived(teamPlacements(blueprint.segments, teams));
	const occupied = $derived(new Set(placements.flatMap((p) => [...p.stationIds])));
	const decorative = $derived(blueprint.outlines.filter((o) => !o.label));
	const rooms = $derived(roomLabels(blueprint.outlines));
	/** Underlay placement: the crop region of the image fills the canvas. */
	const under = $derived.by(() => {
		const c = blueprint.underlay?.crop ?? { x: 0, y: 0, w: 1, h: 1 };
		const w = cw / c.w;
		const h = ch / c.h;
		return { x: -c.x * w, y: -c.y * h, w, h };
	});
	/** Hide the 10-unit grid when it would be denser than ~4 px. */
	const minorGrid = $derived(scale * 10 >= 4);
</script>

<div class={['relative', className]} bind:clientWidth={boxW} bind:clientHeight={boxH}>
	<svg
		bind:this={svg}
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {cw} {ch}"
		preserveAspectRatio="xMidYMid meet"
		class="block h-full w-full select-none"
		role="img"
		aria-label="Blueprint: {blueprint.titleBlock.project}"
	>
		<defs>
			<pattern id="{uid}-grid" width="10" height="10" patternUnits="userSpaceOnUse">
				<path d="M 10 0 L 0 0 0 10" fill="none" stroke={ctx.fg} stroke-opacity="0.035" stroke-width={ctx.u} />
			</pattern>
			<pattern id="{uid}-grid100" width="100" height="100" patternUnits="userSpaceOnUse">
				<path d="M 100 0 L 0 0 0 100" fill="none" stroke={ctx.fg} stroke-opacity="0.08" stroke-width={ctx.u} />
			</pattern>
			<clipPath id="{uid}-canvas"><rect width={cw} height={ch} /></clipPath>
			<filter id="{uid}-tex" x="0" y="0" width="100%" height="100%">
				<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
				<feColorMatrix type="saturate" values="0" />
			</filter>
		</defs>

		<rect width={cw} height={ch} fill={ctx.bg} />
		{#if showUnderlay && blueprint.underlay}
			<image
				href={underlayUrl(blueprint.underlay.imageRef)}
				x={under.x}
				y={under.y}
				width={under.w}
				height={under.h}
				clip-path="url(#{uid}-canvas)"
				preserveAspectRatio="none"
				opacity={blueprint.underlay.opacity}
				style={invert ? undefined : 'filter: invert(1) grayscale(1)'}
			/>
		{/if}
		{#if minorGrid}
			<rect width={cw} height={ch} fill="url(#{uid}-grid)" />
		{/if}
		<rect width={cw} height={ch} fill="url(#{uid}-grid100)" />
		<rect width={cw} height={ch} filter="url(#{uid}-tex)" opacity="0.04" />

		<!-- legacy/decorative traces: kept faint, the walls are the drawing -->
		<g class="bp-outlines" fill="none" stroke={ctx.fg} stroke-opacity="0.2" stroke-width={secondary(ctx)}>
			{#each decorative as o (o.id)}
				{#if o.closed}
					<polygon points={pointsAttr(o.points)} />
				{:else}
					<polyline points={pointsAttr(o.points)} />
				{/if}
			{/each}
		</g>

		<g class="bp-rooms">
			{#each rooms as r (r.outline.id)}
				{@const sel = r.outline.id === selectedRoomId}
				<polygon
					points={pointsAttr(r.outline.points)}
					fill={sel ? ctx.accent : 'none'}
					fill-opacity={sel ? 0.12 : 0}
					stroke={sel ? ctx.accent : ctx.fg}
					stroke-opacity={sel ? 1 : 0.3}
					stroke-width={secondary(ctx)}
					stroke-dasharray="{4 * ctx.u * ctx.boost} {3 * ctx.u * ctx.boost}"
				/>
				{#if r.outline.id !== hideLabelFor}
					<text
						x={r.at[0]}
						y={r.at[1]}
						font-family={FONT_LABEL}
						font-weight="600"
						font-size={Math.max(r.size, 11 * ctx.u)}
						letter-spacing="0.08em"
						text-anchor="middle"
						dominant-baseline="central"
						fill={sel ? ctx.accent : ctx.fg}
						fill-opacity="0.75">{r.outline.label!.toUpperCase()}</text
					>
				{/if}
			{/each}
		</g>

		<g class="bp-walls" stroke={ctx.fg} stroke-width={wallStroke(ctx)} stroke-linecap="square">
			{#each blueprint.walls as w (w.id)}
				<line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke={w.id === selectedWallId ? ctx.accent : undefined} />
			{/each}
		</g>

		{#each blueprint.segments as s (s.id)}
			<SegmentShape
				segment={s}
				{ctx}
				highlighted={s.id === selectedSegmentId ? 'select' : s.id === highlightSegmentId ? 'highlight' : null}
				{highlightStationId}
				{occupied}
				hideLabel={s.id === hideLabelFor}
				labelMode={placements.some((p) => p.team.segmentId === s.id) ? 'corner' : 'center'}
			/>
		{/each}

		{#each placements as p (p.team.id)}
			<TeamTag placement={p} {ctx} highlighted={p.team.id === highlightTeamId} />
		{/each}

		{#if showTitleBlock}
			<TitleBlock {blueprint} {ctx} teamCount={teams.length} />
		{/if}

		{#if overlay}
			<g data-editor-overlay>
				{@render overlay(ctx)}
			</g>
		{/if}
	</svg>
</div>
