<script lang="ts">
	import { tick } from 'svelte';
	import { Sparkles, X } from '@lucide/svelte';
	import { AI_SECTIONS, type AiSection } from '$lib/aiFill';
	import FormBuilder from './FormBuilder.svelte';
	import type { SignupForm } from '$lib/signupForm';
	import { toLocalInput, TIME_ZONE } from '$lib/time';

	interface Props {
		event?: {
			name: string;
			slug: string;
			tagline: string | null;
			description: string | null;
			startsAt: Date | null;
			endsAt: Date | null;
			venue: string | null;
			venueUrl: string | null;
			capacity: number | null;
			priceNote: string | null;
			sourceSlug: string | null;
			signupOpen: boolean;
			depositAmount: number | null;
			depositInstructions: string | null;
			depositNote: string | null;
			proofRequired: boolean;
			holdHours: number;
			refundDays?: number | null;
			published: boolean;
		};
		action: string;
		submitLabel: string;
		error?: string;
		/** The signup form to start from (this event's, or a template). */
		signupForm: SignupForm;
		/** AI is configured: show "Fill out with AI". */
		ai?: boolean;
	}

	let { event, action, submitLabel, error, signupForm, ai = false }: Props = $props();

	/** Free event: price shows "Free" and there is no deposit step. Stored as priceNote "Free" + no deposit. */
	// svelte-ignore state_referenced_locally
	let free = $state(
		!!event && event.depositAmount === null && event.priceNote?.trim().toLowerCase() === 'free'
	);

	// ----- Fill out with AI: values land in the form for review; nothing is saved -----
	let formEl = $state<HTMLFormElement>();
	let dialog = $state<HTMLDialogElement>();
	// svelte-ignore state_referenced_locally
	let builderForm = $state.raw(signupForm);
	let builderKey = $state(0);
	let aiPrompt = $state('');
	let aiSections = $state<Record<AiSection, boolean>>({
		basics: true,
		when: true,
		seats: true,
		description: true,
		form: false
	});
	let aiBusy = $state(false);
	let aiError = $state<string | null>(null);
	let aiDone = $state<string | null>(null);

	function currentValues() {
		const data = new FormData(formEl);
		const out: Record<string, unknown> = {};
		for (const name of [
			'name',
			'tagline',
			'startsAt',
			'endsAt',
			'venue',
			'capacity',
			'priceNote',
			'depositAmount',
			'depositNote',
			'description'
		])
			out[name] = String(data.get(name) ?? '');
		out.free = free;
		return out;
	}

	function setField(name: string, value: unknown) {
		const el = formEl?.elements.namedItem(name);
		if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
		el.value = value === null || value === undefined ? '' : String(value);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.classList.add('ring-4', 'ring-brand');
		setTimeout(() => el.classList.remove('ring-4', 'ring-brand'), 2500);
	}

	async function runAi() {
		const sections = AI_SECTIONS.map((s) => s.id).filter((id) => aiSections[id]);
		if (!sections.length) return (aiError = 'Pick at least one section');
		aiBusy = true;
		aiError = null;
		try {
			const builder = formEl?.elements.namedItem('form');
			const res = await fetch('/admin/ai/fill', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt: aiPrompt,
					sections,
					current: currentValues(),
					signupForm: builder instanceof HTMLInputElement ? JSON.parse(builder.value) : undefined
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error ?? body.message ?? 'The AI request failed');
			// The Free switch first: re-rendering after it changes would reset fields filled before it.
			const values = body.values as Record<string, unknown>;
			if ('free' in values) {
				free = values.free === true;
				await tick();
			}
			for (const [name, value] of Object.entries(values))
				if (name !== 'free') setField(name, value);
			if (body.signupForm) {
				builderForm = body.signupForm;
				builderKey++;
			}
			aiDone = `Filled: ${AI_SECTIONS.filter((s) => aiSections[s.id])
				.map((s) => s.label)
				.join(', ')}. Check the highlighted fields, then save.`;
			formEl?.dispatchEvent(new Event('input', { bubbles: true }));
			dialog?.close();
		} catch (err) {
			aiError = err instanceof Error ? err.message : 'The AI request failed';
		} finally {
			aiBusy = false;
		}
	}

	// Label on one line above the input, hint below it: fields side by side always line up.
	const field = 'flex flex-col gap-1.5 text-sm font-medium';
	const hint = 'text-xs font-normal text-ink/55';
	const section =
		'grid items-start gap-x-4 gap-y-5 border-t-2 border-dashed border-ink pt-6 sm:grid-cols-2';
	const heading = 'text-lg font-semibold sm:col-span-2';
</script>

