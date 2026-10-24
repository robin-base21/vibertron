<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Blueprint, TeamDTO } from 'common';
	import { pointsAttr, teamPlacements } from './geometry';
	import SegmentShape from './SegmentShape.svelte';
	import TeamTag from './TeamTag.svelte';
	import TitleBlock from './TitleBlock.svelte';
	import { underlayUrl } from './api';
	import { ACCENT, INK, PAPER, secondary, type RenderCtx } from './types';

	interface Props {
		blueprint: Blueprint;
		teams?: TeamDTO[];
		highlightStationId?: string;
		highlightSegmentId?: string;
		highlightTeamId?: string;
		/** Editor selection, drawn like a highlight. */
		selectedSegmentId?: string;
		/** Hide a segment's label (while it is being renamed inline). */
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
			<filter id="{uid}-tex" x="0" y="0" width="100%" height="100%">
				<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
				<feColorMatrix type="saturate" values="0" />
			</filter>
		</defs>

		<rect width={cw} height={ch} fill={ctx.bg} />
		{#if showUnderlay && blueprint.underlay}
			<image
				href={underlayUrl(blueprint.underlay.imageRef)}
				width={cw}
				height={ch}
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

		<g class="bp-outlines" fill="none" stroke={ctx.fg} stroke-opacity="0.6" stroke-width={secondary(ctx)}>
			{#each blueprint.outlines as o (o.id)}
				{#if o.closed}
					<polygon points={pointsAttr(o.points)} />
				{:else}
					<polyline points={pointsAttr(o.points)} />
				{/if}
			{/each}
		</g>

		{#each blueprint.segments as s (s.id)}
			<SegmentShape
				segment={s}
				{ctx}
				highlighted={s.id === highlightSegmentId || s.id === selectedSegmentId}
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
