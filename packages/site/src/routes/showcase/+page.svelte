<script lang="ts">
	import SectionHead from '$lib/components/SectionHead.svelte';
	import ShowcaseCard from '$lib/components/ShowcaseCard.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Showcase · OurBusan.vibe</title></svelte:head>

<section class="shell pt-14">
	<SectionHead label="Showcase" title="Built in one afternoon" />
	<p class="-mt-4 mb-8 max-w-2xl text-ink/70">
		Projects from past events, shared by the people who built them.
	</p>
	{#if data.items.length}
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.items as item (item.siteEventId + item.project.id)}
				<ShowcaseCard {item} />
			{/each}
		</div>
	{:else}
		<p class="card p-6">The first projects show up here after the next event.</p>
	{/if}
</section>
