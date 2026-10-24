<script lang="ts">
	import type { EventStatus } from 'common';

	let { status }: { status: EventStatus } = $props();
</script>

<span
	class={[
		'bp-label inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs',
		status === 'live' ? 'border-bp-accent text-bp-accent' : 'border-bp-line/50',
		status === 'ended' && 'opacity-50'
	]}
>
	{#if status === 'live'}<span class="size-1.5 animate-pulse bg-bp-accent"></span>{/if}
	{status}
</span>
