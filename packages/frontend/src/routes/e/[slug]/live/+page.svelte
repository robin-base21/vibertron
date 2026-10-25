<script lang="ts">
	import { untrack } from 'svelte';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import BigCountdown from '$lib/blueprint/live/BigCountdown.svelte';
	import MessageFeed from '$lib/blueprint/live/MessageFeed.svelte';
	import TeamList from '$lib/blueprint/live/TeamList.svelte';
	import VotingPanel from '$lib/blueprint/live/VotingPanel.svelte';
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
		return untrack(() =>
			fixture ? startFixture(liveEvent, fixture, data.fixtureOptions) : liveEvent.start()
		);
	});

	const snap = $derived(liveEvent.snapshot);
	const phase = $derived(livePhase(snap, liveEvent.error, clock.now));
	const teams = $derived(phase === 'pre' ? [] : (snap?.teams ?? []));
	const votingPhase = $derived(
		phase === 'live' || phase === 'ended' ? (snap?.event.votingPhase ?? 'none') : 'none'
	);
	let voteHighlight = $state<string | null>(null);
	const statusLabel = $derived(
		votingPhase !== 'none'
			? { group: 'Voting · round 1', pitch: 'Voting · round 2', results: 'Results' }[votingPhase]
			: {
					loading: 'Connecting',
					missing: 'Not found',
					pre: 'Starting soon',
					live: 'Live',
					ended: 'Finished'
				}[phase]
	);
</script>

<svelte:head>
	<title>{snap ? `${snap.event.name} · Live` : 'Live · Vibertron'}</title>
</svelte:head>

<main class="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:py-8">
	{#if phase === 'loading'}
		<p class="py-20 text-center bp-label text-xl opacity-50">Connecting…</p>
	{:else if phase === 'missing'}
		<div class="flex flex-col items-center gap-2 py-20 text-center">
			<p class="bp-label text-3xl">Event not found</p>
			<p class="font-mono text-sm opacity-60">/e/{data.slug}</p>
		</div>
	{:else if snap}
		<header class="flex flex-wrap items-end gap-x-4 gap-y-1">
			<div class="mr-auto flex flex-col">
				<span class="flex items-center gap-2 bp-label text-xs opacity-60">
					<span
						class={[
							'inline-block size-2',
							wsStore.connected || data.fixture ? 'bg-bp-line' : 'border border-bp-line'
						]}
					></span>
					{statusLabel}
				</span>
				<h1 class="bp-label text-4xl leading-none font-semibold break-words sm:text-5xl">
					{snap.event.name}
				</h1>
			</div>
			{#if phase !== 'pre'}
				<span class="font-mono text-xs opacity-60"
					>{teams.length} TEAMS · {snap.participantCount} PEOPLE</span
				>
			{/if}
		</header>

		{#if votingPhase !== 'none'}
			<!-- read-only: voting happens on the attendee page -->
			{#key votingPhase}
				<VotingPanel
					voting={snap.voting}
					{teams}
					projects={snap.projects}
					bind:highlightTeamId={voteHighlight}
					revealMs={1800}
					class="border border-bp-line/50 p-4 text-base sm:text-lg"
				/>
			{/key}
		{:else}
			<section class="border border-bp-line/50 p-4">
				{#if phase === 'pre'}
					<p class="bp-label text-3xl leading-none font-bold sm:text-4xl">Join at the venue</p>
					<p class="mt-2 text-sm opacity-70">Scan the QR code on the venue screen to take part.</p>
					<p class="mt-3 font-mono text-sm">
						<span class="text-2xl">{snap.participantCount}</span> JOINED
					</p>
				{:else if phase === 'live'}
					<span class="bp-label text-xs opacity-60">Time remaining</span>
					<BigCountdown endsAt={snap.event.endsAt} class="text-[clamp(2.75rem,14vw,6rem)]" />
				{:else}
					<p class="bp-label text-[clamp(2.5rem,12vw,5rem)] leading-none font-bold">Time's up</p>
				{/if}
			</section>
		{/if}

		{#if snap.blueprint}
			<Blueprint
				blueprint={snap.blueprint}
				{teams}
				highlightTeamId={voteHighlight ?? liveEvent.flashTeamId ?? undefined}
				class="w-full border border-bp-line/40"
			/>
		{/if}

		{#if phase !== 'pre'}
			<div class="grid gap-4 md:grid-cols-2">
				<section class="flex flex-col gap-2">
					<h2 class="bp-label text-xs opacity-60">
						{phase === 'ended' ? 'Final codenames' : 'Teams'} ·
						<span class="font-mono">{teams.length}</span>
					</h2>
					<TeamList
						{teams}
						blueprint={snap.blueprint}
						flashTeamId={liveEvent.flashTeamId}
						projects={phase === 'live' && votingPhase === 'none' ? snap.projects : undefined}
						class="text-lg"
					/>
				</section>
				<section class="flex flex-col gap-2">
					<h2 class="bp-label text-xs opacity-60">Messages</h2>
					<MessageFeed messages={liveEvent.messages} limit={30} class="text-base" />
				</section>
			</div>
		{/if}
	{/if}
</main>
