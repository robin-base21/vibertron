<script lang="ts">
	import { untrack } from 'svelte';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import BigCountdown from '$lib/blueprint/live/BigCountdown.svelte';
	import MessageFeed from '$lib/blueprint/live/MessageFeed.svelte';
	import PagedTeamList from '$lib/blueprint/live/PagedTeamList.svelte';
	import { LiveEvent, livePhase } from '$lib/blueprint/live.svelte';
	import { startFixture } from '$lib/blueprint/liveFixture';
	import { clock } from '$lib/stores/clock.svelte';
	import { wsStore } from '$lib/stores/websocket.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	const liveEvent = new LiveEvent(data.slug);

	// Subscription setup only; untracked so WS reconnects don't tear it down and redo it.
	$effect(() => {
		const fixture = data.fixture;
		return untrack(() => (fixture ? startFixture(liveEvent, fixture, data.fixtureTeams) : liveEvent.start()));
	});

	const snap = $derived(liveEvent.snapshot);
	const phase = $derived(livePhase(snap, liveEvent.error, clock.now));
	const teams = $derived(phase === 'pre' ? [] : (snap?.teams ?? []));
	const named = $derived(teams.filter((t) => t.codename));
</script>

<svelte:head>
	<title>{snap ? `${snap.event.name} · TV` : 'Vibertron TV'}</title>
</svelte:head>

<main class="grid h-dvh w-screen grid-cols-[minmax(0,7fr)_minmax(0,3fr)] overflow-hidden bg-bp-bg text-[1.15vw]">
	<section class="relative min-h-0 border-r border-bp-line/40 p-[1.5vw]">
		{#if snap?.blueprint}
			<Blueprint
				blueprint={snap.blueprint}
				{teams}
				highlightTeamId={liveEvent.flashTeamId ?? undefined}
				class="h-full w-full"
			/>
		{:else}
			<div class="flex h-full items-center justify-center border border-dashed border-bp-line/30">
				<span class="bp-label text-[2em] opacity-40">{phase === 'missing' ? 'Event not found' : 'Blueprint pending'}</span>
			</div>
		{/if}
	</section>

	<aside class="flex min-h-0 flex-col gap-[1.2em] p-[1.6vw]">
		{#if phase === 'loading'}
			<p class="bp-label m-auto text-[2em] opacity-50">Connecting…</p>
		{:else if phase === 'missing'}
			<p class="bp-label m-auto text-center text-[2em]">No event at<br /><span class="font-mono">/{data.slug}</span></p>
		{:else if snap}
			<header class="flex flex-col gap-[0.2em]">
				<span class="bp-label text-[0.8em] opacity-60">
					{phase === 'pre' ? 'Starting soon' : phase === 'live' ? 'Live' : 'Finished'}
				</span>
				<h1 class="bp-label text-[2.4em] leading-[0.95] font-semibold break-words">{snap.event.name}</h1>
			</header>

			{#if phase === 'pre'}
				<div class="flex flex-1 flex-col justify-center gap-[1.5em]">
					<p class="bp-label text-[4.2em] leading-[0.9] font-bold">Join at<br />the venue</p>
					<p class="text-[1.1em] opacity-70">Scan the QR code on the venue screen with your phone.</p>
					<div class="border border-bp-line/50 p-[0.8em]">
						<span class="bp-label text-[0.8em] opacity-60">Participants</span>
						<p class="font-mono text-[4em] leading-none tabular-nums">{snap.participantCount}</p>
					</div>
				</div>
			{:else if phase === 'live'}
				<div class="border-y border-bp-line/50 py-[0.6em]">
					<span class="bp-label text-[0.8em] opacity-60">Time remaining</span>
					<BigCountdown endsAt={snap.event.endsAt} class="text-[4.6em]" />
				</div>
				<section class="flex min-h-0 flex-[1.1] flex-col gap-[0.4em] overflow-hidden">
					<h2 class="bp-label text-[0.8em] opacity-60">Teams · <span class="font-mono">{teams.length}</span></h2>
					<PagedTeamList {teams} blueprint={snap.blueprint} flashTeamId={liveEvent.flashTeamId} dense={teams.length > 5} class="flex-1 text-[1.1em]" />
				</section>
				<section class="flex min-h-0 flex-1 flex-col gap-[0.4em] overflow-hidden">
					<h2 class="bp-label text-[0.8em] opacity-60">Messages</h2>
					<MessageFeed messages={liveEvent.messages} class="min-h-0 overflow-hidden" />
				</section>
			{:else}
				<div class="border-y border-bp-line/50 py-[0.8em]">
					<p class="bp-label text-[5em] leading-[0.9] font-bold">Time's up</p>
					<BigCountdown endsAt={0} class="mt-[0.2em] text-[2em] opacity-50" />
				</div>
				<section class="flex min-h-0 flex-1 flex-col gap-[0.4em] overflow-hidden">
					<h2 class="bp-label text-[0.8em] opacity-60">Final codenames · <span class="font-mono">{named.length}</span></h2>
					<PagedTeamList {teams} blueprint={snap.blueprint} dense={teams.length > 5} class="flex-1 text-[1.4em]" />
				</section>
			{/if}

			<footer class="mt-auto flex items-center gap-2 font-mono text-[0.65em] opacity-50">
				<span class={['inline-block size-[0.6em]', wsStore.connected || data.fixture ? 'bg-bp-line' : 'border border-bp-line']}></span>
				{wsStore.connected || data.fixture ? 'LIVE' : 'RECONNECTING'} · VIBERTRON
			</footer>
		{/if}
	</aside>
</main>
