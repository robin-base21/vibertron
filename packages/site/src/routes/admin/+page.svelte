<script lang="ts">
	import { enhance } from '$app/forms';
	import { Star } from '@lucide/svelte';
	import { formatDate } from '$lib/format';

	let { data } = $props();
</script>

<svelte:head><title>Admin · OurBusan.vibe</title></svelte:head>

<section class="shell flex flex-col gap-8 pt-12">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div class="flex flex-col items-start gap-3">
			<span class="sticker">Admin</span>
			<h1 class="text-4xl font-semibold tracking-tight">Events</h1>
		</div>
		<a class="btn-ink py-2 text-sm" href="/admin/events/new">New event</a>
	</div>

	<div class="overflow-x-auto card">
		<table class="w-full text-left text-sm">
			<thead class="border-b-2 border-ink bg-cream">
				<tr>
					<th class="px-4 py-3">Event</th>
					<th class="px-4 py-3">Date</th>
					<th class="px-4 py-3">Status</th>
					<th class="px-4 py-3 text-right">Seats</th>
					<th class="px-4 py-3 text-right">Waitlist</th>
					<th class="px-4 py-3 text-right">Paid</th>
					<th class="px-4 py-3 text-right" title="The event the home page hero promotes">Home</th>
				</tr>
			</thead>
			<tbody>
				{#each data.events as e (e.id)}
					<tr class="border-b border-dashed border-ink last:border-0 hover:bg-cream">
						<td class="px-4 py-3"
							><a
								class="font-semibold underline decoration-brand underline-offset-2"
								href="/admin/events/{e.id}">{e.name}</a
							></td
						>
						<td class="px-4 py-3 whitespace-nowrap">{formatDate(e.startsAt)}</td>
						<td class="px-4 py-3">
							<span class="flex flex-wrap gap-1">
								<span class={e.published ? 'pill' : 'tag'}
									>{e.published ? 'Published' : 'Draft'}</span
								>
								{#if e.hasResults}<span class="pill">Results</span>{:else if e.signupOpen}<span
										class="tag">Signups open</span
									>{/if}
							</span>
						</td>
						<td class="px-4 py-3 text-right tabular-nums"
							>{e.seated}{e.capacity ? ` / ${e.capacity}` : ''}</td
						>
						<td class="px-4 py-3 text-right tabular-nums">{e.waitlist}</td>
						<td class="px-4 py-3 text-right tabular-nums">{e.paid}</td>
						<td class="px-4 py-3 text-right">
							{#if !e.hasResults && e.published}
								<form method="POST" action="?/feature" use:enhance>
									<input type="hidden" name="id" value={e.id} />
									<button
										class={[
											'inline-flex items-center gap-1 rounded-full border-2 border-ink px-3 py-0.5 text-xs font-semibold whitespace-nowrap',
											e.featured ? 'bg-ink text-white' : 'bg-white'
										]}
										aria-pressed={e.featured}
										aria-label="Feature {e.name} on the home page"
										title={e.featured
											? 'Promoted on the home page'
											: 'Promote on the home page instead of the next event'}
									>
										<Star size={12} />{e.featured ? 'On home' : 'Feature'}
									</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr
						><td colspan="7" class="px-4 py-8 text-center text-ink/60"
							>No events yet. Create one, or publish results from the event app.</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
</section>
