<script lang="ts">
	import { enhance } from '$app/forms';
	import { EyeOff, FileText, Link, Star } from '@lucide/svelte';
	import TeamDot from '$lib/components/TeamDot.svelte';
	import { formatDate, formatTime, hostOf } from '$lib/format';

	let { data } = $props();

	const total = $derived(data.events.reduce((n, e) => n + e.projects.length, 0));
	const hidden = $derived(
		data.events.reduce((n, e) => n + e.projects.filter((p) => p.hidden).length, 0)
	);
	const featured = $derived(
		data.events.reduce((n, e) => n + e.projects.filter((p) => p.featured).length, 0)
	);
</script>

<svelte:head><title>Showcase · Admin</title></svelte:head>

<section class="shell flex flex-col gap-8 pt-10">
	<div class="flex flex-col items-start gap-3">
		<span class="sticker">Admin</span>
		<div class="flex w-full flex-wrap items-end justify-between gap-3">
			<h1 class="text-4xl font-semibold tracking-tight">Showcase</h1>
			<a class="btn-ink py-2 text-sm" href="/admin/showcase/edit">Add project</a>
		</div>
		<p class="max-w-2xl text-sm text-ink/65">
			Projects published from the event app (only those whose authors agreed to be shown) and
			projects added here by hand. <strong>Feature</strong> pins a project to the top of the
			showcase and the home page; <strong>Hide</strong> takes it off the site; <strong>Edit</strong> fixes
			its text on the site only. All of it stays in place when an event is published again.
		</p>
		<p class="flex flex-wrap gap-2 text-sm">
			<span class="tag">{total} projects</span>
			<span class="tag">{featured} featured</span>
			<span class="tag">{hidden} hidden</span>
		</p>
	</div>

	{#each data.events as e (e.id)}
		<div class="flex flex-col gap-3">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="text-2xl font-semibold">
					<a class="underline decoration-brand underline-offset-4" href="/admin/events/{e.id}"
						>{e.name}</a
					>
					{#if !e.published}<span class="ml-2 tag align-middle">Draft: not on the site</span>{/if}
				</h2>
				<span class="flex flex-wrap items-baseline gap-3 text-xs text-ink/55">
					{#if e.publishedAt}
						<span
							>Published from the event app {formatDate(e.publishedAt)}
							{formatTime(e.publishedAt)}</span
						>
					{/if}
					<a class="font-medium text-ink underline" href="/admin/showcase/edit?event={e.id}"
						>+ Add project</a
					>
				</span>
			</div>
			<div class="overflow-x-auto card">
				<table class="w-full text-left text-sm">
					<thead class="border-b-2 border-ink bg-cream">
						<tr>
							<th class="px-4 py-3">Project</th>
							<th class="px-4 py-3">Team</th>
							<th class="px-4 py-3">Links</th>
							<th class="px-4 py-3 text-right">On the site</th>
						</tr>
					</thead>
					<tbody>
						{#each e.projects as p (p.id)}
							<tr
								class={[
									'border-b border-dashed border-ink last:border-0',
									p.hidden && 'text-ink/45'
								]}
							>
								<td class="px-4 py-3">
									<span class="font-semibold">{p.name}</span>
									{#if p.manual}<span class="ml-1 tag">Added by hand</span>{:else if p.edited}<span
											class="ml-1 tag">Edited</span
										>{/if}
									{#if p.rank === 1}<span class="ml-1 pill">Winner</span>{:else if p.rank}<span
											class="ml-1 tag">#{p.rank}</span
										>{/if}
									<span class="block text-xs text-ink/60"
										>by {p.author}{p.tagline ? ` · ${p.tagline}` : ''}</span
									>
								</td>
								<td class="px-4 py-3">
									{#if p.team}
										<span class="flex items-center gap-1.5"
											><TeamDot color={p.team.color} striped={p.team.striped} />{p.team.codename ??
												p.team.name}</span
										>
									{/if}
								</td>
								<td class="px-4 py-3">
									<span class="flex flex-wrap gap-1.5">
										{#if p.link}<a
												class="tag gap-1 hover:bg-cream"
												href={p.link}
												target="_blank"
												rel="noopener noreferrer nofollow"><Link size={12} />{hostOf(p.link)}</a
											>{/if}
										{#if p.hasDeck}<a
												class="tag gap-1 hover:bg-cream"
												href="/decks/{e.id}/{p.id}.pdf"
												target="_blank"
												rel="noopener"><FileText size={12} />Slides</a
											>{/if}
									</span>
								</td>
								<td class="px-4 py-3">
									<span class="flex items-center justify-end gap-2">
										<a
											class="text-xs font-semibold underline"
											href="/admin/showcase/edit?event={e.id}&project={p.id}"
											aria-label="Edit {p.name}">Edit</a
										>
										<form method="POST" action="?/feature" use:enhance>
											<input type="hidden" name="eventId" value={e.id} />
											<input type="hidden" name="projectId" value={p.id} />
											<button
												class={[
													'inline-flex items-center gap-1 rounded-full border-2 border-ink px-3 py-0.5 text-xs font-semibold',
													p.featured ? 'bg-ink text-white' : 'bg-white'
												]}
												aria-pressed={p.featured}
												aria-label="Feature {p.name}"
											>
												<Star size={12} />{p.featured ? 'Featured' : 'Feature'}
											</button>
										</form>
										<form method="POST" action="?/hide" use:enhance>
											<input type="hidden" name="eventId" value={e.id} />
											<input type="hidden" name="projectId" value={p.id} />
											<button
												class={[
													'inline-flex items-center gap-1 rounded-full border-2 border-ink px-3 py-0.5 text-xs font-semibold',
													p.hidden ? 'bg-brand text-ink' : 'bg-white'
												]}
												aria-pressed={p.hidden}
												aria-label="Hide {p.name}"
											>
												<EyeOff size={12} />{p.hidden ? 'Hidden' : 'Hide'}
											</button>
										</form>
									</span>
								</td>
							</tr>
						{:else}
							<tr
								><td colspan="4" class="px-4 py-6 text-center text-ink/60">No projects yet.</td></tr
							>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{:else}
		<p class="card p-6">
			Nothing yet. Projects show up here after an event is published from the event app, or add one
			by hand.
		</p>
	{/each}
</section>
