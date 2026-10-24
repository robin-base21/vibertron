<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { wsStore } from '$lib/stores/websocket.svelte';

	let { children } = $props();

	onMount(() => {
		wsStore.connect();
		return () => wsStore.disconnect();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Vibertron</title>
</svelte:head>

<div class="flex min-h-screen flex-col">
	<div class="flex-1">
		{@render children()}
	</div>
</div>
