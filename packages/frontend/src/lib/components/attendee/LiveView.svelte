<script lang="ts">
	import { ApiError } from '$lib/api';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import Countdown from '$lib/components/Countdown.svelte';
	import ProjectCard from '$lib/components/attendee/ProjectCard.svelte';
	import VotingCard from '$lib/components/attendee/VotingCard.svelte';
	import type { AttendeeState } from '$lib/stores/attendee.svelte';
	import { clock } from '$lib/stores/clock.svelte';
	import { errorMessage, handleError } from '$lib/stores/toast.svelte';
	import { MESSAGE_MAX_LENGTH, MESSAGE_RATE_LIMIT_MS, teamColor } from 'common';

	let { state: s }: { state: AttendeeState } = $props();

	const ended = $derived(s.ctx.event.status === 'ended');
	const team = $derived(s.ctx.team);
	const color = $derived(team ? teamColor(team.position) : null);
	const stationLabel = $derived(
		s.stationNumber === null ? '—' : String(s.stationNumber).padStart(2, '0')
	);

	// ----- codename -----
	let editingCodename = $state(false);
	let codenameDraft = $state('');
	let savingCodename = $state(false);

	function editCodename() {
		codenameDraft = team?.codename ?? '';
		editingCodename = true;
	}

	async function saveCodename(e: SubmitEvent) {
		e.preventDefault();
		savingCodename = true;
		try {
			await s.setCodename(codenameDraft);
			editingCodename = false;
		} catch (err) {
			handleError(err);
		} finally {
			savingCodename = false;
		}
	}

	// ----- messages -----
	let body = $state('');
	let posting = $state(false);
	let cooldownUntil = $state(0);
	let postError = $state<string | null>(null);

	const cooldownLeft = $derived(Math.max(0, cooldownUntil - clock.now));
	const remaining = $derived(MESSAGE_MAX_LENGTH - body.length);
	const canPost = $derived(
		body.trim().length > 0 && remaining >= 0 && !posting && cooldownLeft === 0
	);
	const feed = $derived([...s.messages].reverse());

	async function post(e: SubmitEvent) {
		e.preventDefault();
		if (!canPost) return;
		posting = true;
		postError = null;
		try {
			await s.post(body);
			body = '';
			cooldownUntil = clock.now + MESSAGE_RATE_LIMIT_MS;
		} catch (err) {
			if (err instanceof ApiError && err.status === 429) {
				const retry = (err.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
				cooldownUntil = clock.now + (retry ?? MESSAGE_RATE_LIMIT_MS);
			} else {
				postError = errorMessage(err);
			}
		} finally {
			posting = false;
		}
	}
</script>

<div class="flex flex-col gap-6">
	<section class="flex items-end justify-between gap-4 border-b border-bp-line/40 pb-4">
		<div class="flex min-w-0 flex-col">
			<span class="truncate bp-label text-xs opacity-60">{s.ctx.event.name}</span>
			<span class="bp-label text-sm">{ended ? 'Event ended' : 'Time left'}</span>
		</div>
		<Countdown endsAt={ended ? 0 : s.ctx.event.endsAt} class="text-4xl leading-none" />
	</section>

	{#if ended}
		<section class="flex flex-col gap-2 border border-bp-line/60 p-5">
			<h1 class="bp-label text-4xl font-semibold">That’s a wrap</h1>
			<p class="font-mono text-sm opacity-70">
				Thanks for building with us{team?.codename ? `, ${team.codename}` : ''}.
			</p>
		</section>
	{/if}

	{#if team && color}
		<!-- Team colour band: matches the team's stations on the TV and helps teammates find each other. -->
		<div class="flex items-center gap-3 px-4 py-3 text-[#0a0a0a]" style:background-color={color.hex}>
			<span class="bp-label text-2xl font-bold whitespace-nowrap">Team {color.name}</span>
			<span class="ml-auto truncate bp-label text-lg font-semibold">{team.codename ?? team.name}</span>
			{#if color.striped}
				<span
					class="h-7 w-9 shrink-0"
					style:background="repeating-linear-gradient(45deg, #0a0a0a 0 3px, transparent 3px 6px)"
					aria-hidden="true"
				></span>
			{/if}
		</div>
	{/if}

	{#if team}
		<VotingCard state={s} />
	{/if}

	{#if team && s.ctx.stationId}
		<section class="flex flex-col gap-1">
			<span class="bp-label text-sm opacity-60">Your workstation</span>
			<h1 class="bp-label text-4xl leading-tight font-semibold">
				{s.segment?.name ?? team.segmentId}
				<span class="opacity-50">·</span>
				Station <span class="font-mono">{stationLabel}</span>
			</h1>
			<p class="font-mono text-xs opacity-60">
				Head to <span class="bp-label text-sm opacity-100">{s.segment?.name ?? team.segmentId}</span
				>
				and find station <span class="opacity-100">{stationLabel}</span>
				(<span class="opacity-100">{s.ctx.stationId}</span>).
				{#if s.teammates.length > 0}
					You’re with {s.teammates.map((m) => m.displayName).join(', ')}.
				{/if}
			</p>
		</section>

		{#if s.ctx.blueprint}
			<Blueprint
				blueprint={s.ctx.blueprint}
				teams={[team]}
				highlightStationId={s.ctx.stationId}
				highlightSegmentId={team.segmentId}
				class="w-full border border-bp-line/40"
			/>
		{/if}

		<section class="flex flex-col gap-2">
			<h2 class="bp-label text-lg">
				Team <span class="font-mono text-sm opacity-60">{team.name}</span>
			</h2>
			<ul class="flex flex-col divide-y divide-bp-line/20 border border-bp-line/40">
				{#each team.members as m (m.participantId)}
					<li class="flex items-center justify-between px-3 py-2">
						<span class={m.participantId === s.me.id ? 'font-semibold' : ''}>
							{m.displayName}{m.participantId === s.me.id ? ' (you)' : ''}
						</span>
						<span class="font-mono text-xs opacity-60">{m.stationId}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="flex flex-col gap-2">
			<span class="bp-label text-xs opacity-60">Team codename</span>
			{#if editingCodename || (!team.codename && !ended)}
				<form class="flex gap-2" onsubmit={saveCodename}>
					<input
						class="input min-w-0 flex-1 bp-label input-lg"
						placeholder="Pick a name for the TV"
						maxlength="32"
						required
						bind:value={codenameDraft}
					/>
					<button
						class="btn bp-label btn-lg btn-primary"
						disabled={savingCodename || !codenameDraft.trim()}
					>
						Save
					</button>
					{#if editingCodename}
						<button
							type="button"
							class="btn btn-ghost bp-label btn-lg"
							onclick={() => (editingCodename = false)}
						>
							Cancel
						</button>
					{/if}
				</form>
				<p class="font-mono text-xs opacity-50">
					Shared by your whole team. Set it to unlock messages.
				</p>
			{:else}
				<div class="flex items-center justify-between gap-2 border border-bp-line/60 px-4 py-3">
					<span class="bp-label text-3xl font-semibold">{team.codename ?? '—'}</span>
					{#if !ended}
						<button class="btn btn-ghost bp-label btn-sm" onclick={editCodename}>Edit</button>
					{/if}
				</div>
			{/if}
		</section>

		<ProjectCard state={s} />
	{:else if !ended}
		<section class="border border-dashed border-bp-line/40 p-6 text-center">
			<p class="bp-label text-lg">Assigning your station…</p>
			<p class="mt-1 font-mono text-xs opacity-60">
				If this doesn’t change, ask an organiser: you may have joined after launch.
			</p>
		</section>
	{/if}

	{#if team?.codename && !ended}
		<form class="flex flex-col gap-2" onsubmit={post}>
			<label class="flex flex-col gap-1">
				<span class="bp-label text-xs opacity-60">Message the room</span>
				<textarea
					class="textarea w-full text-base"
					rows="3"
					maxlength={MESSAGE_MAX_LENGTH}
					placeholder="Shows up on the venue TV"
					bind:value={body}
				></textarea>
			</label>
			<div class="flex items-center justify-between gap-2">
				<span class={['font-mono text-xs', remaining < 20 ? 'text-error' : 'opacity-60']}>
					{remaining}
				</span>
				{#if postError}<span class="font-mono text-xs text-error">{postError}</span>{/if}
				<button class="btn bp-label btn-primary" disabled={!canPost}>
					{cooldownLeft > 0
						? `Wait ${Math.ceil(cooldownLeft / 1000)}s`
						: posting
							? 'Posting…'
							: 'Post'}
				</button>
			</div>
		</form>
	{/if}

	{#if feed.length > 0}
		<section class="flex flex-col gap-2">
			<h2 class="bp-label text-lg">Messages</h2>
			<ul class="flex flex-col divide-y divide-bp-line/20 border border-bp-line/40">
				{#each feed as m (m.id)}
					<li class="flex flex-col gap-0.5 px-3 py-2">
						<div class="flex items-baseline gap-2">
							<span class={['bp-label text-sm', m.teamId === team?.id && 'text-bp-accent']}>
								{m.codename}
							</span>
							<span class="truncate font-mono text-xs opacity-50">{m.authorName}</span>
							<span class="ml-auto shrink-0 font-mono text-xs opacity-50">
								{new Date(m.createdAt).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit'
								})}
							</span>
						</div>
						<p class="text-sm break-words">{m.body}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
