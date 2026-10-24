<script lang="ts">
	import { goto } from '$app/navigation';
	import { events as eventsApi } from '$lib/api';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { handleError } from '$lib/stores/toast.svelte';

	let { data } = $props();

	const SLUG_PATTERN = '[a-z0-9\\-]{3,40}';

	let name = $state('');
	let slug = $state('');
	let busy = $state(false);

	const sorted = $derived([...data.events].sort((a, b) => b.createdAt - a.createdAt));

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const { event } = await eventsApi.create({ name: name.trim(), slug: slug.trim() || undefined });
			await goto(`/manage/${event.id}`);
		} catch (err) {
			handleError(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Events · Vibertron</title></svelte:head>

<main class="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8">
	<h1 class="bp-label text-4xl font-semibold">Events</h1>

	<form class="flex flex-col gap-3 border border-bp-line/40 p-4 sm:flex-row sm:items-end" onsubmit={create}>
		<label class="flex flex-1 flex-col gap-1">
			<span class="bp-label text-xs opacity-70">New event name</span>
			<input class="input w-full" required maxlength="80" placeholder="Vibeathon #3" bind:value={name} />
		</label>
		<label class="flex flex-col gap-1 sm:w-64">
			<span class="bp-label text-xs opacity-70">Slug (optional)</span>
			<input
				class="input w-full font-mono"
				pattern={SLUG_PATTERN}
				title="3–40 lowercase letters, digits or dashes"
				placeholder="vibeathon-3"
				bind:value={slug}
			/>
		</label>
		<button class="btn btn-primary bp-label" disabled={busy || !name.trim()}>Create event</button>
	</form>

	{#if sorted.length === 0}
		<div class="border border-dashed border-bp-line/40 p-10 text-center">
			<p class="bp-label opacity-60">No events yet</p>
		</div>
	{:else}
		<div class="overflow-x-auto border border-bp-line/40">
			<table class="table">
				<thead>
					<tr class="bp-label">
						<th>Name</th>
						<th>Slug</th>
						<th>Status</th>
						<th class="text-right">Participants</th>
						<th class="text-right">Created</th>
					</tr>
				</thead>
				<tbody>
					{#each sorted as ev (ev.id)}
						<tr class="hover:bg-base-200">
							<td><a class="bp-label text-lg hover:underline" href="/manage/{ev.id}">{ev.name}</a></td>
							<td class="font-mono text-xs opacity-70">{ev.slug}</td>
							<td><StatusBadge status={ev.status} /></td>
							<td class="text-right font-mono">{ev.participantCount}</td>
							<td class="text-right font-mono text-xs opacity-70">
								{new Date(ev.createdAt).toLocaleDateString()}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</main>
