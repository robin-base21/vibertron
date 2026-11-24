<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Upload } from '@lucide/svelte';

	let { data, form } = $props();

	const v = $derived({ ...(data.project ?? {}), ...(form?.values ?? {}) } as Record<
		string,
		string
	>);
	const title = $derived(
		data.mode === 'new' ? 'Add a project' : `Edit ${data.project?.name ?? 'project'}`
	);
	let fileName = $state('');
	/** Form actions keep the page's event/project parameters (a bare "?/save" would drop them). */
	const params = $derived(page.url.searchParams.toString());
	const actionUrl = (name: string) => `?${params ? `${params}&` : ''}/${name}`;
	const label = 'flex flex-col gap-1 text-sm font-medium';
	const hint = 'text-xs font-normal text-ink/55';
</script>

<svelte:head><title>{title} · Admin</title></svelte:head>

<section class="shell flex max-w-3xl flex-col gap-6 pt-10">
	<a href="/admin/showcase" class="text-sm underline decoration-brand underline-offset-2"
		>← Showcase</a
	>
	<div class="flex flex-col gap-2">
		<h1 class="text-4xl font-semibold tracking-tight">{title}</h1>
		{#if data.mode === 'published'}
			<p class="text-sm text-ink/65">
				Published from the event app for <strong>{data.eventName}</strong>. Changes here apply to
				this site only and survive a re-publish; fields you leave as published keep following the
				event app.
			</p>
		{:else if data.mode === 'manual'}
			<p class="text-sm text-ink/65">Added by hand to <strong>{data.eventName}</strong>.</p>
		{:else}
			<p class="text-sm text-ink/65">
				Shown in the showcase and on the event's page, after the published projects. It isn't part
				of the ranking.
			</p>
		{/if}
	</div>

	<form
		method="POST"
		action={actionUrl('save')}
		enctype="multipart/form-data"
		class="grid gap-4 card p-6 sm:grid-cols-2"
		use:enhance
	>
		{#if data.mode === 'new'}
			<label class="{label} sm:col-span-2">
				Event
				<select class="field" name="eventId" required value={v.eventId ?? data.eventId}>
					<option value="" disabled>Pick an event</option>
					{#each data.allEvents as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
				</select>
			</label>
		{/if}
		<label class="{label} sm:col-span-2">
			Project name <input class="field" name="name" required maxlength="80" value={v.name ?? ''} />
			{#if data.published && v.name !== data.published.name}<span class={hint}
					>Published: {data.published.name}</span
				>{/if}
		</label>
		<label class="{label} sm:col-span-2">
			Tagline <span class={hint}>optional, one line</span>
			<input class="field" name="tagline" maxlength="200" value={v.tagline ?? ''} />
			{#if data.published && v.tagline !== data.published.tagline}<span class={hint}
					>Published: {data.published.tagline || '(none)'}</span
				>{/if}
		</label>
		<label class={label}>
			Built by <input class="field" name="author" required maxlength="80" value={v.author ?? ''} />
			{#if data.published && v.author !== data.published.author}<span class={hint}
					>Published: {data.published.author}</span
				>{/if}
		</label>
		{#if data.mode !== 'published'}
			<label class={label}>
				Team <span class={hint}>optional</span>
				<input class="field" name="teamName" maxlength="60" value={v.teamName ?? ''} />
			</label>
		{/if}
		<label class="{label} sm:col-span-2">
			Link <span class={hint}>optional, https://…</span>
			<input class="field" type="url" name="link" maxlength="500" value={v.link ?? ''} />
			{#if data.published && v.link !== data.published.link}<span class={hint}
					>Published: {data.published.link || '(none)'}</span
				>{/if}
		</label>
		{#if data.mode !== 'published'}
			<div class="flex flex-col gap-2 sm:col-span-2">
				<span class="text-sm font-medium"
					>Slides <span class={hint}>optional PDF, max 20 MB</span></span
				>
				<label
					class="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-ink px-4 py-3 text-sm hover:bg-cream"
				>
					<Upload size={16} />
					<span class="truncate"
						>{fileName ||
							(data.hasDeck ? 'Uploaded. Choose another to replace it' : 'Choose a PDF')}</span
					>
					<input
						class="sr-only"
						type="file"
						name="deck"
						accept="application/pdf,.pdf"
						onchange={(e) => (fileName = e.currentTarget.files?.[0]?.name ?? '')}
					/>
				</label>
				{#if data.hasDeck}
					<label class="flex items-center gap-2 text-sm"
						><input type="checkbox" name="removeDeck" class="accent-brand" /> Remove the slides</label
					>
				{/if}
			</div>
		{:else if data.hasDeck}
			<p class="text-xs text-ink/55 sm:col-span-2">
				Slides come from the event app and can't be changed here.
			</p>
		{/if}
		{#if form?.error}<p class="text-sm font-medium text-brand-deep sm:col-span-2" role="alert">
				{form.error}
			</p>{/if}
		<div class="sm:col-span-2">
			<button class="btn-ink">{data.mode === 'new' ? 'Add project' : 'Save'}</button>
		</div>
	</form>

	{#if data.mode === 'published' && data.edited}
		<form method="POST" action={actionUrl('reset')} use:enhance>
			<button class="text-sm underline">Reset to the published version</button>
		</form>
	{:else if data.mode === 'manual'}
		<form
			method="POST"
			action={actionUrl('delete')}
			use:enhance={({ cancel }) => {
				if (!confirm('Delete this project from the site?')) cancel();
			}}
		>
			<button class="text-sm text-brand-deep underline">Delete project</button>
		</form>
	{/if}
</section>
