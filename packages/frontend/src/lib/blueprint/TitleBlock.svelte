<script lang="ts">
	import type { Blueprint } from 'common';
	import { totalStations } from 'common';
	import { FONT_LABEL, FONT_MONO, secondary, structural, type RenderCtx } from './types';

	interface Props {
		blueprint: Blueprint;
		ctx: RenderCtx;
		teamCount: number;
	}

	let { blueprint, ctx, teamCount }: Props = $props();

	const cw = $derived(blueprint.canvas.w);
	const ch = $derived(blueprint.canvas.h);
	const s = $derived(Math.min(cw, ch) / 1000);
	const W = $derived(280 * s);
	const H = $derived(80 * s);
	const m = $derived(12 * s);
	const x = $derived(cw - W - m);
	const y = $derived(ch - H - m);
	const topH = $derived(H * 0.48);
	const cells = $derived([
		{ k: 'DATE', v: blueprint.titleBlock.date },
		{ k: 'REV', v: blueprint.titleBlock.rev },
		{ k: 'STATIONS', v: String(totalStations(blueprint)) },
		{ k: 'TEAMS', v: String(teamCount) }
	]);
	const widths = [0.38, 0.14, 0.26, 0.22];
	const offsets = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
</script>

<g class="bp-titleblock">
	<rect {x} {y} width={W} height={H} fill={ctx.bg} stroke={ctx.fg} stroke-width={structural(ctx)} />
	<line x1={x} y1={y + topH} x2={x + W} y2={y + topH} stroke={ctx.fg} stroke-width={secondary(ctx)} stroke-opacity="0.6" />
	<text x={x + 6 * s} y={y + 9 * s} font-family={FONT_LABEL} font-size={7 * s} letter-spacing="0.08em" fill={ctx.fg} fill-opacity="0.6" dominant-baseline="hanging">PROJECT</text>
	<text
		x={x + 6 * s}
		y={y + topH - 6 * s}
		font-family={FONT_LABEL}
		font-weight="600"
		font-size={17 * s}
		letter-spacing="0.08em"
		fill={ctx.fg}
		textLength={blueprint.titleBlock.project.length > 26 ? W - 12 * s : undefined}
		lengthAdjust="spacingAndGlyphs">{blueprint.titleBlock.project.toUpperCase()}</text
	>
	{#each cells as c, i (c.k)}
		{@const cx = x + W * offsets[i]!}
		{#if i > 0}
			<line x1={cx} y1={y + topH} x2={cx} y2={y + H} stroke={ctx.fg} stroke-width={secondary(ctx)} stroke-opacity="0.6" />
		{/if}
		<text x={cx + 5 * s} y={y + topH + 5 * s} font-family={FONT_LABEL} font-size={7 * s} letter-spacing="0.08em" fill={ctx.fg} fill-opacity="0.6" dominant-baseline="hanging">{c.k}</text>
		<text x={cx + 5 * s} y={y + H - 6 * s} font-family={FONT_MONO} font-size={12 * s} fill={ctx.fg}>{c.v}</text>
	{/each}
</g>
