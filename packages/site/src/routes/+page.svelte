<script lang="ts">
	import { Mail } from '@lucide/svelte';
	import NewsletterForm from '$lib/components/NewsletterForm.svelte';
	import PastCard from '$lib/components/PastCard.svelte';
	import SectionHead from '$lib/components/SectionHead.svelte';
	import ShowcaseCard from '$lib/components/ShowcaseCard.svelte';
	import UpcomingCard from '$lib/components/UpcomingCard.svelte';
	import { formatDate } from '$lib/format';

	let { data } = $props();

	/** The featured event, or the next upcoming one. */
	const next = $derived(data.hero);
	const daysToGo = $derived(
		next?.startsAt
			? Math.max(0, Math.ceil((next.startsAt.getTime() - Date.now()) / 86_400_000))
			: null
	);
	const builders = $derived(data.past.reduce((n, p) => n + (p.stats?.participants ?? 0), 0));
</script>

<!-- Hero -->
<section class="border-b-2 border-ink bg-brand">
	<div class="shell grid items-center gap-8 py-9 sm:py-12 lg:grid-cols-[1fr_auto]">
		<div class="flex flex-col items-start gap-4 sm:gap-5">
			<span
				class="inline-block -rotate-3 rounded-full bg-ink px-4 py-1.5 font-display text-sm text-white"
			>
				Build something this afternoon
			</span>
			<h1 class="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
				One afternoon, random teams, <span class="font-normal italic">real</span> projects.
			</h1>
			<p class="max-w-2xl text-lg font-medium">
				We run hackathons and vibeathons: you show up, we put you on a team, the clock starts on the
				big screen, and everyone votes for the best pitch at the end.
			</p>
			<div class="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
				{#if next}
					<a href="/events/{next.slug}/signup" class="btn-ink">Sign up for {next.name}</a>
				{/if}
				<a href="/showcase" class="btn-line">See what people built</a>
			</div>
		</div>
		<div class="hidden flex-col items-center gap-6 lg:flex">
			<div class="grid size-40 place-items-center rounded-full border-2 border-ink bg-white p-8">
				<img src="/favicon.svg" alt="" class="size-full" />
			</div>
			<div class="rotate-2 card px-8 py-5 text-center">
				{#if daysToGo !== null}
					<p class="font-display text-5xl text-brand">{daysToGo}</p>
					<p class="font-medium">{daysToGo === 1 ? 'day' : 'days'} to the next event</p>
				{:else}
					<p class="font-display text-5xl text-brand">{builders || '∞'}</p>
					<p class="font-medium">builders so far</p>
				{/if}
			</div>
		</div>
	</div>
</section>

<!-- Upcoming -->
<section class="shell pt-16">
	<SectionHead label="Up next" title="Upcoming events" href="/events" linkText="All events" />
	{#if data.upcoming.length}
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.upcoming as u (u.event.id)}
				<UpcomingCard event={u.event} spotsLeft={u.spotsLeft} />
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-start gap-3 card p-6 sm:flex-row sm:items-center">
			<p class="flex-1">The next date isn’t set yet. Leave your email and you’ll hear first.</p>
			<a href="#loop" class="btn-ink">Keep me posted</a>
		</div>
	{/if}
</section>

<!-- Past events -->
{#if data.past.length}
	<section class="shell pt-20">
		<SectionHead
			label="Results"
			title="Past events"
			href="/events#past"
			linkText="All past events"
		/>
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.past as p (p.event.id)}
				<PastCard event={p.event} winner={p.winner} stats={p.stats} />
			{/each}
		</div>
	</section>
{/if}

<!-- Showcase -->
{#if data.showcase.length}
	<section class="mt-20 border-y-2 border-ink bg-cream py-16">
		<div class="shell">
			<SectionHead
				label="Showcase"
				title="Built in one afternoon"
				href="/showcase"
				linkText="All projects"
			/>
			<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.showcase as item (item.siteEventId + item.project.id)}
					<ShowcaseCard {item} />
				{/each}
			</div>
		</div>
	</section>
{/if}

<!-- How it works -->
<section class="shell pt-20">
	<div class="grid overflow-hidden card md:grid-cols-2">
		<div class="flex flex-col items-start gap-4 p-8">
			<span class="sticker">How it works</span>
			<h2 class="text-3xl font-medium tracking-tight">
				From strangers to a demo in one afternoon.
			</h2>
			<ol class="flex flex-col gap-3 text-ink/80">
				<li>
					<span class="font-semibold text-ink">1. Join at the door.</span> Scan the QR on the screen;
					bring a friend and you stay on the same team.
				</li>
				<li>
					<span class="font-semibold text-ink">2. Build.</span> Your station is on the floor plan, the
					countdown is on the TV.
				</li>
				<li>
					<span class="font-semibold text-ink">3. Vote.</span> Teams pick their best project, the room
					ranks the pitches.
				</li>
			</ol>
			<a href="/about" class="mt-2 btn-brand">More about the format</a>
		</div>
		<div class="relative hidden min-h-64 border-l-2 border-ink bg-ink md:block" aria-hidden="true">
			<div
				class="absolute inset-0 opacity-25"
				style="background-image: linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px); background-size: 22px 22px"
			></div>
			<div class="absolute inset-8 grid grid-cols-3 gap-4">
				{#each ['#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'] as c, i (c)}
					<div
						class="rounded-lg border-2 border-white/80"
						style:background={i % 2 ? 'transparent' : c}
					></div>
				{/each}
			</div>
		</div>
	</div>
</section>

<!-- Newsletter -->
<section class="shell pt-20" id="loop">
	<div class="flex flex-col gap-4 rounded-2xl bg-cream p-8">
		<h2 class="flex items-center gap-2 text-xl font-semibold">
			<Mail size={20} class="text-brand" /> Stay in the loop
		</h2>
		<p class="text-ink/70">
			One email when the next event is announced{next?.startsAt
				? ` (next up: ${formatDate(next.startsAt)})`
				: ''}. Nothing else.
		</p>
		<NewsletterForm source="home" />
	</div>
</section>
