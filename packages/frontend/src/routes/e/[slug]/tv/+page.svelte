<script lang="ts">
	import { untrack } from 'svelte';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import LogoMark from '$lib/components/LogoMark.svelte';
	import QrSvg from '$lib/components/QrSvg.svelte';
	import BigCountdown from '$lib/blueprint/live/BigCountdown.svelte';
	import Fireworks from '$lib/blueprint/live/Fireworks.svelte';
	import MessageBubbles from '$lib/blueprint/live/MessageBubbles.svelte';
	import TeamStrip from '$lib/blueprint/live/TeamStrip.svelte';
	import VotingPanel from '$lib/blueprint/live/VotingPanel.svelte';
	import { LiveEvent, livePhase } from '$lib/blueprint/live.svelte';
	import { startFixture } from '$lib/blueprint/liveFixture';
	import { clock } from '$lib/stores/clock.svelte';
	import { wsStore } from '$lib/stores/websocket.svelte';
	import { page } from '$app/state';
	import { teamColor } from 'common';
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
	let mainH = $state(0);
	const votingPhase = $derived(
		phase === 'live' || phase === 'ended' ? (snap?.event.votingPhase ?? 'none') : 'none'
	);
	// Fixed link back to the attendee page (non-participants land on the public live view), so
	// people who closed the browser can always find the event again.
	const eventUrl = $derived(`${page.url.origin}/e/${data.slug}`);
	/** Team highlighted by the voting reveal (pitch being presented, then the winner). */
	let voteHighlight = $state<string | null>(null);
	/** Fireworks in the winner's team colour once the results reveal the winner. */
	const winnerColor = $derived.by(() => {
		if (votingPhase !== 'results' || !voteHighlight) return null;
		const team = teams.find((t) => t.id === voteHighlight);
		return team ? teamColor(team.position).hex : null;
	});
	const statusLabel = $derived(
		votingPhase === 'group'
			? 'Voting · round 1'
			: votingPhase === 'pitch'
				? 'Voting · round 2'
				: votingPhase === 'results'
					? 'Results'
					: phase === 'pre'
						? 'Starting soon'
						: phase === 'live'
							? 'Live'
							: 'Finished'
	);
</script>

<svelte:head>
	<title>{snap ? `${snap.event.name} · TV` : 'Vibertron TV'}</title>
</svelte:head>

<main
	class="grid h-dvh w-screen grid-cols-[minmax(0,7fr)_minmax(0,3fr)] overflow-hidden bg-bp-bg text-[1.15vw]"
