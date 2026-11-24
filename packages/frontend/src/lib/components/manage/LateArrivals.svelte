<script lang="ts">
	import {
		suggestTeam,
		type Blueprint,
		type EventDTO,
		type ParticipantDTO,
		type TeamDTO
	} from 'common';
	import { events as eventsApi } from '$lib/api';
	import TeamSwatch from '$lib/components/TeamSwatch.svelte';
	import { handleError, toasts } from '$lib/stores/toast.svelte';

	interface Props {
		event: EventDTO;
		participants: ParticipantDTO[];
		teams: TeamDTO[];
		blueprint: Blueprint | null;
	}

	let { event, participants, teams, blueprint }: Props = $props();

	const NEW_TEAM = 'new';
	const pending = $derived(participants.filter((p) => p.status === 'pending'));
	const open = $derived(event.votingPhase === 'none');
	const sortedTeams = $derived([...teams].sort((a, b) => a.position - b.position));
	const nameOf = (id: string) => participants.find((p) => p.id === id)?.displayName ?? '?';
	const teamLabel = (t: TeamDTO) => (t.codename ? `${t.codename} (${t.name})` : t.name);

	/** Free seats per area, to show which teams can take one more person. */
	const freeIn = $derived.by(() => {
		const used = new Map<string, number>();
		for (const t of teams) used.set(t.segmentId, (used.get(t.segmentId) ?? 0) + t.members.length);
		return (segmentId: string) =>
			(blueprint?.segments.find((s) => s.id === segmentId)?.stations.count ?? 0) -
			(used.get(segmentId) ?? 0);
	});

	/** The manager's pick per person; falls back to the suggestion. */
	let choice = $state<Record<string, string>>({});
	let busy = $state<string | null>(null);

	const suggestion = (p: ParticipantDTO) =>
		(blueprint && suggestTeam(blueprint, teams, p.friendIds)) ?? NEW_TEAM;

	async function approve(p: ParticipantDTO) {
		const pick = choice[p.id] ?? suggestion(p);
		busy = p.id;
		try {
			const { team } = await eventsApi.approve(
				event.id,
				p.id,
				pick === NEW_TEAM ? {} : { teamId: pick }
			);
			toasts.success(`${p.displayName} joined ${teamLabel(team)}`);
		} catch (err) {
			handleError(err);
		} finally {
			busy = null;
		}
	}

	async function reject(p: ParticipantDTO) {
		if (!confirm(`Turn ${p.displayName} away? They won’t be able to join this event.`)) return;
		busy = p.id;
		try {
			await eventsApi.reject(event.id, p.id);
		} catch (err) {
			handleError(err);
		} finally {
			busy = null;
		}
	}
</script>

{#if pending.length}
	<section
		class="flex flex-col gap-3 border border-bp-accent p-4"
		aria-label="Late arrivals"
		data-testid="late-arrivals"
	>
		<div class="flex items-baseline justify-between gap-2">
			<h2 class="bp-label text-xl">
				Late arrivals
				<span class="ml-1 bg-bp-accent px-2 font-mono text-sm text-bp-bg">{pending.length}</span>
			</h2>
			<span class="font-mono text-xs opacity-60">
				{open
					? 'They wait on their phone until you let them in.'
					: 'Voting has started: teams are final.'}
			</span>
		</div>
		<ul class="flex flex-col divide-y divide-bp-line/20">
			{#each pending as p (p.id)}
				{@const pick = choice[p.id] ?? suggestion(p)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="text-base">{p.displayName}</span>
						<span class="font-mono text-xs opacity-60">
							joined {new Date(p.joinedAt).toLocaleTimeString([], {
								hour: '2-digit',
								minute: '2-digit'
							})}
							{#if p.friendIds.length}· came with {p.friendIds.map(nameOf).join(', ')}{/if}
						</span>
					</span>
					{#if open}
						<label class="flex items-center gap-2">
							<span class="sr-only">Team for {p.displayName}</span>
							{#if pick !== NEW_TEAM}
								{@const t = teams.find((x) => x.id === pick)}
								{#if t}<TeamSwatch position={t.position} />{/if}
							{/if}
							<select
								class="select select-sm"
								value={pick}
								onchange={(e) => (choice[p.id] = e.currentTarget.value)}
							>
								{#each sortedTeams as t (t.id)}
									{@const free = freeIn(t.segmentId)}
									<option value={t.id} disabled={free <= 0}>
										{teamLabel(t)} · {t.members.length} people{free <= 0
											? ' · area full'
											: ''}{t.id === suggestion(p) ? ' · suggested' : ''}
									</option>
								{/each}
								<option value={NEW_TEAM}
									>New team{suggestion(p) === NEW_TEAM ? ' · suggested' : ''}</option
								>
							</select>
						</label>
						<button
							class="btn bp-label btn-primary btn-sm"
							disabled={busy === p.id}
							onclick={() => approve(p)}
						>
							Let in
						</button>
					{/if}
					<button
						class="btn btn-ghost bp-label btn-sm"
						disabled={busy === p.id}
						onclick={() => reject(p)}
					>
						Turn away
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
