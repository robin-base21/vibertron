<script lang="ts">
	import { teamColor } from 'common';

	interface Props {
		position: number;
		class?: string;
	}

	let { position, class: className = 'size-3' }: Props = $props();

	const c = $derived(teamColor(position));
	// Second colour cycle: diagonal hatch, matching the blueprint pattern.
	const background = $derived(
		c.striped ? `repeating-linear-gradient(45deg, ${c.hex} 0 3px, transparent 3px 5px)` : c.hex
	);
</script>

<span
	class={['inline-block shrink-0', className]}
	style:background
	style:box-shadow="inset 0 0 0 1px {c.hex}"
	title="Team colour: {c.name}"
	role="img"
	aria-label="Team colour {c.name}"
></span>