>
	<!-- Main view: teams (or the voting panel) on top, the plan below, messages bubbling up over it. -->
	<section
		class="flex min-h-0 flex-col gap-[1.2em] border-r border-bp-line/40 p-[1.5vw]"
		bind:clientHeight={mainH}
	>
		{#if snap && votingPhase !== 'none'}
			{#key votingPhase}
				<VotingPanel
					voting={snap.voting}
					{teams}
					projects={snap.projects}
					bind:highlightTeamId={voteHighlight}
					wide
					class="min-h-[46%] shrink-0 text-[1.1em]"
				/>
			{/key}
		{:else if snap && teams.length > 0}
			<TeamStrip
				{teams}
				blueprint={snap.blueprint}
				flashTeamId={liveEvent.flashTeamId}
				projects={phase === 'live' ? snap.projects : undefined}
				maxHeight={mainH * 0.4}
				class="shrink-0"
			/>
		{/if}

		<div class="relative min-h-0 flex-1">
			{#if snap?.blueprint}
				<Blueprint
					blueprint={snap.blueprint}
					{teams}
					highlightTeamId={voteHighlight ?? liveEvent.flashTeamId ?? undefined}
					showUnderlay
					class="h-full w-full"
				/>
			{:else}
				<div class="flex h-full items-center justify-center border border-dashed border-bp-line/30">
					<span class="bp-label text-[2em] opacity-40"
						>{phase === 'missing' ? 'Event not found' : 'Blueprint pending'}</span
					>
				</div>
			{/if}
			{#if phase === 'live' && votingPhase === 'none'}
				<MessageBubbles
					messages={liveEvent.messages}
					{teams}
					class="absolute bottom-0 left-0 w-[45%]"
				/>
			{/if}
		</div>
	</section>

	<aside class="flex min-h-0 flex-col gap-[1.2em] p-[1.6vw]">
		{#if phase === 'loading'}
			<p class="m-auto bp-label text-[2em] opacity-50">Connecting…</p>
		{:else if phase === 'missing'}
			<p class="m-auto text-center bp-label text-[2em]">
				No event at<br /><span class="font-mono">/{data.slug}</span>
			</p>
		{:else if snap}
			<header class="flex flex-col gap-[0.2em]">
				<span class="bp-label text-[0.8em] opacity-60">{statusLabel}</span>
				<h1 class="bp-label text-[2.4em] leading-[0.95] font-semibold break-words">
					{snap.event.name}
				</h1>
			</header>

			<div class="flex min-h-0 flex-1 flex-col justify-center gap-[0.8em] overflow-hidden">
				{#if votingPhase !== 'none'}
					<p class="bp-label text-[2.2em] leading-[0.95] font-bold">
						{votingPhase === 'group'
							? 'Rank your team’s projects on your phone'
							: votingPhase === 'pitch'
								? 'Rank the pitches on your phone'
								: 'Thanks for building!'}
					</p>
				{:else if phase === 'pre'}
					<p class="bp-label text-[3em] leading-[0.9] font-bold">Join at the venue</p>
					<p class="text-[1em] opacity-70">Scan the join QR on the venue screen with your phone.</p>
					<p class="flex items-baseline gap-[0.5em]">
						<span class="font-mono text-[2.6em] leading-none tabular-nums"
							>{snap.participantCount}</span
						>
						<span class="bp-label text-[0.8em] opacity-60">Participants</span>
					</p>
				{:else if phase === 'live'}
					<div class="border-y border-bp-line/50 py-[0.6em]">
						<span class="bp-label text-[0.8em] opacity-60">Time remaining</span>
						<BigCountdown endsAt={snap.event.endsAt} class="text-[4.6em]" />
					</div>
				{:else}
					<div class="border-y border-bp-line/50 py-[0.8em]">
						<p class="bp-label text-[4em] leading-[0.9] font-bold">Time's up</p>
						<BigCountdown endsAt={0} class="mt-[0.2em] text-[2em] opacity-50" />
					</div>
				{/if}
			</div>

			<footer class="flex shrink-0 flex-col gap-[0.6em] border-t border-bp-line/40 pt-[1em]">
				<div class="flex items-baseline justify-between gap-[1em]">
					<span class="bp-label text-[1.3em] font-semibold">
						{phase === 'pre' ? 'Already joined?' : 'Lost the app?'}
					</span>
					<span class="text-[0.85em] opacity-70">Scan to get back to your event page</span>
				</div>
				<QrSvg text={eventUrl} class="aspect-square w-full" />
				<div class="flex items-center justify-between gap-[1em] font-mono text-[0.65em] opacity-60">
					<span class="break-all">{eventUrl.replace(/^https?:\/\//, '')}</span>
					<span class="flex shrink-0 items-center gap-2">
						<span
							class={[
								'inline-block size-[0.6em]',
								wsStore.connected || data.fixture ? 'bg-bp-line' : 'border border-bp-line'
							]}
						></span>
						{wsStore.connected || data.fixture ? 'LIVE' : 'RECONNECTING'} ·
						<LogoMark class="h-[1.1em] w-auto" />VIBERTRON
					</span>
				</div>
			</footer>
		{/if}
	</aside>
</main>

{#if winnerColor}
	<Fireworks
		colors={[winnerColor, '#f5f5f5']}
		class="fixed inset-0 z-40 h-dvh w-screen"
	/>
{/if}
