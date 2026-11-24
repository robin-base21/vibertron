<script lang="ts">
	import { Mail } from '@lucide/svelte';
	import NewsletterForm from '$lib/components/NewsletterForm.svelte';
</script>

<svelte:head><title>Next event · OurBusan.vibe</title></svelte:head>

<section class="border-b-2 border-ink bg-brand">
	<div class="shell flex flex-col items-start gap-3 py-7 sm:gap-4 sm:py-10">
		<span
			class="inline-block -rotate-3 rounded-full bg-ink px-4 py-1.5 font-display text-sm text-white"
		>
			Coming soon
		</span>
		<h1 class="max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">
			We’re preparing the next event.
		</h1>
		<p class="max-w-2xl text-lg font-medium">
			The date isn’t set yet. Leave your email and we’ll let you know as soon as signups are live.
		</p>
	</div>
</section>

<section class="shell pt-8 sm:pt-12">
	<div class="flex max-w-2xl flex-col gap-4 card p-6">
		<h2 class="flex items-center gap-2 text-2xl font-semibold">
			<Mail size={22} class="text-brand" /> Get notified
		</h2>
		<p class="text-ink/70">One email when the next event goes live. Nothing else.</p>
		<NewsletterForm source="next" />
	</div>
	<p class="mt-6 text-ink/70">
		In the meantime, <a class="underline decoration-brand underline-offset-2" href="/showcase"
			>see what people built</a
		> at past events.
	</p>
</section>
