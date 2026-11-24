<script lang="ts">
	import { ExternalLink, FileText, Star, Trophy } from '@lucide/svelte';
	import { hostOf } from '$lib/format';
	import TeamDot from './TeamDot.svelte';

	interface Props {
		item: {
			eventSlug: string;
			eventName: string;
			siteEventId: string;
			project: {
				id: string;
				name: string;
				tagline: string | null;
				author: string;
				link: string | null;
				hasDeck: boolean;
			};
			team: { codename: string | null; name: string; color: string; striped: boolean } | null;
			rank: number | null;
			featured?: boolean;
			/** Preview image of the project link, if it has one. */
			image?: string | null;
		};
		showEvent?: boolean;
	}

	let { item, showEvent = true }: Props = $props();

	/** Same project, same gradient: two hues from its id, warmed by the team colour or the brand. */
	const gradient = $derived.by(() => {
		let h = 0;
		for (const c of item.project.id + item.project.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
		const hue = h % 360;
		const base = item.team?.color && item.team.color !== '#121212' ? item.team.color : '#ff4929';
		return [
			`radial-gradient(circle at ${20 + (h % 50)}% ${15 + ((h >> 8) % 40)}%, hsl(${hue} 95% 70% / 0.95), transparent 55%)`,
			`radial-gradient(circle at ${85 - ((h >> 4) % 30)}% 90%, hsl(${(hue + 140) % 360} 90% 55% / 0.85), transparent 60%)`,
			`linear-gradient(${(h >> 3) % 360}deg, ${base}, hsl(${(hue + 60) % 360} 85% 45%))`
		].join(', ');
	});
	let broken = $state(false);
</script>

<article class="flex flex-col overflow-hidden card">
	<div
		class="relative aspect-[1200/630] overflow-hidden border-b-2 border-ink"
		style:background={gradient}
	>
		{#if item.image && !broken}
			<img
				src={item.image}
				alt=""
				loading="lazy"
				class="size-full object-cover"
				onerror={() => (broken = true)}
			/>
		{:else}
			<span
				class="absolute -bottom-6 left-4 font-display text-[7rem] leading-none text-white/85 mix-blend-overlay select-none"
				aria-hidden="true">{item.project.name.trim().charAt(0).toUpperCase()}</span
			>
		{/if}
	</div>
	<div class="flex flex-1 flex-col gap-3 p-5">
		<div class="flex items-center justify-between gap-2">
			{#if item.team}
				<span
					class="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-wider text-brand-deep uppercase"
				>
					<TeamDot color={item.team.color} striped={item.team.striped} />
					<span class="truncate">{item.team.codename ?? item.team.name}</span>
				</span>
			{/if}
			<span class="flex shrink-0 gap-1.5">
				{#if item.featured}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-white"
						><Star size={12} /> Featured</span
					>
				{/if}
				{#if item.rank === 1}
					<span class="pill gap-1"><Trophy size={12} /> Winner</span>
				{:else if item.rank}
					<span class="tag">#{item.rank} pitch</span>
				{/if}
			</span>
		</div>
		<h3 class="text-lg leading-snug font-semibold">{item.project.name}</h3>
		<div class="border-t border-dashed border-ink"></div>
		{#if item.project.tagline}<p class="text-sm text-ink/75">{item.project.tagline}</p>{/if}
		<p class="text-sm text-ink/60">
			by {item.project.author}{#if showEvent}{' · '}<a
					class="underline decoration-brand underline-offset-2"
					href="/events/{item.eventSlug}">{item.eventName}</a
				>{/if}
		</p>
		{#if item.project.link || item.project.hasDeck}
			<div class="mt-auto flex flex-wrap gap-2 pt-1">
				{#if item.project.link}
					<a
						class="tag gap-1 hover:bg-cream"
						href={item.project.link}
						target="_blank"
						rel="noopener noreferrer nofollow"
					>
						<ExternalLink size={12} />{hostOf(item.project.link)}
					</a>
				{/if}
				{#if item.project.hasDeck}
					<a
						class="tag gap-1 hover:bg-cream"
						href="/decks/{item.siteEventId}/{item.project.id}.pdf"
						target="_blank"
						rel="noopener"
					>
						<FileText size={12} />Slides
					</a>
				{/if}
			</div>
		{/if}
	</div>
</article>
