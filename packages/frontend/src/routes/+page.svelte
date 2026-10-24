<script lang="ts">
	import { session } from '$lib/stores/session.svelte';
</script>

<main class="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-12 sm:py-20">
	<section class="flex flex-col gap-4">
		<p class="bp-label text-sm opacity-60">Hackathon companion</p>
		<h1 class="bp-label text-6xl font-semibold sm:text-8xl">Vibertron</h1>
		<p class="max-w-xl font-mono text-sm leading-relaxed opacity-70">
			Scan the code at the venue, pair up with a friend, and get your team and workstation on a
			live blueprint of the room when the event launches.
		</p>
	</section>

	{#if session.me.participations.length > 0}
		<section class="flex flex-col gap-3">
			<h2 class="bp-label text-sm opacity-60">Your events</h2>
			{#each session.me.participations as p (p.participantId)}
				<a href="/e/{p.slug}" class="btn btn-primary bp-label btn-lg justify-between">
					<span>Go to event</span>
					<span class="font-mono text-sm normal-case">{p.slug}</span>
				</a>
			{/each}
		</section>
	{:else}
		<section class="grid gap-px border border-bp-line/40 bg-bp-line/40 sm:grid-cols-3">
			{#each [['01', 'Join', 'Scan the QR code on the venue screen.'], ['02', 'Pair', 'Enter a friend’s code to land on the same team.'], ['03', 'Build', 'Find your station on the blueprint and ship.']] as [n, title, text] (n)}
				<div class="flex flex-col gap-2 bg-base-100 p-5">
					<span class="font-mono text-xs opacity-50">{n}</span>
					<span class="bp-label text-xl">{title}</span>
					<span class="font-mono text-xs opacity-70">{text}</span>
				</div>
			{/each}
		</section>
		<div class="flex items-center gap-4">
			<a href="/login" class="btn btn-outline bp-label">Organiser sign in</a>
			<span class="font-mono text-xs opacity-50">Attendees join by scanning the venue QR code.</span>
		</div>
	{/if}
</main>
