<script lang="ts">
	import type { ProjectDTO, TeamDTO, VotingStateDTO } from 'common';
	import { untrack } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { groupRows, pitchRanking, teamLabel, winnerByDraw } from './voting';

	interface Props {
		voting: VotingStateDTO;
		teams: TeamDTO[];
		projects: ProjectDTO[];
		/** Team to highlight on the blueprint: the pitch being revealed, then the winner. */
		highlightTeamId?: string | null;
		/** Delay between pitch reveals. */
		revealMs?: number;
		class?: string;
	}

	let {
		voting,
		teams,
		projects,
		highlightTeamId = $bindable(null),
		revealMs = 2600,
		class: className = ''
	}: Props = $props();

	// Sized in em: the TV scales the font with the viewport, the /live page uses a fixed size.
	// Mount this per phase ({#key phase}) so every phase change replays its reveal.

	const teamById = $derived(new Map(teams.map((t) => [t.id, t])));
	const rows = $derived(groupRows(voting, teams, projects));
	const pitches = $derived(voting.pitches);
	const ranking = $derived(pitchRanking(voting, teams, projects));
	const winner = $derived(ranking[0]);

	// Pitch reveal: one project per step; skipped when the page opens mid-round (ballots already in).
	// One extra step keeps the last project highlighted for a moment.
	let step = $state(
		untrack(() =>
			voting.phase === 'pitch' && voting.pitch.cast > 0 ? voting.pitches.length + 1 : 0
		)
	);
	const shown = $derived(Math.min(step, pitches.length));
	const revealing = $derived(voting.phase === 'pitch' && step <= pitches.length);
	$effect(() => {
		if (voting.phase !== 'pitch' || step > pitches.length) return;
		const timer = setTimeout(() => step++, step === 0 ? 1000 : revealMs);
		return () => clearTimeout(timer);
	});

	// Results: a short drum roll, then the winner, then the ranking.
	let winnerOut = $state(false);
	$effect(() => {
		if (voting.phase !== 'results') return;
		const timer = setTimeout(() => (winnerOut = true), 1600);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		highlightTeamId =
			voting.phase === 'pitch' && step >= 1 && step <= pitches.length
				? (pitches[step - 1]?.teamId ?? null)
				: voting.phase === 'results' && winnerOut
					? (winner?.project?.teamId ?? null)
					: null;
		return () => (highlightTeamId = null);
	});
</script>

<section
	class={['flex min-h-0 flex-col gap-[0.8em]', className]}
	data-testid="voting-panel"
	data-phase={voting.phase}
