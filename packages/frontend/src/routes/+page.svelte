<script lang="ts">
	import { wsStore } from '$lib/stores/websocket.svelte';
</script>

<main class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
	<h1 class="bp-label text-6xl font-semibold">Vibertron</h1>
	<p class="font-mono text-sm opacity-70">Companion for running vibeathons and hackathons.</p>
	<div class="border border-bp-line/60 p-4 font-mono text-xs">
		BACKEND WS: {wsStore.connected ? 'CONNECTED' : 'OFFLINE'}
	</div>
</main>
