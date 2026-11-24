<script lang="ts">
	import NewsletterForm from '$lib/components/NewsletterForm.svelte';

	let { form } = $props();
</script>

<svelte:head><title>Stay in the loop · OurBusan.vibe</title></svelte:head>

<section class="shell flex flex-col items-start gap-6 pt-16">
	<span class="sticker">Newsletter</span>
	{#if form?.ok}
		<h1 class="text-4xl font-semibold tracking-tight">You’re on the list.</h1>
		<p class="text-lg text-ink/70">
			We’ll email <strong>{form.email}</strong> when the next event is announced.
		</p>
		<a href="/" class="btn-ink">Back home</a>
	{:else}
		<h1 class="text-4xl font-semibold tracking-tight">Stay in the loop</h1>
		{#if form?.error}<p class="font-medium text-brand-deep" role="alert">{form.error}</p>{/if}
		<NewsletterForm source="subscribe" />
	{/if}
</section>
