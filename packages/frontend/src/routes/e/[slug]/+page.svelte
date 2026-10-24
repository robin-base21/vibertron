<script lang="ts">
	import LiveView from '$lib/components/attendee/LiveView.svelte';
	import Lobby from '$lib/components/attendee/Lobby.svelte';
	import { AttendeeState } from '$lib/stores/attendee.svelte';
	import { untrack } from 'svelte';

	let { data } = $props();

	const s = $derived(new AttendeeState(data.ctx, data.snapshot));

	// Re-run only when the state object changes (navigation), not on every ctx update.
	$effect(() => {
		const current = s;
		return untrack(() => current.connect());
	});
</script>

<svelte:head><title>{s.ctx.event.name} · Vibertron</title></svelte:head>

<main class="mx-auto flex max-w-lg flex-col gap-6 px-4 py-6">
	{#if s.ctx.event.status === 'live' || s.ctx.event.status === 'ended'}
		<LiveView state={s} />
	{:else}
		<Lobby state={s} />
	{/if}
</main>
