<script lang="ts">
	import { teamColor, type MessageDTO, type TeamDTO } from 'common';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import { clock } from '$lib/stores/clock.svelte';

	interface Props {
		/** Newest first. */
		messages: MessageDTO[];
		teams?: TeamDTO[];
		/** How long a message stays up. */
		ttlMs?: number;
		max?: number;
		class?: string;
	}

	let { messages, teams = [], ttlMs = 20_000, max = 4, class: className = '' }: Props = $props();

	const colorOf = $derived(new Map(teams.map((t) => [t.id, teamColor(t.position).hex])));
	// Recent messages only, oldest on top so new ones push the stack up as they arrive.
	const shown = $derived(
		messages
			.filter((m) => clock.now - m.createdAt < ttlMs)
			.slice(0, max)
			.reverse()
	);
</script>

<ol
	class={['pointer-events-none flex flex-col items-start gap-[0.5em]', className]}
	aria-live="polite"
>
	{#each shown as m (m.id)}
		<li
			class="max-w-full border border-l-[0.35em] border-bp-line/40 bg-bp-bg/90 px-[0.8em] py-[0.5em] shadow-lg"
			style:border-left-color={colorOf.get(m.teamId)}
			in:fly={{ y: 24, duration: 450 }}
			out:fade={{ duration: 800 }}
			animate:flip={{ duration: 400 }}
		>
			<div class="flex items-baseline gap-[0.5em] text-[0.75em]">
				<span class="bp-label font-semibold opacity-80">{m.codename}</span>
				<span class="opacity-60">·</span>
				<span class="text-[1.15em] opacity-80">{m.authorName}</span>
			</div>
			<p class="text-[1.2em] leading-snug break-words">{m.body}</p>
		</li>
	{/each}
</ol>