>
	{#if voting.phase === 'group'}
		<header
			class="flex items-end justify-between gap-[0.6em] border-y border-bp-line/50 py-[0.5em]"
		>
			<div class="flex flex-col">
				<span class="bp-label text-[0.8em] opacity-60">Round 1</span>
				<h2 class="bp-label text-[2.6em] leading-[0.9] font-bold">Team voting</h2>
			</div>
			<div class="flex flex-col items-end">
				<span class="font-mono text-[2.6em] leading-none tabular-nums"
					>{voting.group.teamsDone}/{voting.group.teamsTotal}</span
				>
				<span class="bp-label text-[0.7em] opacity-60">Teams done</span>
			</div>
		</header>
		<p class="text-[0.9em] opacity-70">
			Rank your teammates' projects on your phone. The top project of each team pitches.
		</p>
		<ul class={['flex min-h-0 flex-col overflow-hidden', rows.length > 8 && 'text-[0.8em]']}>
			{#each rows as r (r.team.id)}
				<li
					class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[0.8em] border-b border-bp-line/20 py-[0.45em]"
				>
					<span class={['truncate bp-label font-semibold', r.mode !== 'vote' && 'opacity-60']}
						>{teamLabel(r.team)}</span
					>
					{#if r.mode === 'vote'}
						<span class="flex items-center gap-[0.5em]">
							<span class="flex gap-[0.2em]" aria-label="{r.cast} of {r.eligible} ballots">
								{#each { length: r.eligible }, i (i)}
									<span
										class={[
											'inline-block size-[0.8em] border border-bp-line transition-colors duration-500',
											i < r.cast ? 'bg-bp-line' : 'opacity-40'
										]}
									></span>
								{/each}
							</span>
							<span
								class={['w-[3.2em] text-right bp-label text-[0.75em]', !r.done && 'opacity-50']}
							>
								{r.done ? '✓ Done' : `${r.cast}/${r.eligible}`}
							</span>
						</span>
					{:else}
						<span class="bp-label text-[0.7em] opacity-60"
							>{r.mode === 'through' ? 'Straight through' : 'No project'}</span
						>
					{/if}
				</li>
			{:else}
				<li class="bp-label py-[0.5em] opacity-50">No teams</li>
			{/each}
		</ul>
	{:else if voting.phase === 'pitch'}
		<header class="flex flex-col border-y border-bp-line/50 py-[0.5em]">
			<span class="bp-label text-[0.8em] opacity-60">Round 2</span>
			<h2 class="bp-label text-[2.6em] leading-[0.9] font-bold">
				{revealing ? 'The pitches' : 'Pitch voting'}
			</h2>
		</header>
		<ol class="flex min-h-0 flex-col gap-[0.3em] overflow-hidden">
			{#each pitches.slice(0, shown) as p, i (p.id)}
				<li
					in:fly={{ x: 40, duration: 600 }}
					class={[
						'grid grid-cols-[2.2em_minmax(0,1fr)] items-baseline gap-x-[0.5em] border px-[0.5em] py-[0.4em] transition-colors duration-700',
						revealing && i === shown - 1 ? 'border-bp-accent bg-bp-accent/15' : 'border-bp-line/25'
					]}
				>
					<span class="font-mono text-[1.6em] leading-none opacity-60"
						>{String(i + 1).padStart(2, '0')}</span
					>
					<div class="flex min-w-0 flex-col">
						<span class="truncate bp-label text-[1.5em] leading-tight font-bold">{p.name}</span>
						<span class="truncate text-[0.85em] opacity-70">
							{p.authorName} · <span class="bp-label">{teamLabel(teamById.get(p.teamId))}</span>
						</span>
					</div>
				</li>
			{/each}
		</ol>
		{#if pitches.length === 0}
			<p class="py-[0.5em] bp-label opacity-50">No pitches</p>
		{/if}
		{#if !revealing}
			<footer
				in:fade
				class="mt-auto flex flex-col gap-[0.3em] border-t border-bp-line/50 pt-[0.5em]"
			>
				<div class="flex items-baseline justify-between">
					<span class="bp-label text-[0.8em] opacity-60">Ballots cast</span>
					<span class="font-mono text-[2.4em] leading-none tabular-nums" data-testid="ballots-cast">
						{voting.pitch.cast}<span class="opacity-50">/{voting.pitch.eligible}</span>
					</span>
				</div>
				<div class="h-[0.35em] border border-bp-line/50">
					<div
						class="h-full bg-bp-line transition-[width] duration-700"
						style:width="{voting.pitch.eligible
							? (100 * voting.pitch.cast) / voting.pitch.eligible
							: 0}%"
					></div>
				</div>
				<p class="text-[0.85em] opacity-70">
					Rank the pitches on your phone. You can't vote for your own.
				</p>
			</footer>
		{/if}
	{:else if voting.phase === 'results'}
		{#if !winnerOut}
			<div out:fade={{ duration: 200 }} class="flex flex-1 items-center justify-center">
				<p class="animate-pulse bp-label text-[2.6em] leading-[0.95] font-bold">
					And the<br />winner is…
				</p>
			</div>
		{:else if winner}
			<div
				in:scale={{ start: 0.6, duration: 700 }}
				class="flex flex-col gap-[0.2em] border border-bp-accent p-[0.7em]"
				data-testid="winner"
			>
				<span class="bp-label text-[0.8em] text-bp-accent">Winner</span>
				<p class="bp-label text-[3.4em] leading-[0.9] font-bold break-words">
					{winner.project?.name ?? winner.projectId}
				</p>
				<p class="text-[1.1em]">
					{winner.project?.authorName ?? ''} ·
					<span class="bp-label">{teamLabel(winner.team)}</span>
				</p>
				<p class="font-mono text-[0.85em] opacity-70">
					{winner.points} PTS · {winner.firsts}× #1{#if winnerByDraw(ranking)}&nbsp;· DECIDED BY
						DRAW{/if}
				</p>
			</div>
			<ol class="flex min-h-0 flex-col overflow-hidden">
				{#each ranking.slice(1) as r, i (r.projectId)}
					<li
						in:fly={{ y: 16, duration: 450, delay: 500 + i * 220 }}
						class="grid grid-cols-[2em_minmax(0,1fr)_auto] items-baseline gap-x-[0.6em] border-b border-bp-line/20 py-[0.35em]"
					>
						<span class="font-mono opacity-60">{r.rank}.</span>
						<span class="min-w-0 truncate">
							<span class="bp-label font-semibold">{r.project?.name ?? r.projectId}</span>
							<span class="text-[0.8em] opacity-60">
								· {r.project?.authorName ?? ''} · {teamLabel(r.team)}</span
							>
						</span>
						<span class="font-mono text-[0.85em] whitespace-nowrap tabular-nums">
							{r.points}<span class="opacity-50"> PTS</span>{#if r.tieBrokenByDraw}<span
									class="opacity-60"
								>
									· DRAW</span
								>{/if}
						</span>
					</li>
				{/each}
			</ol>
			{#if ranking.some((r) => r.tieBrokenByDraw)}
				<p in:fade={{ delay: 500 + ranking.length * 220 }} class="text-[0.75em] opacity-60">
					DRAW: tied on points and first places, decided by a seeded draw.
				</p>
			{/if}
		{:else}
			<p class="py-[0.5em] bp-label opacity-50">No results</p>
		{/if}
	{/if}
</section>
