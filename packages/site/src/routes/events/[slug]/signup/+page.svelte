<script lang="ts">
	import { enhance } from '$app/forms';
	import { Calendar, Check, Copy, MailCheck, Upload } from '@lucide/svelte';
	import { OTHER_PREFIX } from '$lib/signupForm';
	import Venue from '$lib/components/Venue.svelte';
	import { formatDate, formatTime } from '$lib/format';

	let { data, form } = $props();

	const event = $derived(data.event);
	const signup = $derived(data.signup);
	const deposit = $derived(data.deposit);
	const formError = $derived(form?.error ?? null);

	const LABEL = {
		contact: 'Your details',
		about: 'About you',
		before: 'Before you come',
		deposit: 'Reserve'
	} as const;
	const stepIndex = $derived(data.steps.indexOf(data.step as (typeof data.steps)[number]));
	let busy = $state(false);

	/** Submit through enhance, keeping inputs and following redirects. */
	const submit = () => {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};

	// ----- about: chosen options, so "Other" shows its text field -----
	let picked = $derived.by(() => {
		const initial: Record<string, string> = {};
		for (const q of data.form.about) {
			const a = signup?.answers[q.id] ?? '';
			initial[q.id] = a.startsWith(OTHER_PREFIX) ? '__other' : a;
		}
		return initial;
	});
	const pick = (id: string, value: string) => (picked = { ...picked, [id]: value });
	const otherText = (id: string) => {
		const a = signup?.answers[id] ?? '';
		return a.startsWith(OTHER_PREFIX) ? a.slice(OTHER_PREFIX.length) : '';
	};

	// ----- deposit -----
	/** The account number in the instructions, for the copy button. */
	const account = $derived(/\d[\d -]{6,}\d/.exec(deposit.instructions)?.[0] ?? null);
	let copied = $state(false);
	async function copyAccount() {
		if (!account) return;
		await navigator.clipboard.writeText(account.replace(/\s+/g, ''));
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
	let fileName = $state('');
	const won = (n: number) => `₩${n.toLocaleString('en-US')}`;
	const stamp = (d: Date) => `${formatDate(d)} ${formatTime(d)}`;

	/** The cancel confirmation says up front what happens to a paid deposit. */
	function cancelQuestion() {
		const base = 'Cancel your signup? Your seat goes to someone else.';
		if (!signup?.paid || !deposit.amount) return base;
		const ask = data.contact ? `email ${data.contact}` : null;
		if (!data.refundBy)
			return `${base}\n\n${ask ? `About your deposit: ${ask}.` : 'We’ll get in touch about your deposit.'}`;
		return Date.now() <= new Date(data.refundBy).getTime()
			? `${base}\n\nYou get your ${won(deposit.amount)} deposit back${ask ? `: ${ask} to claim it` : ''}.`
			: `${base}\n\nThe refund deadline (${stamp(data.refundBy)}) has passed, so the deposit isn’t refunded.`;
	}

	const optionClass =
		'flex cursor-pointer items-center gap-3 rounded-xl border-2 border-ink px-4 py-3 transition-colors has-[:checked]:bg-brand has-[:checked]:shadow-[3px_3px_0_0_var(--color-ink)] hover:bg-cream has-[:checked]:hover:bg-brand';
</script>

<svelte:head><title>Sign up · {event.name}</title></svelte:head>

<section class="border-b-2 border-ink bg-brand">
	<div class="shell flex flex-col gap-3 py-8">
		<a href="/events/{event.slug}" class="text-sm font-medium underline underline-offset-2"
			>← Back to event description</a
		>
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{event.name}</h1>
		<p class="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
			<span class="flex items-center gap-1.5"
				><Calendar size={14} />{formatDate(event.startsAt)} · {formatTime(event.startsAt)}</span
			>
			{#if event.venue}<Venue venue={event.venue} url={event.venueUrl} />{/if}
		</p>
	</div>
</section>

<section class="shell flex max-w-2xl flex-col gap-6 pt-10">
	{#if signup?.state === 'cancelled'}
		<div class="flex flex-col gap-4 card p-6">
			<span class="sticker self-start">Cancelled</span>
			<h2 class="text-2xl font-semibold">You cancelled your signup, {signup.name}</h2>
			<p class="text-ink/75">
				Your seat went back to the pool. Thanks for letting us know.
				{#if signup.paid}
					{#if signup.refundDue === true}
						You get your deposit back{#if data.contact}: email
							<a class="font-semibold underline" href="mailto:{data.contact}">{data.contact}</a> to claim
							it{:else}; we’ll get in touch{/if}.
					{:else if signup.refundDue === false}
						You cancelled after the refund deadline, so the deposit isn’t refunded.
					{:else if data.contact}
						About your deposit: email
						<a class="font-semibold underline" href="mailto:{data.contact}">{data.contact}</a>.
					{:else}
						We’ll be in touch about your deposit.
					{/if}
				{/if}
			</p>
			{#if data.canRejoin}
				<form method="POST" action="?/rejoin" use:enhance={submit}>
					<button class="btn-ink" disabled={busy}>Sign up again</button>
				</form>
				<p class="text-xs text-ink/55">
					You get a seat if one is free, otherwise a spot on the waitlist.
				</p>
			{/if}
		</div>
	{:else}
		{#if data.step !== 'done'}
			<!-- Progress -->
			<ol class="flex gap-2" aria-label="Signup steps">
				{#each data.steps as s, i (s)}
					<li class="flex flex-1 flex-col gap-1.5">
						<span
							class={[
								'h-2 rounded-full border-2 border-ink',
								i <= stepIndex ? 'bg-ink' : 'bg-white'
							]}
						></span>
						<span
							class={['hidden text-xs sm:block', i === stepIndex ? 'font-semibold' : 'text-ink/55']}
							>{LABEL[s as keyof typeof LABEL]}</span
						>
					</li>
				{/each}
			</ol>
			<p class="-mt-3 text-sm text-ink/60 sm:hidden">
				Step {stepIndex + 1} of {data.steps.length}: {LABEL[data.step as keyof typeof LABEL]}
			</p>
		{/if}

		{#if signup && !signup.emailConfirmed}
			<!-- The seat only becomes theirs through the link in this email. -->
			<div class="flex flex-col gap-3 card bg-blush p-5" role="status">
				<p class="flex items-start gap-3">
					<MailCheck size={22} class="mt-0.5 shrink-0" />
					<span>
						<strong>Check your inbox.</strong> We sent a link to <strong>{signup.email}</strong>.
						{#if signup.waitlist}
							Confirm your email so we can reach you when a seat opens.
						{:else if signup.state === 'unconfirmed' && signup.holdUntil}
							Your seat is held until <strong>{stamp(signup.holdUntil)}</strong>; it’s yours once
							you tap the link.
						{:else}
							Tap it to get your seat.
						{/if}
					</span>
				</p>
				<form
					method="POST"
					action="?/resend"
					use:enhance
					class="flex flex-wrap items-center gap-3 pl-9 text-sm"
				>
					<button class="font-semibold underline underline-offset-2">Send it again</button>
					{#if form?.resent}<span>Sent. It can take a minute, and check your spam folder.</span>
					{:else if form?.throttled}<span>Just sent; wait a minute before trying again.</span>{/if}
				</form>
			</div>
		{:else if data.confirmedNow}
			<p class="flex items-center gap-2 card p-4 font-medium" role="status">
				<Check size={18} class="text-brand-deep" />
				Email confirmed.{signup?.waitlist
					? ' You’re on the waitlist.'
					: data.step === 'done'
						? ''
						: ' Your seat is saved; just a few more questions.'}
			</p>
		{/if}

		{#if signup?.waitlist && signup.emailConfirmed && data.step !== 'done'}
			<p class="card bg-blush p-4 text-sm">
				The event is full, so you’re on the <strong>waitlist</strong>. Finish the next steps and
				we’ll contact you if a seat opens{deposit.amount ? '; you only pay the deposit then' : ''}.
			</p>
		{:else if signup?.state === 'held' && signup.holdUntil && data.step !== 'done'}
			<p class="text-sm text-ink/70">
				Your seat is held until <strong>{stamp(signup.holdUntil)}</strong>.
			</p>
		{:else if signup?.state === 'confirmed' && data.step !== 'done' && !data.confirmedNow}
			<p class="text-sm text-ink/70">Your seat is saved. Just a few more questions.</p>
		{/if}

		{#if data.step === 'contact' && form?.sentTo}
			<div class="flex flex-col gap-3 card p-6" role="status">
				<MailCheck size={28} />
				<h2 class="text-2xl font-semibold">You’ve signed up before</h2>
				<p class="text-ink/75">
					<strong>{form.sentTo}</strong> already has a signup for this event. We’ve emailed you a link
					that opens it on this device.
				</p>
				<a class="self-start text-sm underline" href="/events/{event.slug}/signup"
					>Use another email</a
				>
			</div>
		{:else if data.step === 'contact'}
			<form
				method="POST"
				action="?/contact"
				class="flex flex-col gap-4 card p-6"
				use:enhance={submit}
			>
				<div class="flex items-center justify-between gap-2">
					<h2 class="text-2xl font-semibold">Your details</h2>
					{#if data.spotsLeft !== null}
						<span class="pill"
							>{data.spotsLeft
								? `${data.spotsLeft} of ${event.capacity} seats left`
								: 'Full: waitlist'}</span
						>
					{/if}
				</div>
				<label class="flex flex-col gap-1 text-sm font-medium">
					Email
					<input
						class="field"
						type="email"
						name="email"
						required
						autocomplete="email"
						value={form?.values?.email ?? signup?.email ?? ''}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm font-medium">
					Full name
					<input
						class="field"
						name="name"
						required
						maxlength="80"
						autocomplete="name"
						value={form?.values?.name ?? signup?.name ?? ''}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm font-medium">
					Phone number or KakaoTalk ID
					<span class="text-xs font-normal text-ink/55"
						>Only used for last-minute changes on the day.</span
					>
					<input
						class="field"
						name="phone"
						required
						maxlength="60"
						autocomplete="tel"
						value={form?.values?.phone ?? signup?.phone ?? ''}
					/>
				</label>
				{#if formError}<p class="text-sm font-medium text-brand-deep" role="alert">
						{formError}
					</p>{/if}
				<button class="btn-ink self-start" disabled={busy}
					>{busy
						? 'Saving…'
						: data.spotsLeft === 0 && !signup
							? 'Join the waitlist'
							: 'Continue'}</button
				>
			</form>
		{:else if data.step === 'about'}
			<form method="POST" action="?/about" class="flex flex-col gap-6" use:enhance={submit}>
				{#each data.form.about as q (q.id)}
					<fieldset class="flex flex-col gap-3 card p-6">
						<legend class="sr-only">{q.label}</legend>
						<h2 class="text-lg font-semibold">
							{q.label}{#if !q.required}<span class="text-sm font-normal text-ink/55">
									(optional)</span
								>{/if}
						</h2>
						{#if q.help}<p class="-mt-2 text-sm text-ink/60">{q.help}</p>{/if}
						{#if q.kind === 'text'}
							<input
								class="field"
								name={q.id}
								maxlength="500"
								required={q.required}
								value={signup?.answers[q.id] ?? ''}
								aria-label={q.label}
							/>
						{:else}
							<div class="grid gap-2 sm:grid-cols-2">
								{#each q.options as o (o)}
									<label class={optionClass}>
										<input
											type="radio"
											class="size-4 accent-ink"
											name={q.id}
											value={o}
											required={q.required}
											checked={picked[q.id] === o}
											onchange={() => pick(q.id, o)}
										/>
										<span>{o}</span>
									</label>
								{/each}
								{#if q.allowOther}
									<label class={optionClass}>
										<input
											type="radio"
											class="size-4 accent-ink"
											name={q.id}
											value="__other"
											required={q.required}
											checked={picked[q.id] === '__other'}
											onchange={() => pick(q.id, '__other')}
										/>
										<span>Other</span>
									</label>
								{/if}
							</div>
							{#if q.allowOther && picked[q.id] === '__other'}
								<input
									class="field"
									name="{q.id}__other"
									required
									maxlength="200"
									placeholder="Tell us"
									value={otherText(q.id)}
									aria-label="{q.label}: other"
								/>
							{/if}
						{/if}
					</fieldset>
				{/each}
				{#if formError}<p class="text-sm font-medium text-brand-deep" role="alert">
						{formError}
					</p>{/if}
				<div class="flex gap-3">
					<a class="btn-line" href="?step=contact">Back</a>
					<button class="btn-ink" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
				</div>
			</form>
		{:else if data.step === 'before'}
			<form method="POST" action="?/before" class="flex flex-col gap-4" use:enhance={submit}>
				{#each data.form.confirmations as c (c.id)}
					<div class="flex flex-col gap-2 card p-5">
						<h2 class="text-lg font-semibold">{c.title}</h2>
						{#if c.help}<p class="-mt-1 text-sm text-ink/60">{c.help}</p>{/if}
						<label class="flex cursor-pointer items-center gap-3 text-sm font-medium">
							<input
								type="checkbox"
								class="size-5 accent-brand"
								name="confirm_{c.id}"
								value="yes"
								required
								checked={signup?.answers[c.id] === 'yes'}
							/>
							{c.label}
						</label>
					</div>
				{/each}
				{#if data.form.askNewsletter}
					<fieldset class="flex flex-col gap-3 card p-5">
						<legend class="sr-only">Newsletter</legend>
						<h2 class="text-lg font-semibold">Want an email when the next signup opens?</h2>
						<div class="flex gap-2">
							{#each [['yes', 'Yes, email me'], ['no', 'No thanks']] as [value, text] (value)}
								<label class="{optionClass} flex-1">
									<input
										type="radio"
										class="size-4 accent-ink"
										name="newsletter"
										{value}
										required
										checked={signup?.newsletter === (value === 'yes')}
									/>
									{text}
								</label>
							{/each}
						</div>
					</fieldset>
				{/if}
				{#if formError}<p class="text-sm font-medium text-brand-deep" role="alert">
						{formError}
					</p>{/if}
				<div class="flex gap-3">
					<a class="btn-line" href="?step={data.steps.includes('about') ? 'about' : 'contact'}"
						>Back</a
					>
					<button class="btn-ink" disabled={busy}
						>{busy ? 'Saving…' : data.steps.includes('deposit') ? 'Continue' : 'Finish'}</button
					>
				</div>
			</form>
		{:else if data.step === 'deposit' && deposit.amount}
			<form
				method="POST"
				action="?/deposit"
				enctype="multipart/form-data"
				class="flex flex-col gap-5 card p-6"
				use:enhance={submit}
			>
				<div class="flex flex-col gap-1">
					<span class="sticker self-start">Reserve your seat</span>
					<p class="mt-2 font-display text-5xl text-brand">{won(deposit.amount)}</p>
					{#if deposit.note}<p class="text-ink/75">{deposit.note}</p>{/if}
					{#if data.refundBy}<p class="text-sm text-ink/75">
							Can’t come after all? Cancel by <strong>{stamp(data.refundBy)}</strong> and you get it back.
						</p>{/if}
				</div>
				<div class="rounded-xl border-2 border-dashed border-ink bg-cream p-4">
					<p class="text-sm font-medium">Please send it to</p>
					<p class="mt-1 whitespace-pre-line">{deposit.instructions}</p>
					{#if account}
						<button type="button" class="mt-3 btn-line px-4 py-1.5 text-sm" onclick={copyAccount}>
							{#if copied}<Check size={14} /> Copied{:else}<Copy size={14} /> Copy account number{/if}
						</button>
					{/if}
				</div>
				<label class="flex flex-col gap-2 text-sm font-medium">
					Screenshot of your transfer{deposit.proofRequired ? '' : ' (optional)'}
					<span
						class="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-ink px-4 py-3 hover:bg-cream"
					>
						<Upload size={18} />
						<span class="truncate"
							>{fileName ||
								(signup?.hasProof
									? 'Already uploaded ✓ Choose another to replace it'
									: 'Choose an image (max 10 MB)')}</span
						>
						<input
							class="sr-only"
							type="file"
							name="proof"
							accept="image/*"
							required={!signup?.hasProof}
							onchange={(e) => (fileName = e.currentTarget.files?.[0]?.name ?? '')}
						/>
					</span>
				</label>
				{#if formError}<p class="text-sm font-medium text-brand-deep" role="alert">
						{formError}
					</p>{/if}
				<div class="flex flex-wrap gap-3">
					<a class="btn-line" href="?step=before">Back</a>
					<button class="btn-ink" disabled={busy}
						>{busy
							? 'Uploading…'
							: signup?.hasProof && !fileName
								? 'Continue'
								: signup?.hasProof
									? 'Replace & finish'
									: 'Send & finish'}</button
					>
				</div>
			</form>
			{#if !deposit.proofRequired}
				<form method="POST" action="?/withoutProof" use:enhance={submit}>
					<button class="text-sm underline underline-offset-2"
						>Finish without a screenshot (I’ll pay at the door)</button
					>
				</form>
			{/if}
		{:else if data.step === 'done' && signup}
			<div class="flex flex-col gap-4 card p-6">
				{#if signup.waitlist}
					<span class="sticker self-start">Waitlist</span>
					<h2 class="text-2xl font-semibold">Thanks, {signup.name}. You’re on the waitlist.</h2>
					<p class="text-ink/75">
						All {event.capacity} seats are taken. If one opens up we’ll get in touch at {signup.email}{deposit.amount
							? ' and ask for the deposit then'
							: ''}.
					</p>
				{:else if !signup.emailConfirmed}
					<span class="sticker self-start">One more thing</span>
					<h2 class="text-2xl font-semibold">Confirm your email to keep your seat</h2>
					<p class="text-ink/75">
						All your answers are in. Tap the link we sent to {signup.email}; then the seat is yours
						and we email you the details.
					</p>
				{:else}
					<span class="sticker self-start">{signup.state === 'paid' ? 'Paid' : 'Seat saved'}</span>
					<h2 class="text-2xl font-semibold">See you there, {signup.name}!</h2>
					<p class="text-ink/75">
						{#if signup.state === 'proof'}
							We got your payment screenshot and will confirm it shortly.
						{:else if signup.state === 'paid'}
							Your deposit is confirmed.
						{:else if deposit.amount}
							Bring {won(deposit.amount)} to the door, or send it beforehand.
						{/if}
						{formatDate(event.startsAt)} at {formatTime(event.startsAt)}{#if event.venue},
							<Venue venue={event.venue} url={event.venueUrl} icon={false} />{/if}.
					</p>
					{#if data.form.confirmations.length}
						<ul class="flex flex-col gap-1 text-sm">
							{#each data.form.confirmations as c (c.id)}
								<li class="flex items-center gap-2">
									<Check size={14} class="text-brand-deep" />{c.label}
								</li>
							{/each}
						</ul>
					{/if}
					<a class="btn-ink self-start" href="/events/{event.slug}/calendar.ics"
						><Calendar size={16} /> Add to calendar</a
					>
				{/if}
			</div>
			<div class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink/65">
				{#if data.steps.includes('about')}<a class="underline" href="?step=about"
						>Change my answers</a
					>{/if}
				{#if data.steps.includes('deposit') && !signup.waitlist}<a
						class="underline"
						href="?step=deposit">Replace the payment screenshot</a
					>{/if}
				<form method="POST" action="?/restart" class="inline">
					<button class="underline">Not {signup.name}? Sign up someone else</button>
				</form>
			</div>
		{/if}

		{#if signup}
			<form
				method="POST"
				action="?/cancel"
				class="border-t-2 border-dashed border-ink pt-4 text-sm"
				use:enhance={({ cancel }) => {
					if (!confirm(cancelQuestion())) return cancel();
					return submit();
				}}
			>
				<span class="text-ink/65">Can’t make it?</span>
				<button class="font-semibold text-brand-deep underline underline-offset-2" disabled={busy}
					>Cancel my signup</button
				>
			</form>
		{/if}
	{/if}
</section>
