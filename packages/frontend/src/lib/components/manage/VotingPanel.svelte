<script lang="ts">
	import { voting as votingApi } from '$lib/api';
	import { handleError } from '$lib/stores/toast.svelte';
	import type {
		EventDTO,
		ProjectDTO,
		TallyRow,
		TeamDTO,
		VotingActionBody,
		VotingStateDTO
	} from 'common';
	import { Check } from '@lucide/svelte';

	interface Props {
		event: EventDTO;
		teams: TeamDTO[];
		projects: ProjectDTO[];
		voting: VotingStateDTO | null;
		onchange: (event: EventDTO, voting: VotingStateDTO) => void;
	}

	let { event, teams, projects, voting, onchange }: Props = $props();

	const phase = $derived(voting?.phase ?? event.votingPhase ?? 'none');
	let busy = $state(false);

	const teamLabel = (t: TeamDTO) => (t.codename ? `${t.codename}` : t.name);
	const sortedTeams = $derived(
		[...teams].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
	);
	const byParticipant = $derived(new Map(projects.map((p) => [p.participantId, p])));
	const byId = $derived(new Map([...projects, ...(voting?.pitches ?? [])].map((p) => [p.id, p])));
	const teamById = $derived(new Map(teams.map((t) => [t.id, t])));
	const memberCount = $derived(teams.reduce((n, t) => n + t.members.length, 0));
	const progress = $derived(new Map((voting?.group.perTeam ?? []).map((t) => [t.teamId, t])));

	const CONFIRM: Record<VotingActionBody['action'], string | null> = {
		start: 'Start team voting? Project names lock once voting starts.',
		'close-group': 'Close the team round now? Teams that haven’t finished are tallied as they are.',
		'close-pitch': 'Close the pitch round and reveal the winner?',
		reset: 'Reset voting? All ballots and results are deleted and projects unlock.'
	};

	async function act(action: VotingActionBody['action']) {
		const message = CONFIRM[action];
		if (message && !confirm(message)) return;
		busy = true;
		try {
			const res = await votingApi.action(event.id, { action });
			onchange(res.event, res.voting);
		} catch (err) {
			handleError(err);
		} finally {
			busy = false;
		}
	}

	const projectName = (id: string) => byId.get(id)?.name ?? id;
	const teamOf = (id: string) => {
		const p = byId.get(id);
		const t = p && teamById.get(p.teamId);
		return t ? teamLabel(t) : '';
	};
</script>

