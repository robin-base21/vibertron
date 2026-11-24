<script lang="ts">
	import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/svelte';
	import type { Confirmation, Question, SignupForm } from '$lib/signupForm';

	interface Props {
		/** Starting point; edits are posted as JSON in the hidden `form` field. */
		initial: SignupForm;
	}

	let { initial }: Props = $props();

	// svelte-ignore state_referenced_locally
	let about = $state<Question[]>(structuredClone(initial.about));
	// svelte-ignore state_referenced_locally
	let confirmations = $state<Confirmation[]>(structuredClone(initial.confirmations));
	// svelte-ignore state_referenced_locally
	let askNewsletter = $state(initial.askNewsletter);

	const json = $derived(JSON.stringify({ about, confirmations, askNewsletter }));
	const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

	function move<T>(list: T[], i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j]!, list[i]!];
	}

	const input = 'w-full rounded-lg border-2 border-ink px-3 py-2 text-sm';
	const iconBtn = 'rounded-md border border-ink p-1 hover:bg-cream disabled:opacity-30';
</script>

<input type="hidden" name="form" value={json} />

<div class="flex flex-col gap-6">
	<div class="flex flex-col gap-3">
		<h3 class="font-semibold">Step 2 · About you</h3>
		{#each about as q, i (q.id)}
			<div class="flex flex-col gap-2 rounded-xl border-2 border-ink/25 p-3">
				<div class="flex items-center gap-2">
					<input
						class={input}
						bind:value={q.label}
						placeholder="Question"
						aria-label="Question {i + 1}"
					/>
					<select
						class="rounded-lg border-2 border-ink px-2 py-2 text-sm"
						bind:value={q.kind}
						aria-label="Answer type"
					>
						<option value="choice">Pick one</option>
						<option value="text">Short text</option>
					</select>
					<button
						type="button"
						class={iconBtn}
						disabled={i === 0}
						onclick={() => move(about, i, -1)}
						aria-label="Move up"><ArrowUp size={14} /></button
					>
					<button
						type="button"
						class={iconBtn}
						disabled={i === about.length - 1}
						onclick={() => move(about, i, 1)}
						aria-label="Move down"><ArrowDown size={14} /></button
					>
					<button
						type="button"
						class={iconBtn}
						onclick={() => about.splice(i, 1)}
						aria-label="Remove question"><Trash2 size={14} /></button
					>
				</div>
				{#if q.kind === 'choice'}
					<label class="text-xs text-ink/60">
						Options, one per line
						<textarea
							class="{input} min-h-24"
							value={q.options.join('\n')}
							oninput={(e) =>
								(q.options = e.currentTarget.value
									.split('\n')
									.map((o) => o.trim())
									.filter(Boolean))}
						></textarea>
					</label>
				{/if}
				<div class="flex flex-wrap gap-4 text-sm">
					{#if q.kind === 'choice'}
						<label class="flex items-center gap-2"
							><input type="checkbox" class="accent-brand" bind:checked={q.allowOther} /> “Other” with
							text</label
						>
					{/if}
					<label class="flex items-center gap-2"
						><input type="checkbox" class="accent-brand" bind:checked={q.required} /> Required</label
					>
				</div>
			</div>
		{/each}
		<button
			type="button"
			class="btn-line self-start px-4 py-1.5 text-sm"
			onclick={() =>
				about.push({
					id: newId('q'),
					kind: 'choice',
					label: '',
					options: [],
					allowOther: false,
					required: true
				})}
		>
			<Plus size={14} /> Add question
		</button>
	</div>

	<div class="flex flex-col gap-3">
		<h3 class="font-semibold">Step 3 · Before you come</h3>
		<p class="-mt-2 text-xs text-ink/60">Each one is a checkbox people must tick.</p>
		{#each confirmations as c, i (c.id)}
			<div class="grid gap-2 rounded-xl border-2 border-ink/25 p-3 sm:grid-cols-[1fr_auto]">
				<div class="flex flex-col gap-2">
					<input
						class={input}
						bind:value={c.title}
						placeholder="Title, e.g. Laptop"
						aria-label="Confirmation {i + 1} title"
					/>
					<input
						class={input}
						bind:value={c.label}
						placeholder="Checkbox text, e.g. I will bring a laptop"
						aria-label="Confirmation {i + 1} checkbox text"
					/>
					<input
						class={input}
						value={c.help ?? ''}
						oninput={(e) => (c.help = e.currentTarget.value || undefined)}
						placeholder="Extra explanation (optional)"
						aria-label="Confirmation {i + 1} explanation"
					/>
				</div>
				<div class="flex gap-2 sm:flex-col">
					<button
						type="button"
						class={iconBtn}
						disabled={i === 0}
						onclick={() => move(confirmations, i, -1)}
						aria-label="Move up"><ArrowUp size={14} /></button
					>
					<button
						type="button"
						class={iconBtn}
						disabled={i === confirmations.length - 1}
						onclick={() => move(confirmations, i, 1)}
						aria-label="Move down"><ArrowDown size={14} /></button
					>
					<button
						type="button"
						class={iconBtn}
						onclick={() => confirmations.splice(i, 1)}
						aria-label="Remove confirmation"><Trash2 size={14} /></button
					>
				</div>
			</div>
		{/each}
		<button
			type="button"
			class="btn-line self-start px-4 py-1.5 text-sm"
			onclick={() => confirmations.push({ id: newId('c'), title: '', label: '' })}
		>
			<Plus size={14} /> Add confirmation
		</button>
		<label class="flex items-center gap-2 text-sm font-medium">
			<input type="checkbox" class="size-4 accent-brand" bind:checked={askNewsletter} /> Ask “Email me
			when the next signup opens?”
		</label>
	</div>
</div>
