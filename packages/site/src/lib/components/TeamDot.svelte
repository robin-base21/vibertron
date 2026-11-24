<script lang="ts">
	let { color, striped = false }: { color: string; striped?: boolean } = $props();
	const background = $derived(
		striped ? `repeating-linear-gradient(45deg, ${color} 0 3px, transparent 3px 5px)` : color
	);
</script>

<span
	class="inline-block size-3 shrink-0 rounded-sm"
	style:background
	style:box-shadow="inset 0 0 0 1px {color}"
	aria-hidden="true"
></span>
