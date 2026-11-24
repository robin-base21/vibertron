<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Unsubscribe · OurBusan.vibe</title></svelte:head>

<section class="shell flex max-w-xl flex-col gap-4 pt-16">
	<div class="flex flex-col items-start gap-4 card p-7">
		{#if form?.done}
			<h1 class="text-3xl font-semibold">You’re unsubscribed</h1>
			<p class="text-ink/75">
				We won’t email <strong>{data.email}</strong> about new events anymore. Signups you already have
				aren’t affected.
			</p>
			<a class="btn-line" href="/">Back to the site</a>
		{:else}
			<h1 class="text-3xl font-semibold">Unsubscribe?</h1>
			<p class="text-ink/75">
				Stop emails about new events to <strong>{data.email}</strong>.
			</p>
			<form method="POST"><button class="btn-ink">Unsubscribe</button></form>
		{/if}
	</div>
</section>
