<script lang="ts">
	import type { TeamPlacement } from './geometry';
	import { FONT_LABEL, secondary, type RenderCtx } from './types';

	interface Props {
		placement: TeamPlacement;
		ctx: RenderCtx;
		highlighted?: boolean;
	}

	let { placement, ctx, highlighted = false }: Props = $props();

	const box = $derived(placement.box);
	const label = $derived(placement.label.toUpperCase());
	const fs = $derived(Math.max(8, Math.min(22, (Math.max(box.w, 40) * 1.7) / Math.max(label.length, 3))));
	const tagW = $derived(label.length * fs * 0.55 + fs * 0.9);
	const tagH = $derived(fs * 1.35);
	const tx = $derived(box.x + box.w / 2 - tagW / 2);
	const ty = $derived(box.y - tagH - fs * 0.15);
</script>

<g class="bp-team" data-team-id={placement.team.id}>
	{#if highlighted}
		<rect x={box.x} y={box.y} width={box.w} height={box.h} fill={ctx.accent} fill-opacity="0.4" />
	{/if}
	<rect
		x={box.x}
		y={box.y}
		width={box.w}
		height={box.h}
		fill="none"
		stroke={ctx.fg}
		stroke-width={secondary(ctx) * 1.4}
		stroke-dasharray="{3 * ctx.u * ctx.boost} {2 * ctx.u * ctx.boost}"
	/>
	<rect x={tx} y={ty} width={tagW} height={tagH} fill={ctx.fg} />
	<text
		x={tx + tagW / 2}
		y={ty + tagH / 2}
		font-family={FONT_LABEL}
		font-weight="700"
		font-size={fs}
		letter-spacing="0.08em"
		text-anchor="middle"
		dominant-baseline="central"
		fill={ctx.bg}>{label}</text
	>
</g>