{#snippet ranking(rows: TallyRow[])}
	<ol class="flex flex-col divide-y divide-bp-line/20 border border-bp-line/40">
		{#each rows as r (r.projectId)}
			<li class={['flex items-baseline gap-3 px-3 py-2', r.rank === 1 && 'bg-base-200']}>
				<span class="w-8 font-mono text-lg tabular-nums">{String(r.rank).padStart(2, '0')}</span>
				<span class="flex min-w-0 flex-1 flex-col">
					<span class="truncate bp-label text-base">{projectName(r.projectId)}</span>
					<span class="truncate font-mono text-xs opacity-60">
						{byId.get(r.projectId)?.authorName} · {teamOf(r.projectId)}
					</span>
				</span>
				{#if r.tieBrokenByDraw}<span class="bp-label text-xs opacity-60">draw</span>{/if}
				<span class="font-mono text-xs opacity-70">{r.firsts}×1st</span>
				<span class="w-16 text-right font-mono tabular-nums">{r.points} pts</span>
			</li>
		{/each}
	</ol>
{/snippet}

<section class="flex flex-col gap-3" aria-label="Voting">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="bp-label text-xl">
			Voting
			<span class="ml-2 border border-bp-line/50 px-2 py-0.5 text-xs">
				{phase === 'none'
					? 'Not started'
					: phase === 'group'
						? 'Team round'
						: phase === 'pitch'
							? 'Pitch round'
							: 'Results'}
			</span>
		</h2>
		<div class="flex gap-2">
			{#if phase === 'none'}
				<button
					class="btn bp-label btn-primary btn-sm"
					disabled={busy || projects.length === 0}
					onclick={() => act('start')}
				>
					Start team voting
				</button>
			{:else if phase === 'group'}
				<button
					class="btn bp-label btn-primary btn-sm"
					disabled={busy}
					onclick={() => act('close-group')}
				>
					Close team round
				</button>
			{:else if phase === 'pitch'}
				<button
					class="btn bp-label btn-primary btn-sm"
					disabled={busy}
					onclick={() => act('close-pitch')}
				>
					Close and reveal winner
				</button>
			{/if}
			{#if phase !== 'none'}
				<button class="btn btn-ghost bp-label btn-sm" disabled={busy} onclick={() => act('reset')}
					>Reset</button
				>
			{/if}
		</div>
	</div>

	{#if phase === 'none'}
		<p class="font-mono text-xs opacity-60">
			{projects.length} of {memberCount} members have named a project.
			{#if projects.length === 0}Voting can start once at least one project exists.{/if}
		</p>
		<div class="grid gap-px border border-bp-line/40 bg-bp-line/40 sm:grid-cols-2">
			{#each sortedTeams as t (t.id)}
				<div class="flex flex-col gap-1 bg-base-100 p-3">
					<span class="bp-label text-base">{teamLabel(t)}</span>
					<ul class="flex flex-col text-sm">
						{#each t.members as m (m.participantId)}
							{@const p = byParticipant.get(m.participantId)}
							<li class="flex justify-between gap-2">
								<span class="truncate">{m.displayName}</span>
								{#if p}
									<span class="truncate bp-label">{p.name}</span>
								{:else}
									<span class="font-mono text-xs opacity-40">no project yet</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{:else if phase === 'group' && voting}
		<p class="font-mono text-xs opacity-60">
			<span class="tabular-nums">{voting.group.teamsDone}/{voting.group.teamsTotal}</span> voting teams
			done. The round closes by itself when every team has voted.
		</p>
		<ul class="flex flex-col divide-y divide-bp-line/20 border border-bp-line/40">
			{#each sortedTeams as t (t.id)}
				{@const g = progress.get(t.id)}
				{@const done = !!g && g.eligible > 0 && g.cast >= g.eligible}
				<li class="flex items-center gap-3 px-3 py-2">
					<span class="flex-1 bp-label text-base">{teamLabel(t)}</span>
					{#if !g || g.eligible === 0}
						<span class="font-mono text-xs opacity-50">
							{projects.some((p) => p.teamId === t.id) ? 'goes straight through' : 'no projects'}
						</span>
					{:else}
						<span class="font-mono text-sm tabular-nums">{g.cast}/{g.eligible}</span>
						<span class={['size-4', done ? '' : 'opacity-0']}><Check size={16} /></span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if phase === 'pitch' && voting}
		<p class="font-mono text-xs opacity-60">
			<span class="tabular-nums">{voting.pitch.cast}/{voting.pitch.eligible}</span> ballots cast.
		</p>
		<ol class="flex flex-col divide-y divide-bp-line/20 border border-bp-line/40">
			{#each voting.pitches as p, i (p.id)}
				<li class="flex items-baseline gap-3 px-3 py-2">
					<span class="w-8 font-mono opacity-60">{String(i + 1).padStart(2, '0')}</span>
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="truncate bp-label text-base">{p.name}</span>
						<span class="truncate font-mono text-xs opacity-60"
							>{p.authorName} · {teamOf(p.id)}</span
						>
					</span>
				</li>
			{/each}
		</ol>
	{:else if phase === 'results' && voting?.results}
		<h3 class="bp-label text-sm opacity-70">Final ranking</h3>
		{@render ranking(voting.results.pitch)}
		<details class="border border-bp-line/30">
			<summary class="cursor-pointer px-3 py-2 bp-label text-sm opacity-70">Team rounds</summary>
			<div class="flex flex-col gap-3 p-3">
				{#each sortedTeams as t (t.id)}
					{@const rows = voting.results.group[t.id]}
					{#if rows?.length}
						<div class="flex flex-col gap-1">
							<span class="bp-label text-xs opacity-60">{teamLabel(t)}</span>
							{@render ranking(rows)}
						</div>
					{/if}
				{/each}
			</div>
		</details>
	{/if}
</section>
