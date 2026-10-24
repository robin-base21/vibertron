<script lang="ts">
	import { invites } from '$lib/api';
	import QrSvg from '$lib/components/QrSvg.svelte';
	import { errorMessage } from '$lib/stores/toast.svelte';
	import type { JoinCodeDTO } from 'common';
	import { onMount } from 'svelte';

	let { data } = $props();

	let code = $state<JoinCodeDTO | null>(null);
	/** serverTime - Date.now() from the last code response. */
	let offset = $state(0);
	let now = $state(Date.now());
	let error: string | null = $state(null);

	const url = $derived(code ? `${location.origin}${code.joinPath}` : '');
	const left = $derived(code ? Math.max(0, code.windowStart + code.windowMs - (now + offset)) : 0);
	const progress = $derived(code ? left / code.windowMs : 0);

	// Poll the rotating code: right after each window rollover, and at least every 5 s as a
	// safety net (clock drift, missed timers, invite deactivated).
	onMount(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;

		async function poll() {
			try {
				const next = await invites.code(data.inviteId);
				offset = next.serverTime - Date.now();
				code = next;
				error = null;
			} catch (err) {
				error = errorMessage(err);
			}
			if (stopped) return;
			const untilRollover = code
				? code.windowStart + code.windowMs - (Date.now() + offset) + 250
				: 5000;
			timer = setTimeout(poll, Math.max(250, Math.min(untilRollover, 5000)));
		}
		poll();

		const tick = setInterval(() => (now = Date.now()), 100);
		return () => {
			stopped = true;
			clearTimeout(timer);
			clearInterval(tick);
		};
	});
</script>

<svelte:head><title>Join {data.event.name}</title></svelte:head>

<main
	class="fixed inset-0 flex flex-col items-center justify-center gap-[3vh] bg-bp-bg p-6 text-bp-line"
>
	<a
		href="/manage/{data.event.id}"
		class="absolute top-4 left-4 bp-label text-xs opacity-30 hover:opacity-100"
	>
		← Back
	</a>

	<p class="bp-label text-[clamp(1.5rem,4vh,3rem)] font-semibold tracking-[0.15em]">
		{data.event.name}
	</p>

	{#if code}
		<QrSvg text={url} class="aspect-square h-[min(62vh,85vw)]" />
		<div class="flex w-[min(62vh,85vw)] flex-col items-center gap-3">
			<div class="h-[3px] w-full bg-bp-line/15">
				<div class="h-full bg-bp-line" style:width="{progress * 100}%"></div>
			</div>
			<p class="font-mono text-[clamp(2.5rem,9vh,7rem)] leading-none font-medium tracking-[0.25em]">
				{code.code}
			</p>
			<p class="bp-label text-[clamp(0.9rem,2vh,1.4rem)] opacity-60">
				Scan to join · or enter the code above
			</p>
		</div>
	{:else if error}
		<p class="font-mono text-lg text-error">{error}</p>
	{:else}
		<p class="bp-label opacity-50">Loading code…</p>
	{/if}

	{#if code && error}
		<p class="absolute bottom-4 font-mono text-xs text-error">{error}</p>
	{/if}
</main>
