<script lang="ts">
	import type { EventDTO, ProjectDTO } from 'common';
	import { Upload } from '@lucide/svelte';
	import { events as eventsApi } from '$lib/api';
	import { handleError, toasts } from '$lib/stores/toast.svelte';

	interface Props {
		event: EventDTO;
		projects: ProjectDTO[];
	}

	let { event, projects }: Props = $props();

	let busy = $state(false);
	const shown = $derived(projects.filter((p) => p.showcase === true).length);
	const undecided = $derived(projects.filter((p) => p.showcase === null).length);

	async function publish() {
		busy = true;
		try {
			await eventsApi.publish(event.id);
			toasts.success('Results published to the site');
		} catch (err) {
			handleError(err);
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="flex flex-wrap items-center gap-3 border border-bp-line/40 p-3"
	aria-label="Publish to site"
>
	<div class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span class="bp-label text-sm">Public website</span>
		<span class="font-mono text-xs opacity-70">
			{shown} of {projects.length} projects agreed to be shown{undecided
				? ` · ${undecided} haven’t chosen (stay private)`
				: ''}.
			{#if event.publishedToSiteAt}
				Last published {new Date(event.publishedToSiteAt).toLocaleString([], {
					dateStyle: 'medium',
					timeStyle: 'short'
				})}.
			{:else}
				Not published yet.
			{/if}
		</span>
	</div>
	<button class="btn bp-label btn-primary btn-sm" disabled={busy} onclick={publish}>
		<Upload size={14} />
		{busy ? 'Publishing…' : event.publishedToSiteAt ? 'Publish again' : 'Publish to site'}
	</button>
</section>
