<script lang="ts">
	import { Calendar, Users } from '@lucide/svelte';
	import Venue from './Venue.svelte';
	import { formatDate, formatDay, formatTime } from '$lib/format';

	interface Props {
		event: {
			slug: string;
			name: string;
			tagline: string | null;
			startsAt: Date | null;
			venue: string | null;
			venueUrl?: string | null;
			priceNote: string | null;
			signupOpen: boolean;
		};
		spotsLeft: number | null;
	}

	let { event, spotsLeft }: Props = $props();
	const day = $derived(formatDay(event.startsAt));
</script>

<!-- The title link stretches over the whole card; the location link sits above it (no nested links). -->
<article class="relative flex card-hover flex-col overflow-hidden card">
	<div class="flex items-center gap-4 border-b-2 border-ink bg-brand px-5 py-4">
		{#if day}
			<span
				class="flex flex-col items-center rounded-xl border-2 border-ink bg-white px-3 py-1.5 leading-none"
			>
				<span class="text-[0.65rem] font-semibold tracking-wider text-brand-deep">{day.month}</span>
				<span class="text-2xl font-bold">{day.day}</span>
			</span>
		{/if}
		<a
			href="/events/{event.slug}"
			class="text-xl leading-tight font-semibold text-ink after:absolute after:inset-0 after:content-['']"
			>{event.name}</a
		>
	</div>
	<div class="flex flex-1 flex-col gap-3 p-5">
		{#if event.tagline}<p class="text-ink/80">{event.tagline}</p>{/if}
		<div class="border-t border-dashed border-ink"></div>
		<p class="flex items-center gap-2 text-sm text-ink/70">
			<Calendar size={14} />
			{formatDate(event.startsAt)}{event.startsAt ? ` · ${formatTime(event.startsAt)}` : ''}
		</p>
		{#if event.venue}
			<p class="text-sm text-ink/70">
				<Venue venue={event.venue} url={event.venueUrl} class="relative z-10 gap-2" />
			</p>
		{/if}
		<div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
			{#if event.priceNote}<span class="pill">{event.priceNote}</span>{/if}
			{#if !event.signupOpen}
				<span class="tag">Signups closed</span>
			{:else if spotsLeft === 0}
				<span class="tag">Full · waitlist open</span>
			{:else if spotsLeft !== null}
				<span class="tag"><Users size={12} class="mr-1" />{spotsLeft} spots left</span>
			{:else}
				<span class="tag">Signups open</span>
			{/if}
		</div>
	</div>
</article>
