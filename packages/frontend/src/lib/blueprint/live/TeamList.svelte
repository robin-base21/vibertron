<script lang="ts">
	import type { Blueprint, ProjectDTO, TeamDTO } from 'common';
	import { projectCounts } from './voting';

	interface Props {
		teams: TeamDTO[];
		blueprint: Blueprint | null;
		flashTeamId?: string | null;
		/** Two columns, for many teams on the TV. */
		dense?: boolean;
		/** When given, each team shows how many members have named their project. */
		projects?: ProjectDTO[];
		class?: string;
	}

	let {
		teams,
		blueprint,
		flashTeamId = null,
		dense = false,
		projects,
		class: className = ''
	}: Props = $props();

	const segName = $derived(new Map((blueprint?.segments ?? []).map((s) => [s.id, s.name])));
	const named = $derived(projects ? projectCounts(projects) : null);
</script>

<ul
	class={[
		dense ? 'grid grid-cols-2 content-start gap-x-[1em] text-[0.8em]' : 'flex flex-col',
		className
	]}
>
	{#each teams as t (t.id)}
		<li
			class={[
				'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-bp-line/20 px-[0.3em] py-[0.35em] transition-colors duration-700',
				flashTeamId === t.id && 'bg-bp-accent/40'
			]}
		>
			<span class={['truncate bp-label font-semibold', !t.codename && 'opacity-50']}
				>{t.codename ?? 'No codename yet'}</span
			>
			<span class="font-mono text-[0.75em] opacity-70">{t.members.length}×</span>
			<span class="truncate bp-label text-[0.7em] opacity-60"
				>{t.name} · {segName.get(t.segmentId) ?? t.segmentId}</span
			>
			{#if named}
				{@const n = named.get(t.id) ?? 0}
				<span
					class={[
						'font-mono text-[0.6em] whitespace-nowrap',
						n < t.members.length ? 'opacity-50' : 'opacity-80'
					]}
					title="{n} of {t.members.length} projects named"
				>
					{n}/{t.members.length} PRJ
				</span>
			{/if}
		</li>
	{:else}
		<li class="bp-label py-2 opacity-50">No teams yet</li>
	{/each}
</ul>
