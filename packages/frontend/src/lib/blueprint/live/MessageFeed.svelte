<script lang="ts">
	import { teamColor, type MessageDTO, type TeamDTO } from 'common';
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';

	interface Props {
		/** Newest first. */
		messages: MessageDTO[];
		limit?: number;
		/** For the team colour on each message. */
		teams?: TeamDTO[];
		class?: string;
	}

	let { messages, limit = 12, teams = [], class: className = '' }: Props = $props();

	const colorOf = $derived(new Map(teams.map((t) => [t.id, teamColor(t.position).hex])));

	const shown = $derived(messages.slice(0, limit));
	const time = (ms: number) =>
		new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<ol class={['flex flex-col gap-[0.6em]', className]} aria-live="polite">
	{#each shown as m (m.id)}
		<li
			class="border-l-4 border-bp-line/60 pl-[0.6em]"
			style:border-left-color={colorOf.get(m.teamId)}
			in:fly={{ y: -16, duration: 400 }}
			animate:flip={{ duration: 300 }}
		>
			<div class="flex items-baseline gap-2">
				<span class="truncate bp-label text-[0.8em] font-semibold">{m.codename}</span>
				<span class="ml-auto font-mono text-[0.65em] opacity-50">{time(m.createdAt)}</span>
			</div>
			<p class="text-[0.95em] leading-snug break-words">{m.body}</p>
		</li>
	{:else}
		<li class="bp-label opacity-40">No messages yet</li>
	{/each}
</ol>
