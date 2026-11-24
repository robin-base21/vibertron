<script lang="ts">
	import { Trophy } from '@lucide/svelte';
	import { formatDate } from '$lib/format';
	import TeamDot from './TeamDot.svelte';

	interface Props {
		event: { slug: string; name: string; startsAt: Date | null };
		winner: {
			project: { name: string; author: string } | null;
			team: { codename: string | null; name: string; color: string; striped: boolean } | null;
		} | null;
		stats: { participants: number; teams: number; projects: number } | null;
	}

	let { event, winner, stats }: Props = $props();
</script>

<a href="/events/{event.slug}" class="flex card-hover flex-col gap-3 card p-5">
	<span class="text-xs font-semibold tracking-wider text-brand-deep uppercase"
		>{formatDate(event.startsAt)}</span
	>
	<h3 class="text-xl font-semibold">{event.name}</h3>
	<div class="border-t border-dashed border-ink"></div>
	{#if winner}
		<p class="flex items-start gap-2">
			<Trophy size={18} class="mt-0.5 shrink-0 text-brand" />
			<span>
				<span class="font-semibold">{winner.project?.name ?? 'A private project'}</span>
				{#if winner.team}
					<span class="flex items-center gap-1.5 text-sm text-ink/70">
						<TeamDot color={winner.team.color} striped={winner.team.striped} />
						{winner.team.codename ?? winner.team.name}{winner.project
							? ` · ${winner.project.author}`
							: ''}
					</span>
				{/if}
			</span>
		</p>
	{:else}
		<p class="text-sm text-ink/60">Results coming soon.</p>
	{/if}
	{#if stats}
		<div class="mt-auto flex flex-wrap gap-2 pt-1">
			<span class="pill">{stats.participants} builders</span>
			<span class="pill">{stats.teams} teams</span>
			{#if stats.projects}<span class="pill">{stats.projects} projects shown</span>{/if}
		</div>
	{/if}
</a>
