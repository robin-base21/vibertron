<script lang="ts">
	import type { Blueprint, ProjectDTO, TeamDTO } from 'common';
	import { fade } from 'svelte/transition';
	import TeamList from './TeamList.svelte';

	interface Props {
		teams: TeamDTO[];
		blueprint: Blueprint | null;
		flashTeamId?: string | null;
		dense?: boolean;
		/** Page rotation interval when the teams don't fit. */
		intervalMs?: number;
		projects?: ProjectDTO[];
		class?: string;
	}

	let {
		teams,
		blueprint,
		flashTeamId = null,
		dense = false,
		intervalMs = 8000,
		projects,
		class: className = ''
	}: Props = $props();

	let boxH = $state(0);
	let rowH = $state(0);
	let list = $state<HTMLElement>();
	let page = $state(0);

	const perPage = $derived(
		boxH && rowH
			? Math.max(1, Math.floor(boxH / rowH)) * (dense ? 2 : 1)
			: Math.max(teams.length, 1)
	);
	const pages = $derived(Math.max(1, Math.ceil(teams.length / perPage)));
	const current = $derived(page % pages);
	const shown = $derived(teams.slice(current * perPage, (current + 1) * perPage));

	// Rotate through pages while the teams don't fit on one screen.
	$effect(() => {
		if (pages <= 1) return;
		const timer = setInterval(() => (page = (page + 1) % pages), intervalMs);
		return () => clearInterval(timer);
	});

	// Jump to the page of a team whose codename just changed.
	$effect(() => {
		const i = flashTeamId ? teams.findIndex((t) => t.id === flashTeamId) : -1;
		if (i >= 0) page = Math.floor(i / perPage);
	});

	// Measure a rendered row (rows are em-sized, so this follows the TV's vw font scaling).
	$effect(() => {
		void shown;
		const li = list?.querySelector('li');
		if (li && li.offsetHeight) rowH = li.offsetHeight;
	});
</script>

<div class={['relative min-h-0 overflow-hidden', className]} bind:clientHeight={boxH}>
	{#key current}
		<div bind:this={list} in:fade={{ duration: 400 }}>
			<TeamList teams={shown} {blueprint} {flashTeamId} {dense} {projects} />
		</div>
	{/key}
	{#if pages > 1}
		<span
			class="absolute right-0 bottom-0 bg-bp-bg pl-[0.4em] font-mono text-[0.6em] opacity-60"
			aria-label="Page {current + 1} of {pages}"
		>
			{current + 1}/{pages}
		</span>
	{/if}
</div>
