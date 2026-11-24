<script lang="ts">
	import { DECK_MAX_BYTES, deckOpen } from 'common';
	import { FileText, Trash2, Upload } from '@lucide/svelte';
	import SubmissionLinks from '$lib/components/SubmissionLinks.svelte';
	import type { AttendeeState } from '$lib/stores/attendee.svelte';
	import { errorMessage, handleError } from '$lib/stores/toast.svelte';

	let { state: s }: { state: AttendeeState } = $props();

	const project = $derived(s.project);
	/** Name, tagline and link lock when voting starts; the PDF stays open until the pitch round. */
	const locked = $derived(s.phase !== 'none');
	const slidesOpen = $derived(deckOpen(s.phase));

	let editing = $state(false);
	let name = $state('');
	let tagline = $state('');
	let link = $state('');
	/** Public showcase: a required, active choice (no default), as privacy law expects. */
	let showcase = $state<boolean | null>(null);
	let savingShowcase = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);

	let fileInput: HTMLInputElement | undefined = $state();
	let uploading = $state(false);
	let deckError = $state<string | null>(null);

	const showForm = $derived(!locked && (editing || !project));

	function edit() {
		name = project?.name ?? '';
		tagline = project?.tagline ?? '';
		link = project?.link ?? '';
		showcase = project?.showcase ?? null;
		error = null;
		editing = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		error = null;
		try {
			if (showcase === null) {
				error = 'Choose whether your project may appear on the public website';
				return;
			}
			await s.saveProject(name, tagline, link, showcase);
			editing = false;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			saving = false;
		}
	}

	async function chooseShowcase(value: boolean) {
		savingShowcase = true;
		try {
			await s.setShowcase(value);
		} catch (err) {
			handleError(err);
		} finally {
			savingShowcase = false;
		}
	}

	async function upload() {
		const file = fileInput?.files?.[0];
		if (fileInput) fileInput.value = '';
		if (!file) return;
		deckError = null;
		if (file.size > DECK_MAX_BYTES) {
			deckError = 'The PDF must be at most 20 MB';
			return;
		}
		uploading = true;
		try {
			await s.uploadDeck(file);
		} catch (err) {
			deckError = errorMessage(err);
		} finally {
			uploading = false;
		}
	}

	async function remove() {
		if (!confirm('Remove your presentation?')) return;
		uploading = true;
		deckError = null;
		try {
			await s.removeDeck();
		} catch (err) {
			deckError = errorMessage(err);
		} finally {
			uploading = false;
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
			<input
				class="input w-full font-mono text-sm"
				type="url"
				inputmode="url"
				placeholder="https://… link to your project (optional)"
				maxlength="300"
				aria-label="Project link"
				bind:value={link}
			/>
			<fieldset class="flex flex-col gap-1.5 border border-bp-line/30 p-3">
				<legend class="px-1 bp-label text-xs opacity-70">Public website</legend>
				<p class="text-xs opacity-70">
					After the event, results go on our public website. May we show your project (name, pitch,
					link, slides) and your name there?
				</p>
				<label class="flex items-center gap-2 text-sm">
					<input
						type="radio"
						class="radio radio-sm"
						name="showcase"
						checked={showcase === true}
						onchange={() => (showcase = true)}
					/>
					Yes, show my project and name
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input
						type="radio"
						class="radio radio-sm"
						name="showcase"
						checked={showcase === false}
						onchange={() => (showcase = false)}
					/>
					No, keep it private
				</label>
			</fieldset>
			{#if error}<p class="font-mono text-xs text-error" role="alert">{error}</p>{/if}
			<div class="flex justify-end gap-2">
				{#if editing}
					<button type="button" class="btn btn-ghost bp-label" onclick={() => (editing = false)}>
						Cancel
					</button>
				{/if}
				<button
					class="btn bp-label btn-primary"
					disabled={saving || !name.trim() || showcase === null}
				>
					{saving ? 'Saving…' : 'Save project'}
				</button>
			</div>
		</form>
	{:else if project}
		<div class="flex flex-col gap-2 border border-bp-line/60 px-4 py-3">
			<div class="flex items-start justify-between gap-3">
				<div class="flex min-w-0 flex-col">
					<span class="bp-label text-2xl font-semibold break-words">{project.name}</span>
					{#if project.tagline}<span class="text-sm opacity-70">{project.tagline}</span>{/if}
				</div>
				{#if !locked}
					<button class="btn btn-ghost bp-label btn-sm" onclick={edit}>Edit</button>
				{/if}
			</div>
			<SubmissionLinks {project} />
			<div
				class="flex flex-wrap items-center justify-between gap-2 border-t border-bp-line/20 pt-2"
			>
				<span class="font-mono text-xs opacity-70">
					{project.showcase === true
						? 'Shown on the public website after the event'
						: project.showcase === false
							? 'Private: not on the public website'
							: 'Public website: not chosen yet (private until you choose)'}
				</span>
				<span class="flex gap-1">
					{#if project.showcase !== true}
						<button
							class="btn btn-outline bp-label btn-xs"
							disabled={savingShowcase}
							onclick={() => chooseShowcase(true)}
						>
							Show publicly
						</button>
					{/if}
					{#if project.showcase !== false}
						<button
							class="btn btn-ghost bp-label btn-xs"
							disabled={savingShowcase}
							onclick={() => chooseShowcase(false)}
						>
							Keep private
						</button>
					{/if}
				</span>
			</div>
		</div>
	{:else}
		<div class="border border-dashed border-bp-line/40 px-4 py-3 font-mono text-xs opacity-60">
			You didn’t name a project, but you can still vote.
		</div>
	{/if}

	{#if project && slidesOpen}
		<div class="flex flex-col gap-2 border border-dashed border-bp-line/40 px-4 py-3">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-2 text-sm">
					<FileText size={16} class="opacity-60" />
					{project.deckSize ? 'Presentation uploaded' : 'Presentation PDF (optional)'}
				</span>
				<span class="flex gap-1">
					<button
						type="button"
						class="btn btn-outline bp-label btn-xs"
						disabled={uploading}
						onclick={() => fileInput?.click()}
					>
						<Upload size={12} />
						{uploading ? 'Uploading…' : project.deckSize ? 'Replace' : 'Upload'}
					</button>
					{#if project.deckSize}
						<button
							type="button"
							class="btn btn-ghost btn-xs"
							aria-label="Remove presentation"
							disabled={uploading}
							onclick={remove}
						>
							<Trash2 size={12} />
						</button>
					{/if}
				</span>
			</div>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/pdf,.pdf"
				class="hidden"
				onchange={upload}
			/>
			{#if deckError}<p class="font-mono text-xs text-error" role="alert">{deckError}</p>{/if}
			<p class="font-mono text-[0.7rem] opacity-50">
				{s.phase === 'none'
					? 'Link and name lock when voting starts. Slides stay open until pitch voting; others see both once voting starts.'
					: 'You can still update your slides until pitch voting opens.'}
			</p>
		</div>
	{/if}
</section>
