<script lang="ts">
	import { ApiError } from '$lib/api';
	import type { AttendeeState } from '$lib/stores/attendee.svelte';
	import { errorMessage } from '$lib/stores/toast.svelte';

	let { state: s }: { state: AttendeeState } = $props();

	const rejected = $derived(s.me.status === 'rejected');
	/** Friends this late arrival named, so the organiser can seat them together. */
	const friends = $derived(s.outgoing.map((p) => p.toName));

	let friendCode = $state('');
	let pairing = $state(false);
	let pairError = $state<string | null>(null);

	async function pair(e: SubmitEvent) {
		e.preventDefault();
		pairing = true;
		pairError = null;
		try {
			await s.pair(friendCode);
			friendCode = '';
		} catch (err) {
			pairError =
				err instanceof ApiError && err.status === 404
					? 'No one here has that code'
					: errorMessage(err);
		} finally {
			pairing = false;
		}
	}
</script>

<div class="flex flex-col gap-8">
	<section class="flex flex-col gap-2">
		<p class="bp-label text-sm opacity-60">{s.ctx.event.name}</p>
		{#if rejected}
			<h1 class="bp-label text-4xl font-semibold">Not this time</h1>
			<p class="text-sm opacity-70">
				The organisers didn’t add you to this event. Talk to them if you think that’s a mistake.
			</p>
		{:else}
			<h1 class="bp-label text-4xl font-semibold">Almost in</h1>
			<p class="text-sm opacity-70">
				The event is already under way. An organiser will put you on a team in a moment; this page
				switches over by itself.
			</p>
			<p class="flex items-center gap-2 font-mono text-xs opacity-60">
				<span class="loading loading-xs loading-dots"></span>
				Waiting as {s.me.displayName}
			</p>
		{/if}
	</section>

	{#if !rejected}
		<section class="flex flex-col gap-2" aria-label="Came with a friend?">
			<span class="bp-label text-xs opacity-60">Came with a friend?</span>
			{#if friends.length}
				<p class="text-sm">
					The organiser will see you came with <span class="bp-label">{friends.join(', ')}</span>.
				</p>
			{:else}
				<p class="text-sm opacity-70">
					Enter their friend code (on their phone) so the organiser can put you on their team.
				</p>
				<form class="flex gap-2" onsubmit={pair}>
					<input
						class="input flex-1 font-mono tracking-widest uppercase"
						placeholder="Friend code"
						maxlength="8"
						autocapitalize="characters"
						autocomplete="off"
						aria-label="Friend code"
						bind:value={friendCode}
					/>
					<button
						class="btn btn-outline bp-label"
						disabled={pairing || friendCode.trim().length < 4}
					>
						Add
					</button>
				</form>
				{#if pairError}<p class="font-mono text-xs text-error" role="alert">{pairError}</p>{/if}
			{/if}
		</section>
	{/if}
</div>
