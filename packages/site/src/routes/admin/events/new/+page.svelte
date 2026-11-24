<script lang="ts">
	import EventForm from '$lib/components/EventForm.svelte';
	import { DEFAULT_FORM } from '$lib/signupForm';

	let { data, form } = $props();

	/** Start from the latest event's form and deposit, or the built-in template. */
	// svelte-ignore state_referenced_locally
	let from = $state(data.templates[0]?.id ?? 'default');
	const template = $derived(data.templates.find((t) => t.id === from) ?? null);
	const event = $derived({
		name: '',
		slug: '',
		tagline: null,
		description: null,
		startsAt: null,
		endsAt: null,
		venue: null,
		venueUrl: null,
		capacity: null,
		priceNote: null,
		sourceSlug: null,
		signupOpen: true,
		published: false,
		depositAmount: null,
		depositInstructions: null,
		depositNote: null,
		proofRequired: true,
		holdHours: 24,
		refundDays: null,
		...template?.deposit
	});
</script>

<svelte:head><title>New event · Admin</title></svelte:head>

<section class="shell flex flex-col gap-6 pt-12">
	<a href="/admin" class="text-sm underline decoration-brand underline-offset-2">← All events</a>
	<h1 class="text-4xl font-semibold tracking-tight">New event</h1>
	<label class="flex max-w-md flex-col gap-1 text-sm font-medium">
		Signup form and deposit: start from
		<select class="field" bind:value={from}>
			{#each data.templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
			<option value="default">The default template</option>
		</select>
	</label>
	{#key from}
		<EventForm
			{event}
			signupForm={template?.form ?? DEFAULT_FORM}
			action=""
			submitLabel="Create event"
			ai={data.ai}
			error={form?.error}
		/>
	{/key}
</section>
