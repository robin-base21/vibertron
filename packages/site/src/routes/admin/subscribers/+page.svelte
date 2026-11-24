<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate, formatTime } from '$lib/format';

	let { data } = $props();
	let filter = $state('');
	const shown = $derived(
		data.subscribers.filter((s) => s.email.toLowerCase().includes(filter.trim().toLowerCase()))
	);
</script>

<svelte:head><title>Subscribers · Admin</title></svelte:head>

<section class="shell flex flex-col gap-6 pt-10">
	<div class="flex flex-col items-start gap-3">
		<span class="sticker">Admin</span>
		<div class="flex w-full flex-wrap items-end justify-between gap-3">
			<h1 class="text-4xl font-semibold tracking-tight">Subscribers</h1>
			<a class="btn-line py-2 text-sm" href="/admin/subscribers.csv">Export CSV</a>
		</div>
		<p class="max-w-2xl text-sm text-ink/65">
			<strong>{data.subscribers.length}</strong> people asked to hear about new events, through the newsletter
			form or a tick during signup. Announcements from an event page go to them; each email has an unsubscribe
			link.
		</p>
	</div>

	{#if data.subscribers.length > 8}
		<label class="flex max-w-sm flex-col gap-1.5 text-sm font-medium">
			Search
			<input class="field" type="search" bind:value={filter} placeholder="name@example.com" />
		</label>
	{/if}

	<div class="overflow-x-auto card">
		<table class="w-full text-left text-sm">
			<thead class="border-b-2 border-ink bg-cream">
				<tr>
					<th class="px-4 py-3">Email</th>
					<th class="px-4 py-3">Subscribed</th>
					<th class="px-4 py-3">From</th>
					<th class="px-4 py-3 text-right"><span class="sr-only">Remove</span></th>
				</tr>
			</thead>
			<tbody>
				{#each shown as s (s.email)}
					<tr class="border-b border-dashed border-ink last:border-0">
						<td class="px-4 py-3"
							><a class="underline decoration-ink/30" href="mailto:{s.email}">{s.email}</a></td
						>
						<td class="px-4 py-3 whitespace-nowrap text-ink/70"
							>{formatDate(s.consentAt)} {formatTime(s.consentAt)}</td
						>
						<td class="px-4 py-3">
							{#if s.eventSlug}<a
									class="underline decoration-brand underline-offset-2"
									href="/events/{s.eventSlug}">{s.from}</a
								>{:else}{s.from}{/if}
						</td>
						<td class="px-4 py-3 text-right">
							<form
								method="POST"
								action="?/remove"
								use:enhance={({ cancel }) => {
									if (!confirm(`Remove ${s.email} from the list?`)) cancel();
								}}
							>
								<input type="hidden" name="email" value={s.email} />
								<button class="text-xs text-ink/55 underline hover:text-brand-deep">Remove</button>
							</form>
						</td>
					</tr>
				{:else}
					<tr
						><td colspan="4" class="px-4 py-8 text-center text-ink/60"
							>{filter ? 'No match.' : 'Nobody yet.'}</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
</section>
