<script lang="ts">
	import type { AttendeeState } from '$lib/stores/attendee.svelte';
	import { errorMessage } from '$lib/stores/toast.svelte';

	let { state: s }: { state: AttendeeState } = $props();

	const project = $derived(s.project);
	const locked = $derived(s.phase !== 'none');

	let editing = $state(false);
	let name = $state('');
	let tagline = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	const showForm = $derived(!locked && (editing || !project));

	function edit() {
		name = project?.name ?? '';
		tagline = project?.tagline ?? '';
		error = null;
		editing = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		error = null;
		try {
			await s.saveProject(name, tagline);
			editing = false;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			saving = false;
		}
	}
</script>

<section class="flex flex-col gap-2" aria-label="Your project">
	<div class="flex items-baseline justify-between">
		<span class="bp-label text-xs opacity-60">Your project</span>
		{#if locked}<span class="bp-label text-xs opacity-50">Locked for voting</span>{/if}
	</div>
	{#if showForm}
		<form class="flex flex-col gap-2 border border-bp-line/60 p-4" onsubmit={save}>
			{#if !project}
				<p class="font-mono text-xs opacity-70">
					Name what you’re building so it can be voted on at the end.
				</p>
			{/if}
			<input
				class="input w-full bp-label input-lg"
				placeholder="Project name"
				maxlength="40"
				required
				aria-label="Project name"
				bind:value={name}
			/>
			<input
				class="input w-full"
				placeholder="One-line pitch (optional)"
				maxlength="120"
				aria-label="Tagline"
				bind:value={tagline}
			/>
			{#if error}<p class="font-mono text-xs text-error" role="alert">{error}</p>{/if}
			<div class="flex justify-end gap-2">
				{#if editing}
					<button type="button" class="btn btn-ghost bp-label" onclick={() => (editing = false)}>
						Cancel
					</button>
				{/if}
				<button class="btn bp-label btn-primary" disabled={saving || !name.trim()}>
					{saving ? 'Saving…' : 'Save project'}
				</button>
			</div>
		</form>
	{:else if project}
		<div class="flex items-start justify-between gap-3 border border-bp-line/60 px-4 py-3">
			<div class="flex min-w-0 flex-col">
				<span class="bp-label text-2xl font-semibold break-words">{project.name}</span>
				{#if project.tagline}<span class="text-sm opacity-70">{project.tagline}</span>{/if}
			</div>
			{#if !locked}
				<button class="btn btn-ghost bp-label btn-sm" onclick={edit}>Edit</button>
			{/if}
		</div>
	{:else}
		<div class="border border-dashed border-bp-line/40 px-4 py-3 font-mono text-xs opacity-60">
			You didn’t name a project, but you can still vote.
		</div>
	{/if}
</section>
