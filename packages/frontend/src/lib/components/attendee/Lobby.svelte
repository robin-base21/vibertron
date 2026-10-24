<script lang="ts">
	import { ApiError } from '$lib/api';
	import type { AttendeeState } from '$lib/stores/attendee.svelte';
	import { errorMessage, handleError } from '$lib/stores/toast.svelte';
	import { Check, X } from '@lucide/svelte';

	let { state: s }: { state: AttendeeState } = $props();

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

	const act = (fn: () => Promise<void>) => () => fn().catch(handleError);
</script>

<div class="flex flex-col gap-8">
	<section class="flex flex-col gap-1">
		<p class="bp-label text-sm opacity-60">{s.ctx.event.name}</p>
		<h1 class="bp-label text-5xl font-semibold">You’re in</h1>
		<p class="font-mono text-xs opacity-60">
			Signed in as {s.me.displayName}
			{#if s.participantCount !== null}
				· <span class="tabular-nums">{s.participantCount}</span>
				{s.participantCount === 1 ? 'person' : 'people'} here
			{/if}
		</p>
	</section>

	<section class="flex flex-col items-center gap-2 border border-bp-line/60 px-4 py-6">
		<span class="bp-label text-xs opacity-60">Your friend code</span>
		<span class="font-mono text-5xl font-medium tracking-[0.3em] select-all">{s.me.friendCode}</span
		>
		<span class="text-center font-mono text-xs opacity-60">
			Share it with a friend to be put on the same team.
		</span>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="bp-label text-lg">Pair with a friend</h2>
		<form class="flex gap-2" onsubmit={pair}>
			<input
				class="input min-w-0 flex-1 font-mono tracking-[0.2em] uppercase input-lg"
				placeholder="FRIEND CODE"
				autocapitalize="characters"
				autocomplete="off"
				spellcheck="false"
				minlength="4"
				maxlength="8"
				required
				bind:value={friendCode}
			/>
			<button
				class="btn bp-label btn-lg btn-primary"
				disabled={pairing || friendCode.trim().length < 4}
			>
				Send
			</button>
		</form>
		{#if pairError}
			<p class="font-mono text-xs text-error" role="alert">{pairError}</p>
		{/if}

		{#if s.incoming.length + s.outgoing.length + s.accepted.length > 0}
			<ul class="flex flex-col divide-y divide-bp-line/20 border border-bp-line/40">
				{#each s.incoming as p (p.id)}
					<li class="flex items-center gap-3 px-3 py-3">
						<div class="flex flex-1 flex-col">
							<span class="text-lg">{p.fromName}</span>
							<span class="bp-label text-xs text-bp-accent">Wants to team up</span>
						</div>
						<button class="btn bp-label btn-primary btn-sm" onclick={act(() => s.accept(p.id))}>
							<Check size={14} /> Accept
						</button>
						<button
							class="btn btn-ghost btn-sm"
							aria-label="Decline"
							onclick={act(() => s.removePairing(p.id))}
						>
							<X size={14} />
						</button>
					</li>
				{/each}
				{#each s.outgoing as p (p.id)}
					<li class="flex items-center gap-3 px-3 py-3">
						<div class="flex flex-1 flex-col">
							<span class="text-lg">{p.toName}</span>
							<span class="bp-label text-xs opacity-60">Waiting for them to accept</span>
						</div>
						<button
							class="btn btn-ghost bp-label btn-sm"
							onclick={act(() => s.removePairing(p.id))}
						>
							Cancel
						</button>
					</li>
				{/each}
				{#each s.accepted as p (p.id)}
					<li class="flex items-center gap-3 px-3 py-3">
						<div class="flex flex-1 flex-col">
							<span class="text-lg">{s.partnerName(p)}</span>
							<span class="bp-label text-xs">Paired · same team</span>
						</div>
						<button
							class="btn btn-ghost bp-label btn-sm"
							onclick={act(() => s.removePairing(p.id))}
						>
							Unpair
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section
		class="flex items-center justify-center gap-3 border border-dashed border-bp-line/40 py-6"
	>
		<span class="size-2 animate-pulse bg-bp-line"></span>
		<span class="bp-label text-lg">Waiting for launch</span>
	</section>
</div>
