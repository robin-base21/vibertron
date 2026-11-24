<script lang="ts">
	import { teamColor, type Blueprint, type ProjectDTO, type TeamDTO } from 'common';
	import { fade } from 'svelte/transition';
	import TeamSwatch from '$lib/components/TeamSwatch.svelte';
	import { projectCounts } from './voting';

	interface Props {
		teams: TeamDTO[];
		blueprint: Blueprint | null;
		flashTeamId?: string | null;
		/** When given, each team shows how many members have named their project. */
		projects?: ProjectDTO[];
		/** Height the strip may take (px); teams that don't fit rotate in pages. */
		maxHeight: number;
		intervalMs?: number;
		class?: string;
	}

	let {
		teams,
		blueprint,
		flashTeamId = null,
		projects,
		maxHeight,
		intervalMs = 8000,
		class: className = ''
	}: Props = $props();

	const segName = $derived(new Map((blueprint?.segments ?? []).map((s) => [s.id, s.name])));
	const named = $derived(projects ? projectCounts(projects) : null);

	const cols = $derived(Math.max(1, Math.min(teams.length, teams.length > 12 ? 5 : 4)));
	let cardH = $state(0);
	let grid = $state<HTMLElement>();
	let page = $state(0);

	// Rows of cards that fit in maxHeight (cards are em-sized, so this follows the TV's font scaling).
	const GAP = 0.6;
	const gapPx = $derived(grid ? parseFloat(getComputedStyle(grid).fontSize) * GAP : 0);
	const rows = $derived(
		cardH ? Math.max(1, Math.floor((maxHeight + gapPx) / (cardH + gapPx))) : 99
	);
	const perPage = $derived(cols * rows);
	const pages = $derived(Math.max(1, Math.ceil(teams.length / perPage)));
	const current = $derived(page % pages);
	const shown = $derived(teams.slice(current * perPage, (current + 1) * perPage));

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

	// Tallest rendered card sets the row height; re-measured on resize (e.g. once web fonts load).
	$effect(() => {
		void shown;
		if (!grid) return;
		const cards = [...grid.querySelectorAll<HTMLElement>('li')];
		const measure = () => {
			const h = Math.max(0, ...cards.map((c) => c.offsetHeight));
			if (h) cardH = h;
		};
		const observer = new ResizeObserver(measure);
		cards.forEach((c) => observer.observe(c));
		return () => observer.disconnect();
	});
</script>

<div class={['relative', className]}>
	{#key current}
		<ul
			bind:this={grid}
			in:fade={{ duration: 400 }}
			class="grid items-start gap-[0.6em]"
			style:grid-template-columns="repeat({cols}, minmax(0, 1fr))"
		>
			{#each shown as t (t.id)}
				{@const c = teamColor(t.position)}
				<li
					class={[
						'flex min-w-0 flex-col gap-[0.2em] border border-l-[0.35em] border-bp-line/30 px-[0.6em] py-[0.4em] transition-colors duration-700',
						flashTeamId === t.id && 'bg-bp-accent/40'
					]}
					style:border-left-color={c.hex}
				>
					<div class="flex min-w-0 items-center gap-[0.4em]">
						<TeamSwatch position={t.position} class="size-[0.8em]" />
						<span
							class={[
								'min-w-0 flex-1 truncate bp-label text-[1.15em] font-semibold',
								!t.codename && 'opacity-50'
							]}>{t.codename ?? 'No codename yet'}</span
						>
					</div>
					<div class="flex items-baseline justify-between gap-[0.5em]">
						<span class="truncate bp-label text-[0.65em] opacity-60"
							>{t.name} · {segName.get(t.segmentId) ?? t.segmentId}</span
						>
						{#if named}
							{@const n = named.get(t.id) ?? 0}
							<span
								class={[
									'font-mono text-[0.6em] whitespace-nowrap',
									n < t.members.length && 'opacity-50'
								]}
								title="{n} of {t.members.length} projects named">{n}/{t.members.length} PRJ</span
							>
						{/if}
					</div>
					<p class="text-[0.85em] leading-snug opacity-90">
						{t.members.map((m) => m.displayName).join(' · ')}
					</p>
				</li>
			{/each}
		</ul>
	{/key}
	{#if pages > 1}
		<span
			class="absolute right-0 -bottom-[1.1em] font-mono text-[0.6em] opacity-60"
			aria-label="Page {current + 1} of {pages}">{current + 1}/{pages}</span
		>
	{/if}
</div>
