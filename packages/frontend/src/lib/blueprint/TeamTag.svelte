<script lang="ts">
	import type { TeamPlacement } from './geometry';
	import { FONT_LABEL, secondary, type RenderCtx } from './types';

	interface Props {
		placement: TeamPlacement;
		ctx: RenderCtx;
		highlighted?: boolean;
	}

	let { placement, ctx, highlighted = false }: Props = $props();

	const first = $derived(placement.boxes[0]!);
	const label = $derived(placement.label.toUpperCase());
	// The tag never gets wider than the station row it labels, so neighbouring teams don't collide.
	const maxW = $derived(Math.max(first.w, 36));
	const fs = $derived(Math.max(6, Math.min(22, maxW / (label.length * 0.6 + 1))));
	const natural = $derived(label.length * fs * 0.6);
	const textW = $derived(Math.min(natural, maxW - fs));
	const tagW = $derived(textW + fs);
	const tagH = $derived(fs * 1.35);
	const tx = $derived(first.x + first.w / 2 - tagW / 2);
	const ty = $derived(first.y - tagH - fs * 0.1);
</script>

<g class="bp-team" data-team-id={placement.team.id}>
	{#each placement.boxes as box, i (i)}
		{#if highlighted}
			<rect x={box.x} y={box.y} width={box.w} height={box.h} fill={ctx.accent} fill-opacity="0.12" />
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
	{/each}
	<rect x={tx} y={ty} width={tagW} height={tagH} fill={ctx.fg} />
	<text
		x={tx + tagW / 2}
		y={ty + tagH / 2}
		font-family={FONT_LABEL}
		font-weight="700"
		font-size={fs}
		letter-spacing="0.06em"
		text-anchor="middle"
		dominant-baseline="central"
		textLength={natural > textW ? textW : undefined}
		lengthAdjust="spacingAndGlyphs"
		fill={ctx.bg}>{label}</text
	>
</g>
