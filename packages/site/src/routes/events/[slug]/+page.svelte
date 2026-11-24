<script lang="ts">
	import { Calendar, Clock, Trophy, Users, Wallet } from '@lucide/svelte';
	import SectionHead from '$lib/components/SectionHead.svelte';
	import Venue from '$lib/components/Venue.svelte';
	import ShowcaseCard from '$lib/components/ShowcaseCard.svelte';
	import TeamDot from '$lib/components/TeamDot.svelte';
	import { formatDate, formatTime, paragraphs } from '$lib/format';

	let { data } = $props();

	const event = $derived(data.event);
	const results = $derived(data.results);
	const canSignUp = $derived(event.signupOpen && !results);

	const teamById = $derived(new Map((results?.teams ?? []).map((t) => [t.id, t])));
	const projectById = $derived(new Map((results?.projects ?? []).map((p) => [p.id, p])));
	const winner = $derived(results?.ranking.find((r) => r.rank === 1) ?? null);
</script>

<svelte:head>
	<title>{event.name} · OurBusan.vibe</title>
	{#if event.tagline}<meta name="description" content={event.tagline} />{/if}
	<meta property="og:title" content={event.name} />
	{#if event.tagline}<meta property="og:description" content={event.tagline} />{/if}
	{#if data.flyer}<meta property="og:image" content={data.flyer.abs} />
		<meta name="twitter:card" content="summary_large_image" />{/if}
</svelte:head>

<!-- Header band -->
<section class="border-b-2 border-ink bg-brand">
	<div class="shell flex flex-col items-start gap-3 py-7 sm:gap-4 sm:py-10">
		{#if results}
			<span
				class="inline-block -rotate-3 rounded-full bg-ink px-4 py-1.5 font-display text-sm text-white"
			>
				Results are in
			</span>
		{/if}
		<h1 class="text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">{event.name}</h1>
		{#if event.tagline}<p class="max-w-2xl text-lg font-medium">{event.tagline}</p>{/if}
		<div class="flex flex-wrap gap-2">
			<span
				class="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-3 py-1 text-sm"
			>
				<Calendar size={14} />{formatDate(event.startsAt)}
			</span>
			{#if event.startsAt}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-3 py-1 text-sm"
				>
					<Clock size={14} />{formatTime(event.startsAt)}{event.endsAt
						? ` – ${formatTime(event.endsAt)}`
						: ''}
				</span>
			{/if}
			{#if event.venue}
				<Venue
					venue={event.venue}
					url={event.venueUrl}
					class="rounded-full border-2 border-ink bg-white px-3 py-1 text-sm"
				/>
			{/if}
			{#if event.priceNote}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-3 py-1 text-sm"
				>
					<Wallet size={14} />{event.priceNote}
				</span>
			{/if}
		</div>
	</div>
</section>

{#if results}
	<!-- Results -->
	<section class="shell grid items-start gap-8 pt-8 sm:pt-12 lg:grid-cols-[1.2fr_1fr]">
		<div class="flex flex-col gap-4 card p-7">
			<span class="sticker self-start">Winner</span>
			{#if winner}
				{@const p = winner.projectId ? projectById.get(winner.projectId) : null}
				{@const t = teamById.get(winner.teamId)}
				<h2 class="flex items-start gap-3 text-4xl font-semibold tracking-tight">
					<Trophy size={36} class="mt-1 shrink-0 text-brand" />
					{p?.name ?? 'A private project'}
				</h2>
				{#if p?.tagline}<p class="text-lg text-ink/75">{p.tagline}</p>{/if}
				{#if t}
					<p class="flex items-center gap-2 font-medium">
						<TeamDot color={t.color} striped={t.striped} />
						{t.codename ?? t.name}{p ? ` · by ${p.author}` : ''}
					</p>
				{/if}
			{/if}
			<div class="mt-2 flex flex-wrap gap-2">
				<span class="pill">{results.event.participantCount} builders</span>
				<span class="pill">{results.event.teamCount} teams</span>
				<span class="pill">{results.ranking.length} pitches</span>
			</div>
		</div>
		<div class="flex flex-col card p-7">
			<span class="sticker self-start">Final ranking</span>
			<ol class="mt-4 flex flex-col">
				{#each results.ranking as r (r.rank)}
					{@const p = r.projectId ? projectById.get(r.projectId) : null}
					{@const t = teamById.get(r.teamId)}
					<li
						class="flex items-center gap-3 border-b border-dashed border-ink py-2.5 last:border-0"
					>
						<span class="w-8 font-display text-xl text-brand">{r.rank}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-semibold">{p?.name ?? 'Private project'}</span>
							{#if t}
								<span class="flex items-center gap-1.5 text-sm text-ink/65">
									<TeamDot color={t.color} striped={t.striped} />{t.codename ?? t.name}
								</span>
							{/if}
						</span>
						<span class="text-sm font-medium tabular-nums">{r.points} pts</span>
					</li>
				{/each}
			</ol>
		</div>
	</section>
{/if}
{#if data.projects.length}
	<section class="mt-16 border-y-2 border-ink bg-cream py-14">
		<div class="shell">
			<SectionHead label="Showcase" title="What got built" />
			<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.projects as item (item.project.id)}
					<ShowcaseCard {item} showEvent={false} />
				{/each}
			</div>
		</div>
	</section>
{/if}

<section class="shell grid gap-10 pt-8 sm:pt-12 lg:grid-cols-[1fr_24rem]">
	<div class="flex flex-col gap-4 text-lg leading-relaxed text-ink/85">
		{#if data.flyer}
			<img
				src={data.flyer.src}
				alt="Flyer for {event.name}"
				class="mb-2 w-full max-w-md rounded-2xl border-2 border-ink shadow-[4px_4px_0_0_var(--color-ink)]"
			/>
		{/if}
		{#each paragraphs(event.description) as p, i (i)}
			<p>{p}</p>
		{:else}
			{#if !results}<p>Details coming soon.</p>{/if}
		{/each}
	</div>

	{#if !results}
		<!-- Signup -->
		<aside id="signup" class="flex h-fit flex-col gap-4 card p-6 lg:sticky lg:top-24">
			{#if data.mine?.state === 'cancelled'}
				<span class="sticker self-start">Cancelled</span>
				<h2 class="text-2xl font-semibold">You cancelled, {data.mine.name}</h2>
				<p class="text-ink/75">Changed your mind? You can sign up again while there’s room.</p>
				{#if canSignUp}<a class="btn-line" href="/events/{event.slug}/signup">Sign up again</a>{/if}
			{:else if data.mine && !data.mine.emailConfirmed && data.mine.state !== 'expired'}
				<span class="sticker self-start">Check your inbox</span>
				<h2 class="text-2xl font-semibold">Confirm your email</h2>
				<p class="text-ink/75">
					{data.mine.state === 'waitlist'
						? 'You’re on the waitlist. Tap the link we emailed you so we can reach you.'
						: 'Your seat is held for now. Tap the link we emailed you to keep it.'}
				</p>
				<a class="btn-line" href="/events/{event.slug}/signup">View my signup</a>
			{:else if data.mine?.finished}
				<span class="sticker self-start"
					>{data.mine.state === 'waitlist' ? 'Waitlist' : 'You’re in'}</span
				>
				<h2 class="text-2xl font-semibold">
					{data.mine.state === 'waitlist'
						? `You’re on the waitlist, ${data.mine.name}.`
						: `See you there, ${data.mine.name}!`}
				</h2>
				<a class="btn-line" href="/events/{event.slug}/signup">View my signup</a>
			{:else if data.mine}
				<h2 class="text-2xl font-semibold">Finish signing up</h2>
				<p class="text-ink/75">
					{data.mine.state === 'held'
						? 'Your seat is held for now. Finish the last steps to keep it.'
						: data.mine.state === 'confirmed'
							? 'Your seat is saved. A few questions are still open.'
							: 'Pick up where you left off.'}
				</p>
				<a class="btn-ink" href="/events/{event.slug}/signup">Continue</a>
			{:else if canSignUp}
				<div class="flex items-center justify-between gap-2">
					<h2 class="text-2xl font-semibold">Sign up</h2>
					{#if data.spotsLeft !== null}
						<span class="pill gap-1"
							><Users size={12} />{data.spotsLeft
								? `${data.spotsLeft} seats left`
								: 'Waitlist'}</span
						>
					{/if}
				</div>
				<p class="text-ink/75">
					A few quick steps, about two minutes.{event.priceNote ? ` ${event.priceNote}.` : ''}
				</p>
				<a class="btn-ink" href="/events/{event.slug}/signup"
					>{data.spotsLeft === 0 ? 'Join the waitlist' : 'Save my seat'}</a
				>
			{:else}
				<h2 class="text-2xl font-semibold">Signups are closed</h2>
				<p class="text-ink/75">
					Check back soon, or <a class="underline decoration-brand" href="/#loop">get notified</a> about
					the next event.
				</p>
			{/if}
		</aside>
	{/if}
</section>
