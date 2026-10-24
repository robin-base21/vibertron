<script lang="ts">
	import { clock, formatDuration } from '$lib/stores/clock.svelte';

	let { endsAt, class: klass = '' }: { endsAt: number | null; class?: string } = $props();

	const remaining = $derived(endsAt === null ? null : endsAt - clock.now);
</script>

<span class={['font-mono tabular-nums', klass]}>
	{remaining === null ? '--:--' : formatDuration(remaining)}
</span>