{#snippet switchTrack()}
	<span
		class="relative h-6 w-11 shrink-0 rounded-full border-2 border-ink bg-white transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-ink after:transition-transform after:content-[''] peer-checked:after:translate-x-5"
		aria-hidden="true"
	></span>
{/snippet}

{#snippet toggle(name: string, title: string, sub: string, checked: boolean)}
	<label
		class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border-2 border-ink px-4 py-3 text-sm font-medium"
	>
		<span>{title}<span class="block {hint}">{sub}</span></span>
		<input type="checkbox" {name} class="peer sr-only" defaultChecked={checked} />
		{@render switchTrack()}
	</label>
{/snippet}

<form method="POST" {action} bind:this={formEl} class="flex flex-col gap-8 card p-6 sm:p-8">
	<!-- Basics -->
	<div class="grid items-start gap-x-4 gap-y-5 sm:grid-cols-2">
		<div class="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
			<h2 class="text-lg font-semibold">Basics</h2>
			{#if ai}
				<button
					type="button"
					class="btn-line gap-1.5 px-4 py-1.5 text-sm"
					onclick={() => {
						aiError = null;
						dialog?.showModal();
					}}><Sparkles size={15} /> Fill out with AI</button
				>
			{/if}
		</div>
		{#if aiDone}<p class="rounded-xl bg-blush px-4 py-2 text-sm sm:col-span-2" role="status">
				{aiDone}
			</p>{/if}
		<label class="{field} sm:col-span-2">
			Name
			<input class="field" name="name" required maxlength="100" defaultValue={event?.name ?? ''} />
		</label>
		<label class="{field} sm:col-span-2">
			Tagline
			<input class="field" name="tagline" maxlength="200" defaultValue={event?.tagline ?? ''} />
			<span class={hint}>One line, shown under the title and on event cards.</span>
		</label>
		<label class={field}>
			URL slug
			<input class="field" name="slug" maxlength="60" defaultValue={event?.slug ?? ''} />
			<span class={hint}>/events/… Made from the name if left empty.</span>
		</label>
	</div>

	<!-- When & where -->
	<div class={section}>
		<h2 class={heading}>When & where</h2>
		<label class={field}>
			Starts
			<input
				class="field"
				type="datetime-local"
				name="startsAt"
				defaultValue={toLocalInput(event?.startsAt ?? null)}
			/>
			<span class={hint}>Times are in {TIME_ZONE}.</span>
		</label>
		<label class={field}>
			Ends
			<input
				class="field"
				type="datetime-local"
				name="endsAt"
				defaultValue={toLocalInput(event?.endsAt ?? null)}
			/>
		</label>
		<label class={field}>
			Venue
			<input class="field" name="venue" maxlength="200" defaultValue={event?.venue ?? ''} />
		</label>
		<label class={field}>
			Location link
			<input
				class="field"
				type="url"
				name="venueUrl"
				maxlength="500"
				placeholder="https://"
				defaultValue={event?.venueUrl ?? ''}
			/>
			<span class={hint}>Optional. A Naver, Kakao or Google Maps link; the venue opens it.</span>
		</label>
	</div>

	<!-- Seats & price -->
	<div class={section}>
		<h2 class={heading}>Seats & price</h2>
		<label class={field}>
			Capacity
			<input
				class="field"
				type="number"
				min="1"
				name="capacity"
				defaultValue={event?.capacity ?? ''}
			/>
			<span class={hint}>Empty means unlimited. Extra signups go on a waitlist.</span>
		</label>
		<div class="hidden sm:block"></div>

		<!-- Its own full-width row, so showing/hiding the price can't move other fields. -->
		<label
			class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border-2 border-ink px-4 py-3 text-sm font-medium sm:col-span-2"
		>
			<span>
				Free event
				<span class="block {hint}"
					>Shows “Free”, with no deposit step. Seats are saved right away.</span
				>
			</span>
			<input type="checkbox" name="free" class="peer sr-only" bind:checked={free} />
			{@render switchTrack()}
		</label>

		<!-- Hidden (not removed) while free, so the values are still there when switching back. -->
		<div
			class={['grid items-start gap-x-4 gap-y-5 sm:col-span-2 sm:grid-cols-2', free && 'hidden']}
		>
			<label class="{field} sm:col-span-2">
				Price & how to pay
				<input
					class="field"
					name="priceNote"
					maxlength="120"
					defaultValue={event?.priceNote?.trim().toLowerCase() === 'free'
						? ''
						: (event?.priceNote ?? '')}
				/>
				<span class={hint}>Shown publicly, e.g. “₩10,000 by bank transfer”.</span>
			</label>
			<label class={field}>
				Deposit, in won
				<input
					class="field"
					type="number"
					min="1"
					name="depositAmount"
					defaultValue={event?.depositAmount ?? ''}
				/>
				<span class={hint}>Asked for in the last signup step. Empty: no deposit step.</span>
			</label>
			<label class={field}>
				Seat hold, in hours
				<input
					class="field"
					type="number"
					min="1"
					max="336"
					name="holdHours"
					required
					defaultValue={event?.holdHours ?? 24}
				/>
				<span class={hint}>Unpaid signups free their seat after this.</span>
			</label>
			<label class="{field} sm:col-span-2">
				Where to send it
				<textarea
					class="min-h-20 field"
					name="depositInstructions"
					maxlength="1000"
					defaultValue={event?.depositInstructions ?? ''}
				></textarea>
				<span class={hint}>Shown on the payment step. The account number gets a copy button.</span>
			</label>
			<label class="{field} sm:col-span-2">
				What happens to it
				<input
					class="field"
					name="depositNote"
					maxlength="500"
					defaultValue={event?.depositNote ?? ''}
				/>
				<span class={hint}>E.g. returned at the door, or swap it for a drink and a snack.</span>
			</label>
			<label class={field}>
				Refund if cancelled, days before
				<input
					class="field"
					type="number"
					min="0"
					max="60"
					name="refundDays"
					placeholder="No rule"
					defaultValue={event?.refundDays ?? ''}
				/>
				<span class={hint}
					>E.g. 3: cancelling at least 3 days before the start gets the deposit back. 0: any time
					before the start. Empty: you decide case by case.</span
				>
			</label>
			<div class="sm:col-span-2">
				{@render toggle(
					'proofRequired',
					'Payment screenshot required',
					'Otherwise people can finish and pay at the door.',
					event?.proofRequired ?? true
				)}
			</div>
		</div>
	</div>

	<!-- Description -->
	<div class={section}>
		<h2 class={heading}>Description</h2>
		<label class="{field} sm:col-span-2">
			<span class="sr-only">Description</span>
			<textarea
				class="min-h-40 field font-normal"
				name="description"
				maxlength="10000"
				defaultValue={event?.description ?? ''}
			></textarea>
			<span class={hint}>Blank lines separate paragraphs.</span>
		</label>
	</div>

	<!-- Signup form -->
	<div class="flex flex-col gap-3 border-t-2 border-dashed border-ink pt-6">
		<h2 class="text-lg font-semibold">Signup form</h2>
		<p class="text-sm text-ink/60">Step 1 always asks for email, full name and phone/KakaoTalk.</p>
		{#key builderKey}<FormBuilder initial={builderForm} />{/key}
	</div>

	<!-- Visibility & results -->
	<div class={section}>
		<h2 class={heading}>Visibility & results</h2>
		{@render toggle('published', 'Published', 'Visible on the site.', event?.published ?? false)}
		{@render toggle('signupOpen', 'Signups open', 'People can sign up.', event?.signupOpen ?? true)}
		<label class="{field} sm:col-span-2">
			Event app slug
			<input
				class="field"
				name="sourceSlug"
				maxlength="60"
				defaultValue={event?.sourceSlug ?? ''}
			/>
			<span class={hint}
				>Optional. Results published from the event app with this slug land on this page.</span
			>
		</label>
	</div>

	{#if error}<p class="text-sm font-medium text-brand-deep" role="alert">{error}</p>{/if}
	<div><button class="btn-ink">{submitLabel}</button></div>
</form>

{#if ai}
	<dialog
		bind:this={dialog}
		class="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl border-2 border-ink bg-white p-0 text-ink shadow-[6px_6px_0_0_var(--color-ink)] backdrop:bg-ink/40"
		aria-labelledby="ai-fill-title"
	>
		<div class="flex flex-col gap-4 p-6">
			<div class="flex items-start justify-between gap-3">
				<h2 id="ai-fill-title" class="flex items-center gap-2 text-xl font-semibold">
					<Sparkles size={18} /> Fill out with AI
				</h2>
				<button
					type="button"
					class="rounded-full p-1 hover:bg-cream"
					aria-label="Close"
					onclick={() => dialog?.close()}><X size={18} /></button
				>
			</div>
			<label class="flex flex-col gap-1.5 text-sm font-medium">
				What’s the event?
				<textarea
					class="min-h-32 field font-normal"
					bind:value={aiPrompt}
					maxlength="4000"
					placeholder="e.g. Build Sunday #5 on Dec 14, 1–6 PM at BASE21 Gwangalli, 30 seats, free. Theme: tools for local shops. Make the description fun but short."
				></textarea>
				<span class="text-xs font-normal text-ink/55"
					>Paste notes, a chat message or an old announcement. The AI also sees what’s in the form
					now.</span
				>
			</label>
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-1 text-sm font-medium">The AI may change</legend>
				<div class="flex flex-wrap gap-2">
					{#each AI_SECTIONS as s (s.id)}
						<label
							class="flex cursor-pointer items-center gap-2 rounded-full border-2 border-ink px-3 py-1 text-sm has-[:checked]:bg-ink has-[:checked]:text-white"
						>
							<input type="checkbox" class="sr-only" bind:checked={aiSections[s.id]} />
							{s.label}
						</label>
					{/each}
				</div>
				<span class="text-xs text-ink/55"
					>It never invents links or bank details. Nothing is saved until you press save.</span
				>
			</fieldset>
			{#if aiError}<p class="text-sm font-medium text-brand-deep" role="alert">{aiError}</p>{/if}
			<div class="flex flex-wrap items-center gap-3">
				<button type="button" class="btn-ink" disabled={aiBusy} onclick={runAi}
					>{aiBusy ? 'Writing…' : 'Fill out'}</button
				>
				<button type="button" class="text-sm underline" onclick={() => dialog?.close()}
					>Cancel</button
				>
			</div>
		</div>
	</dialog>
{/if}
