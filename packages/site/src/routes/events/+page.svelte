<script lang="ts">
	import PastCard from '$lib/components/PastCard.svelte';
	import SectionHead from '$lib/components/SectionHead.svelte';
	import UpcomingCard from '$lib/components/UpcomingCard.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Events · OurBusan.vibe</title></svelte:head>

<section class="shell pt-14">
	<SectionHead label="Up next" title="Upcoming events" />
	{#if data.upcoming.length}
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.upcoming as u (u.event.id)}
				<UpcomingCard event={u.event} spotsLeft={u.spotsLeft} />
			{/each}
		</div>
	{:else}
		<p class="card p-6">
			Nothing scheduled right now. <a class="underline decoration-brand" href="/#loop"
				>Get notified</a
			> when the next one is announced.
		</p>
	{/if}
</section>

{#if data.past.length}
	<section class="shell pt-20">
		<SectionHead id="past" label="Results" title="Past events" />
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.past as p (p.event.id)}
				<PastCard event={p.event} winner={p.winner} stats={p.stats} />
			{/each}
		</div>
	</section>
{/if}
