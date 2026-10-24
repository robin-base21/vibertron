<script lang="ts">
	import type { Blueprint, TeamDTO } from 'common';

	interface Props {
		teams: TeamDTO[];
		blueprint: Blueprint | null;
		flashTeamId?: string | null;
		/** Two columns, for many teams on the TV. */
		dense?: boolean;
		class?: string;
	}

	let { teams, blueprint, flashTeamId = null, dense = false, class: className = '' }: Props = $props();

	const segName = $derived(new Map((blueprint?.segments ?? []).map((s) => [s.id, s.name])));
</script>

<ul class={[dense ? 'grid grid-cols-2 content-start gap-x-[1em] text-[0.8em]' : 'flex flex-col', className]}>
	{#each teams as t (t.id)}
		<li
			class={[
				'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-bp-line/20 py-[0.35em] transition-colors duration-700',
				flashTeamId === t.id && 'bg-bp-accent/40'
			]}
		>
			<span class={['bp-label truncate font-semibold', !t.codename && 'opacity-50']}>{t.codename ?? 'No codename yet'}</span>
			<span class="font-mono text-[0.75em] opacity-70">{t.members.length}×</span>
			<span class="bp-label truncate text-[0.7em] opacity-60">{t.name} · {segName.get(t.segmentId) ?? t.segmentId}</span>
		</li>
	{:else}
		<li class="bp-label py-2 opacity-50">No teams yet</li>
	{/each}
</ul>
