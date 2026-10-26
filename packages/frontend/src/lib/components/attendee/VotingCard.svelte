<script lang="ts">
	import TeamSwatch from '$lib/components/TeamSwatch.svelte';
	import RankList from '$lib/components/RankList.svelte';
	import type { AttendeeState } from '$lib/stores/attendee.svelte';
	import { errorMessage } from '$lib/stores/toast.svelte';
	import { hashSeed, seededRandom, shuffle, type VoteRound } from 'common';

	let { state: s }: { state: AttendeeState } = $props();

	const round = $derived<VoteRound | null>(
		s.phase === 'group' || s.phase === 'pitch' ? s.phase : null
	);
	// A string key so the order below only resets when the candidate set really changes,
	// not on every voting.updated that rebuilds the arrays.
	const candidateKey = $derived(round ? s.candidates(round).join(',') : '');
	const saved = $derived(round ? (s.ctx.ballots?.[round] ?? null) : null);
	const savedKey = $derived(saved?.join(',') ?? '');

	/** Saved ballot if it still matches the candidates, else a stable per-voter shuffle. */
	let order = $derived.by(() => {
		const ids = candidateKey ? candidateKey.split(',') : [];
		const prev = savedKey ? savedKey.split(',') : [];
		if (prev.length === ids.length && prev.every((id) => ids.includes(id))) return prev;
		return shuffle(ids, seededRandom(hashSeed(s.me.id, round)));
	});

	const dirty = $derived(order.join(',') !== savedKey);
	let saving = $state(false);
	let error = $state<string | null>(null);

	async function submit() {
		if (!round) return;
		saving = true;
		error = null;
		try {
			await s.saveBallot(round, order);
		} catch (err) {
			error = errorMessage(err);
			s.reload();
		} finally {
			saving = false;
		}
	}

	const progress = $derived(
		round === 'group'
			? s.teamProgress && {
					cast: s.teamProgress.cast,
					eligible: s.teamProgress.eligible,
					of: 'your team'
				}
			: round === 'pitch' && s.voting
				? { cast: s.voting.pitch.cast, eligible: s.voting.pitch.eligible, of: 'everyone' }
				: null
	);
	const winner = $derived.by(() => {
		const row = s.voting?.results?.pitch[0];
		return row ? { row, project: s.projectById(row.projectId) } : null;
	});
	const ownTeamPasses = $derived(
		s.teamProjects.length === 1 && s.teamProjects[0]!.participantId === s.me.id
	);
</script>

{#if s.phase !== 'none'}
	<section class="flex flex-col gap-3 border border-bp-line/60 p-4" aria-label="Voting">
		<div class="flex items-baseline justify-between gap-2">
			<h2 class="bp-label text-2xl font-semibold">
				{round === 'group' ? 'Team vote' : round === 'pitch' ? 'Pitch vote' : 'Results'}
			</h2>
			{#if progress}
				<span class="font-mono text-xs opacity-60">
					{progress.cast}/{progress.eligible} voted
				</span>
			{/if}
		</div>

		{#if round}
			{#if order.length === 0}
				<p class="bp-label text-lg">
					{round === 'group' && ownTeamPasses
						? 'Your project goes straight through'
						: 'No vote needed'}
				</p>
				<p class="font-mono text-xs opacity-60">
					{round === 'group'
						? 'Your team has fewer than two projects, so there is nothing to rank.'
						: 'There is only one pitch, so there is nothing to rank.'}
				</p>
			{:else}
				<p class="font-mono text-xs opacity-70">
					{round === 'group'
						? 'Rank your team’s projects, best first, yours included. The top one pitches to the room.'
						: 'Rank all the pitches, best first, yours included.'}
				</p>
				<RankList bind:order label={(id) => s.projectById(id)?.name ?? id} disabled={saving}>
					{#snippet row(id)}
						{@const p = s.projectById(id)}
						<span class="truncate bp-label text-lg leading-tight">{p?.name ?? id}</span>
						<span class="flex min-w-0 items-center gap-1.5 font-mono text-xs opacity-60">
							{#if round === 'pitch' && p && s.teamPosition(p.teamId) !== null}
								<TeamSwatch position={s.teamPosition(p.teamId)!} class="size-2.5" />
							{/if}
							<span class="truncate">{p?.authorName}{round === 'pitch' && p ? ` · ${s.teamName(p.teamId)}` : ''}</span>
						</span>
						{#if p?.tagline}<span class="truncate text-xs opacity-60">{p.tagline}</span>{/if}
					{/snippet}
				</RankList>
				{#if error}<p class="font-mono text-xs text-error" role="alert">{error}</p>{/if}
				<div class="flex items-center justify-between gap-3">
					<span class="font-mono text-xs opacity-60">
						{#if saved && !dirty}Saved, you can change it until the round closes.{:else if saved}Unsaved
							changes{/if}
					</span>
					<button
						class="btn bp-label btn-primary"
						disabled={saving || (!!saved && !dirty)}
						onclick={submit}
					>
						{saving ? 'Saving…' : saved ? 'Update ranking' : 'Submit ranking'}
					</button>
				</div>
			{/if}
		{:else if s.phase === 'results'}
			{#if winner}
				<div class="flex flex-col gap-1 border border-bp-accent px-4 py-4">
					<span class="bp-label text-xs text-bp-accent">Winner</span>
					<span class="bp-label text-4xl leading-tight font-semibold break-words">
						{winner.project?.name ?? '—'}
					</span>
					{#if winner.project}
						<span class="flex items-center gap-1.5 font-mono text-xs opacity-70">
							{#if s.teamPosition(winner.project.teamId) !== null}
								<TeamSwatch position={s.teamPosition(winner.project.teamId)!} class="size-2.5" />
							{/if}
							{winner.project.authorName} · {s.teamName(winner.project.teamId)}
						</span>
					{/if}
					{#if winner.row.tieBrokenByDraw}
						<span class="font-mono text-xs opacity-60">Tie decided by draw</span>
					{/if}
				</div>
			{/if}
			{#if s.myResult}
				<p class="font-mono text-sm">
					Your project placed
					<span class="text-2xl">#{s.myResult.row.rank}</span>
					of {s.myResult.of}
					{s.myResult.round === 'pitch' ? 'in the final' : 'in your team round'}
					<span class="opacity-60">({s.myResult.row.points} pts)</span>.
				</p>
			{:else if !winner}
				<p class="font-mono text-xs opacity-60">Results are being tallied…</p>
			{/if}
		{/if}
	</section>
{/if}
