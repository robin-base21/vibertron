<script lang="ts">
	import { goto } from '$app/navigation';
	import { ApiError, join } from '$lib/api';
	import { session } from '$lib/stores/session.svelte';
	import { errorMessage } from '$lib/stores/toast.svelte';
	import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from 'common';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let code = $state(data.code);
	// svelte-ignore state_referenced_locally
	let needCode = $state(data.code.length !== JOIN_CODE_LENGTH);
	let name = $state(session.user?.displayName ?? '');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const closed = $derived(data.event.status !== 'open');
	const valid = $derived(name.trim().length > 0 && code.length === JOIN_CODE_LENGTH);

	function onCodeInput(e: Event & { currentTarget: HTMLInputElement }) {
		code = [...e.currentTarget.value.toUpperCase()]
			.filter((c) => JOIN_CODE_ALPHABET.includes(c))
			.join('')
			.slice(0, JOIN_CODE_LENGTH);
		e.currentTarget.value = code;
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!valid) return;
		busy = true;
		error = null;
		try {
			const res = await join.join(data.token, { code, displayName: name });
			await session.refresh();
			await goto(`/e/${res.event.slug}`, { replaceState: true });
		} catch (err) {
			if (err instanceof ApiError && err.status === 403) {
				needCode = true;
				code = '';
				error = 'That code has expired. Enter the code shown on the venue screen.';
			} else {
				error = errorMessage(err);
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Join {data.event.name}</title></svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-8 px-4 py-10">
	<div class="flex flex-col gap-1">
		<p class="bp-label text-sm opacity-60">You’re invited to</p>
		<h1 class="bp-label text-4xl leading-tight font-semibold">{data.event.name}</h1>
	</div>

	{#if closed}
		<div class="border border-bp-line/40 p-5">
			<p class="bp-label text-lg">
				{data.event.status === 'ended'
					? 'This event has ended'
					: data.event.status === 'live'
						? 'This event has already launched'
						: 'Joining hasn’t opened yet'}
			</p>
			<p class="mt-1 font-mono text-xs opacity-60">
				{data.event.status === 'draft'
					? 'Try again when the organisers open the doors.'
					: 'Ask an organiser if you need a spot.'}
			</p>
		</div>
	{:else}
		<form class="flex flex-col gap-5" onsubmit={submit}>
			<label class="flex flex-col gap-1">
				<span class="bp-label text-xs opacity-70">Your name</span>
				<input
					class="input input-lg w-full"
					required
					maxlength="40"
					autocomplete="nickname"
					placeholder="How your team will see you"
					bind:value={name}
				/>
			</label>

			{#if needCode}
				<label class="flex flex-col gap-1">
					<span class="bp-label text-xs opacity-70">Enter the code shown on the venue screen</span>
					<input
						class="input input-lg w-full text-center font-mono text-3xl tracking-[0.4em] uppercase"
						required
						inputmode="text"
						autocapitalize="characters"
						autocomplete="off"
						spellcheck="false"
						maxlength={JOIN_CODE_LENGTH}
						placeholder="······"
						value={code}
						oninput={onCodeInput}
					/>
				</label>
			{/if}

			{#if error}
				<p class="font-mono text-xs text-error" role="alert">{error}</p>
			{/if}

			<button class="btn btn-primary btn-lg bp-label" disabled={busy || !valid}>
				{busy ? 'Joining…' : 'Join'}
			</button>
		</form>
	{/if}
</main>
