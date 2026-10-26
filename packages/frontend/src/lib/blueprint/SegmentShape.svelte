<script lang="ts">
	import { bounds, LOW_CONFIDENCE, type Segment } from 'common';
	import {
		labelAnchor,
		labelSize,
		pointsAttr,
		segmentVertices,
		stationGlyphs,
		stationSpacing,
		stationSymbolSize
	} from './geometry';
	import { FONT_LABEL, FONT_MONO, secondary, structural, type RenderCtx } from './types';

	interface Props {
		segment: Segment;
		ctx: RenderCtx;
		/** Accent fill under the outline: 'select' (editor selection, 40%) or 'highlight' (faint tint). */
		highlighted?: 'select' | 'highlight' | null;
		highlightStationId?: string;
		/** Station ids taken by a team; drawn filled. */
		/** Occupied stations: station id -> fill paint (team colour or its hatch pattern). */
		occupied?: Map<string, string>;
		hideLabel?: boolean;
		/** 'corner': small name above the top-left corner (used when team tags cover the segment). */
		labelMode?: 'center' | 'corner';
	}

	let { segment, ctx, highlighted = null, highlightStationId, occupied, hideLabel = false, labelMode = 'center' }: Props =
		$props();

	const verts = $derived(segmentVertices(segment));
	const box = $derived(bounds(segment.points));
	const glyphs = $derived(stationGlyphs(segment));
	const spacing = $derived(stationSpacing(segment, glyphs));
	const sym = $derived(stationSymbolSize(spacing));
	const showNumbers = $derived(spacing / ctx.u > 34);
	// A confirmed count means the manager checked it, so the AI's doubt no longer applies.
	const lowConfidence = $derived(
		!segment.stations.confirmed && segment.confidence !== undefined && segment.confidence < LOW_CONFIDENCE
	);
	const fs = $derived(labelSize(segment));
	const anchor = $derived(labelAnchor(segment));
	const sw = $derived(structural(ctx));
	const sw2 = $derived(secondary(ctx));
	const dash = $derived(lowConfidence ? `${6 * ctx.u * ctx.boost} ${4 * ctx.u * ctx.boost}` : undefined);
	const badge = $derived(Math.max(10, Math.min(18, fs)));
</script>

<g class="bp-segment" data-segment-id={segment.id}>
	{#if highlighted}
		<polygon
			points={pointsAttr(verts)}
			fill={ctx.accent}
			fill-opacity={highlighted === 'select' ? 0.4 : 0.1}
			stroke="none"
		/>
	{/if}

	{#each glyphs as g (g.id)}
		{#if g.id === highlightStationId}
			<!-- Strong accent only on the station itself, drawn under the white strokes. -->
			<circle cx={g.pos[0]} cy={g.pos[1]} r={sym * 1.1} fill={ctx.accent} />
			<circle cx={g.pos[0]} cy={g.pos[1]} r={sym * 1.1} fill="none" stroke={ctx.accent} stroke-width={sym * 0.3}>
				<animate attributeName="r" values="{sym * 1.1};{sym * 2.6};{sym * 1.1}" dur="1.8s" repeatCount="indefinite" />
				<animate attributeName="stroke-opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite" />
			</circle>
		{/if}
	{/each}

	<polygon
		points={pointsAttr(verts)}
		fill="none"
		stroke={ctx.fg}
		stroke-width={sw}
		stroke-linejoin="miter"
		stroke-linecap="square"
		stroke-dasharray={dash}
	/>

	{#each glyphs as g (g.id)}
		{@const paint = occupied?.get(g.id)}
		<rect
			x={g.pos[0] - sym / 2}
			y={g.pos[1] - sym / 2}
			width={sym}
			height={sym}
			fill={paint ?? 'none'}
			stroke={ctx.fg}
			stroke-opacity={paint ? 1 : 0.6}
			stroke-width={sw2}
		/>
		{#if showNumbers}
			<text
				x={g.pos[0]}
				y={g.pos[1] + sym / 2 + sym * 0.55}
				font-family={FONT_MONO}
				font-size={Math.max(4, sym * 0.5)}
				text-anchor="middle"
				dominant-baseline="hanging"
				fill={ctx.fg}
				fill-opacity="0.6">{String(g.index + 1).padStart(2, '0')}</text
			>
		{/if}
	{/each}

	{#if hideLabel}
		<!-- label hidden -->
	{:else if labelMode === 'corner'}
		<text
			x={box.x}
			y={box.y - fs * 0.25}
			font-family={FONT_LABEL}
			font-weight="600"
			font-size={fs * 0.7}
			letter-spacing="0.08em"
			fill={ctx.fg}
			fill-opacity="0.85">{segment.name.toUpperCase()}</text
		>
	{:else}
		<text
			x={anchor.x}
			y={anchor.nameY}
			font-family={FONT_LABEL}
			font-weight="600"
			font-size={fs}
			letter-spacing="0.08em"
			text-anchor="middle"
			dominant-baseline="middle"
			fill={ctx.fg}
			stroke={ctx.bg}
			stroke-width={fs * 0.22}
			paint-order="stroke"
			stroke-linejoin="round">{segment.name.toUpperCase()}</text
		>
		<text
			x={anchor.x}
			y={anchor.countY}
			font-family={FONT_MONO}
			font-size={fs * 0.5}
			text-anchor="middle"
			dominant-baseline="hanging"
			fill={ctx.fg}
			fill-opacity="0.75"
			stroke={ctx.bg}
			stroke-width={fs * 0.12}
			paint-order="stroke">{segment.stations.count} ST{segment.stations.confirmed
				? ''
				: ' · UNCONFIRMED'}</text
		>
	{/if}

	{#if lowConfidence}
		{@const bx = box.x + box.w - badge * 0.5}
		{@const by = box.y - badge * 0.5}
		<g>
			<rect x={bx} y={by} width={badge} height={badge} fill={ctx.bg} stroke={ctx.fg} stroke-width={sw2} />
			<text
				x={bx + badge / 2}
				y={by + badge / 2}
				font-family={FONT_MONO}
				font-size={badge * 0.7}
				font-weight="500"
				text-anchor="middle"
				dominant-baseline="central"
				fill={ctx.fg}>?</text
			>
		</g>
	{/if}
</g>
