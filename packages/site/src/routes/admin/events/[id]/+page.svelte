<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Check, Copy, Download, Image, Send, Sparkles, Trash2, Upload } from '@lucide/svelte';
	import EventForm from '$lib/components/EventForm.svelte';
	import { formatDate, formatTime } from '$lib/format';
	import { STATE_LABEL, type SignupState } from '$lib/seats';
	import { answerText } from '$lib/signupForm';

	let { data, form } = $props();

	const active = $derived(data.signups.filter((s) => s.state !== 'cancelled'));
	const confirmed = $derived(active.filter((s) => !s.waitlist));
	const waiting = $derived(active.filter((s) => s.waitlist));
	/** Cancelled ones last, so the organiser still sees who dropped out. */
	const cancelled = $derived(data.signups.filter((s) => s.state === 'cancelled'));
	const seated = $derived(
		data.signups.filter((s) =>
			['paid', 'proof', 'confirmed', 'held', 'unconfirmed'].includes(s.state)
		).length
	);
	const paid = $derived(data.signups.filter((s) => s.paid).length);
	const stamp = (d: Date) => `${formatDate(d)} ${formatTime(d)}`;
	const STEP = ['', 'Contact only', 'Contact only', 'Answered questions', 'Waiting for deposit'];

	/** What to show for an unfinished signup: how far it got. */
	const detail = (s: (typeof data.signups)[number]) =>
		s.state === 'unconfirmed'
			? `Waiting for the email link, held until ${stamp(s.holdUntil!)}`
			: s.state === 'held'
				? `${STEP[s.step] ?? ''}, held until ${stamp(s.holdUntil!)}`
				: s.state === 'expired'
					? STEP[s.step]
					: s.state === 'confirmed' && !s.completed
						? `Seat saved, ${(STEP[s.step] ?? '').toLowerCase()}`
						: null;

	const tone: Record<SignupState, string> = {
		cancelled: 'bg-white text-ink/45 line-through',
		paid: 'bg-ink text-white',
		proof: 'bg-brand',
		confirmed: 'bg-blush',
		held: 'bg-white',
		unconfirmed: 'bg-white text-ink/70 border-dashed',
		waitlist: 'bg-cream',
		expired: 'bg-white text-ink/50'
	};

	const MODE: Record<string, string> = {
		fresh: 'fresh design',
		style: 'from a style reference',
		update: 'updated flyer',
		own: 'uploaded'
	};
	let flyerBusy = $state(false);
	/** Start from: 'none', 'upload' or 'flyer:<id>' (the latest flyer by default). */
	// svelte-ignore state_referenced_locally
	let flyerFrom = $state(data.flyerSources[0] ? `flyer:${data.flyerSources[0].id}` : 'none');
	let flyerMode = $state<'update' | 'style'>('update');
	/** "Your own flyer": stored as is, no AI. */
	const own = $derived(flyerFrom === 'own');
	/** The flyer just made or uploaded becomes the starting point for the next one. */
	function startFromNew(result: { type: string; data?: Record<string, unknown> }) {
		const id = result.type === 'success' ? result.data?.flyerMade : null;
		if (typeof id === 'string') {
			flyerFrom = `flyer:${id}`;
			flyerMode = 'update';
		}
	}

	// ----- tabs, with what's left to do in each -----
	type Tab = 'signups' | 'details' | 'flyer' | 'email';
	const TABS: Tab[] = ['signups', 'details', 'flyer', 'email'];
	const tab = $derived.by((): Tab => {
		const t = page.url.searchParams.get('tab');
		if (t && (TABS as string[]).includes(t)) return t as Tab;
		return data.signups.length ? 'signups' : 'details';
	});

	const seatsFree = $derived(
		data.event.capacity === null ? true : data.event.capacity - seated > 0
	);
	/** Signups that need the organiser. */
	const signupTodo = $derived(
		[
			{
				n: cancelled.filter((s) => s.refundDue === true && !s.refundedAt).length,
				text: 'deposit refund(s) to send (cancelled in time)'
			},
			{
				n: active.filter((s) => s.hasProof && !s.paid).length,
				text: 'payment screenshot(s) to check and mark paid'
			},
			{
				n: active.filter((s) => !s.emailConfirmed && s.state !== 'expired').length,
				text: 'email(s) not confirmed yet'
			},
			{
				n: seatsFree ? waiting.length : 0,
				text: 'on the waitlist while seats are free: give them a seat'
			}
		].filter((t) => t.n > 0)
	);
	const signupTodoCount = $derived(signupTodo.reduce((n, t) => n + t.n, 0));
	const detailsMissing = $derived(
		[
			!data.event.startsAt && 'a date',
			!data.event.venue && 'a venue',
			!data.event.description && 'a description',
			!data.event.published && 'publishing (it’s a draft)'
		].filter((x): x is string => !!x)
	);
	/** The event form has edits that aren't saved yet. */
	let dirty = $state(false);
	const flyerTodo = $derived(!data.event.flyerId);
	const emailTodo = $derived(
		data.event.published && !data.event.announcedAt && data.mail.audience > 0
	);
	const TAB_LABEL: Record<Tab, string> = {
		signups: 'Signups',
		details: 'Details',
		flyer: 'Flyer',
		email: 'Email'
	};
	const tabHint = $derived<Record<Tab, string | null>>({
		signups: signupTodoCount ? `${signupTodoCount} to handle` : null,
		details: dirty
			? 'Unsaved changes'
			: detailsMissing.length
				? `Missing ${detailsMissing.join(', ')}`
				: null,
		flyer: flyerTodo ? 'No flyer on the event page yet' : null,
		email: emailTodo ? 'Subscribers haven’t been told yet' : null
	});

	let copiedId = $state<string | null>(null);
	async function copyLink(id: string, url: string) {
		await navigator.clipboard.writeText(url);
		copiedId = id;
		setTimeout(() => (copiedId = null), 2000);
	}
</script>

<svelte:head><title>{data.event.name} · Admin</title></svelte:head>

<section class="shell flex flex-col gap-8 pt-12">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div class="flex flex-col items-start gap-2">
			<a href="/admin" class="text-sm underline decoration-brand underline-offset-2">← All events</a
			>
			<h1 class="text-4xl font-semibold tracking-tight">{data.event.name}</h1>
			<p class="text-sm text-ink/65">
				{#if data.event.published}<a
						class="underline decoration-brand"
						href="/events/{data.event.slug}">/events/{data.event.slug}</a
					>{:else}Draft: not visible on the site{/if}
				{#if data.resultsAt}
					· Results from the event app, {stamp(data.resultsAt)}{/if}
			</p>
		</div>
		{#if page.url.searchParams.has('saved')}<span class="pill">Saved</span>{/if}
	</div>

	<nav class="-mt-2 flex gap-1 overflow-x-auto border-b-2 border-ink" aria-label="Event sections">
		{#each TABS as t (t)}
			<a
				href="?tab={t}"
				data-sveltekit-replacestate
				data-sveltekit-noscroll
				aria-current={tab === t ? 'page' : undefined}
				title={tabHint[t] ?? undefined}
				class={[
					'-mb-0.5 flex shrink-0 items-center gap-2 rounded-t-xl border-2 px-4 py-2 text-sm font-semibold',
					tab === t
						? 'border-ink border-b-white bg-white'
						: 'border-transparent text-ink/60 hover:text-ink'
				]}
			>
				{TAB_LABEL[t]}
				{#if t === 'signups' && signupTodoCount}
					<span
						class="min-w-5 rounded-full bg-brand px-1.5 text-center text-xs text-ink tabular-nums"
						>{signupTodoCount}<span class="sr-only"> to handle</span></span
					>
				{:else if t === 'details' && dirty}
					<span class="rounded-full bg-ink px-2 text-xs font-medium text-white">unsaved</span>
				{:else if tabHint[t]}
					<span class="size-2.5 rounded-full bg-brand" aria-hidden="true"></span><span
						class="sr-only">({tabHint[t]})</span
					>
				{/if}
			</a>
		{/each}
	</nav>

	<!-- Signups -->
	<div class={['flex flex-col gap-3', tab !== 'signups' && 'hidden']}>
		{#if signupTodo.length}
			<ul class="flex flex-col gap-1 rounded-xl bg-blush px-4 py-3 text-sm" aria-label="To do">
				{#each signupTodo as t (t.text)}
					<li><strong class="tabular-nums">{t.n}</strong> {t.text}</li>
				{/each}
			</ul>
		{/if}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-2xl font-semibold">
				Signups
				<span class="text-base font-normal text-ink/60"
					>{seated}{data.event.capacity ? ` / ${data.event.capacity}` : ''} seats taken{waiting.length
						? ` · ${waiting.length} waitlist`
						: ''} · {paid} paid</span
				>
			</h2>
			<a class="btn-line py-2 text-sm" href="/admin/events/{data.event.id}/signups.csv"
				>Export CSV</a
			>
		</div>
		<div class="overflow-x-auto card">
			<table class="w-full text-left text-sm">
				<thead class="border-b-2 border-ink bg-cream">
					<tr>
						<th class="px-4 py-3">Person</th>
						<th class="px-4 py-3">Status</th>
						<th class="px-4 py-3">Deposit</th>
						<th class="px-4 py-3">Paid</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each [...confirmed, ...waiting, ...cancelled] as s (s.id)}
						<tr class="border-b border-dashed border-ink align-top last:border-0">
							<td class="px-4 py-3">
								<details>
									<summary class="cursor-pointer font-semibold">{s.name}</summary>
									<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
										{#each data.signupForm.about as q (q.id)}
											<dt class="text-ink/55">{q.label}</dt>
											<dd>{answerText(s.answers[q.id]) || '—'}</dd>
										{/each}
										{#each data.signupForm.confirmations as c (c.id)}
											<dt class="text-ink/55">{c.title}</dt>
											<dd>{s.answers[c.id] === 'yes' ? '✓' : '—'}</dd>
										{/each}
										<dt class="text-ink/55">Next signup email</dt>
										<dd>{s.newsletter === null ? '—' : s.newsletter ? 'Yes' : 'No'}</dd>
										<dt class="text-ink/55">Signed up</dt>
										<dd>{stamp(s.createdAt)}</dd>
									</dl>
								</details>
								<a class="block text-xs underline decoration-ink/30" href="mailto:{s.email}"
									>{s.email}</a
								>
								{#if s.phone}<span class="block text-xs text-ink/60">{s.phone}</span>{/if}
							</td>
							<td class="px-4 py-3">
								<span
									class={[
										'inline-block rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-semibold',
										tone[s.state]
									]}
								>
									{STATE_LABEL[s.state]}
								</span>
								{#if detail(s)}<span class="mt-1 block text-xs text-ink/60">{detail(s)}</span>{/if}
								{#if s.state === 'cancelled'}
									{#if s.paid || s.hasProof}
										<span class="mt-1 block text-xs text-ink/60"
											>{s.refundDue === true
												? 'Refund due (cancelled in time)'
												: s.refundDue === false
													? 'No refund (cancelled after the deadline)'
													: 'Had paid: decide about the refund'}</span
										>
										{#if s.refundDue !== false}
											<form method="POST" action="?/refunded" use:enhance class="mt-1">
												<input type="hidden" name="id" value={s.id} />
												<button
													class={[
														'inline-flex items-center gap-1 rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-semibold no-underline',
														s.refundedAt ? 'bg-ink text-white' : 'bg-white text-ink'
													]}
													aria-pressed={!!s.refundedAt}
													title={s.refundedAt
														? `Refunded ${stamp(s.refundedAt)}`
														: 'Mark the deposit as sent back'}
													>{#if s.refundedAt}<Check size={12} /> Refunded{:else}Not refunded yet{/if}</button
												>
											</form>
										{/if}
									{:else}
										<span class="mt-1 block text-xs text-ink/60">Seat is free again</span>
									{/if}
								{:else if !s.emailConfirmed}
									<form method="POST" action="?/confirm" use:enhance class="mt-1">
										<input type="hidden" name="id" value={s.id} />
										{#if s.state !== 'unconfirmed'}<span class="text-xs text-ink/60"
												>Email not confirmed ·
											</span>{/if}
										<button
											class="text-xs underline"
											title="You know the address works (e.g. checked over KakaoTalk)"
											>Confirm email</button
										>
									</form>
								{/if}
								{#if s.state !== 'cancelled'}
									<form method="POST" action="?/waitlist" use:enhance class="mt-1">
										<input type="hidden" name="id" value={s.id} />
										<button class="text-xs underline"
											>{s.waitlist ? 'Give a seat' : 'Move to waitlist'}</button
										>
									</form>
								{/if}
							</td>
							<td class="px-4 py-3">
								{#if s.hasProof}
									<a
										class="tag gap-1 hover:bg-cream"
										href="/admin/proofs/{s.id}"
										target="_blank"
										rel="noopener"
									>
										<Image size={12} /> Screenshot
									</a>
									<span class="mt-1 block text-xs text-ink/55">{stamp(s.proofAt!)}</span>
								{:else}
									<span class="text-xs text-ink/50"
										>{data.event.depositAmount ? 'None yet' : '—'}</span
									>
								{/if}
							</td>
							<td class="px-4 py-3">
								<form method="POST" action="?/paid" use:enhance>
									<input type="hidden" name="id" value={s.id} />
									<button
										class={[
											'inline-flex items-center gap-1 rounded-full border-2 border-ink px-3 py-0.5 text-xs font-semibold',
											s.paid ? 'bg-ink text-white' : 'bg-white'
										]}
										aria-pressed={s.paid}
										aria-label="Paid: {s.name}"
										title={s.paidAt ? `Marked paid ${stamp(s.paidAt)}` : 'Mark as paid'}
									>
										{#if s.paid}<Check size={12} /> Paid{:else}Unpaid{/if}
									</button>
								</form>
							</td>
							<td class="px-4 py-3 text-right whitespace-nowrap">
								<button
									class="mr-3 inline-flex items-center gap-1 text-xs underline"
									title="A link that lets them continue their signup"
									onclick={() => copyLink(s.id, s.resumeUrl)}
								>
									{#if copiedId === s.id}<Check size={12} /> Copied{:else}<Copy size={12} /> Resume link{/if}
								</button>
								<form
									method="POST"
									action="?/remove"
									class="inline"
									use:enhance={({ cancel }) => {
										if (!confirm(`Remove ${s.name}'s signup?`)) cancel();
									}}
								>
									<input type="hidden" name="id" value={s.id} />
									<button class="text-xs text-ink/55 underline hover:text-brand-deep">Remove</button
									>
								</form>
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="px-4 py-8 text-center text-ink/60">No signups yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="text-xs text-ink/55">
			A seat only becomes someone’s once they tap the link in their confirmation email; until then
			it’s held for 2 hours. “Seat held” signups still owe the deposit; their seat frees up when the
			hold runs out. “Give a seat” moves someone off the waitlist and emails them (with the link to
			pay the deposit, if there is one). Marking someone paid emails them a receipt.
		</p>
	</div>

	<!-- Announce -->
	<div class={['flex flex-col gap-3', tab !== 'email' && 'hidden']}>
		<h2 class="text-2xl font-semibold">Email subscribers</h2>
		<div class="flex flex-wrap items-center justify-between gap-4 card p-5">
			<p class="max-w-xl text-sm text-ink/75">
				Send this event to the <strong>{data.mail.audience}</strong>
				{data.mail.audience === 1 ? 'person' : 'people'} on the “stay in the loop” list who haven’t signed
				up for it yet. Each email has an unsubscribe link.
				{#if data.event.announcedAt}<br /><span class="text-ink/60"
						>Last sent {stamp(data.event.announcedAt)}.</span
					>{/if}
				{#if !data.mail.configured}<br /><span class="text-brand-deep"
						>No RESEND_API_KEY set: emails are only logged, see Emails.</span
					>{/if}
			</p>
			<form
				method="POST"
				action="?/announce"
				use:enhance={({ cancel }) => {
					if (
						!confirm(
							`${data.event.announcedAt ? 'Send it again? ' : ''}Email ${data.event.name} to ${data.mail.audience} subscribers?`
						)
					)
						cancel();
				}}
			>
				<button
					class="btn-ink py-2 text-sm"
					disabled={!data.event.published || data.mail.audience === 0}
					title={data.event.published ? undefined : 'Publish the event first'}
					><Send size={14} /> {data.event.announcedAt ? 'Send again' : 'Send announcement'}</button
				>
			</form>
		</div>
		{#if form?.announced}<p class="text-sm font-medium" role="status">
				Sent to {form.announced.sent}{form.announced.failed
					? `; ${form.announced.failed} failed, see Emails`
					: ''}.
			</p>{/if}
	</div>

	<!-- Flyer -->
	<div class={['flex flex-col gap-3', tab !== 'flyer' && 'hidden']}>
		<h2 class="text-2xl font-semibold">Flyer</h2>
		{#if data.ai}
			<form
				method="POST"
				action={own ? '?/uploadFlyer' : '?/flyer'}
				enctype="multipart/form-data"
				class="flex flex-col gap-5 card p-5"
				use:enhance={() => {
					flyerBusy = true;
					return async ({ update, result }) => {
						await update({ reset: false });
						flyerBusy = false;
						startFromNew(result);
					};
				}}
			>
				<p class="text-sm text-ink/70">
					AI makes a flyer with this event’s name, date, time, place and price (save changes first),
					or upload one you made yourself. Every version is kept below; pick the one the event page
					shows.
				</p>

				<fieldset class="flex flex-col gap-2">
					<legend class="mb-2 text-sm font-medium">Start from</legend>
					<div class="flex gap-3 overflow-x-auto pb-2">
						{#snippet choice(value: string, label: string, sub: string)}
							<label
								class="flex w-32 shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border-2 border-ink bg-white text-xs has-[:checked]:ring-4 has-[:checked]:ring-brand"
							>
								<input type="radio" name="from" {value} bind:group={flyerFrom} class="sr-only" />
								{#if value.startsWith('flyer:')}
									<img
										src="/flyers/{value.slice(6)}"
										alt=""
										loading="lazy"
										class="h-36 w-full bg-cream object-cover object-top"
									/>
								{:else}
									<span class="flex h-36 items-center justify-center bg-cream">
										{#if value === 'own'}<Upload size={28} />{:else if value === 'upload'}<Image
												size={28}
											/>{:else}<Sparkles size={28} />{/if}
									</span>
								{/if}
								<span class="border-t-2 border-ink px-2 py-1.5"
									><span class="block truncate font-semibold">{label}</span><span
										class="block truncate text-ink/60">{sub}</span
									></span
								>
							</label>
						{/snippet}
						{@render choice('none', 'Fresh design', 'No image')}
						{@render choice('upload', 'Upload an image', 'AI works from it')}
						{@render choice('own', 'Your own flyer', 'As is, no AI')}
						{#each data.flyerSources as f (f.id)}
							{@render choice(
								`flyer:${f.id}`,
								f.eventName,
								`${stamp(f.createdAt)} · ${f.aspect === 'own' ? 'uploaded' : f.aspect}`
							)}
						{/each}
					</div>
				</fieldset>

				{#if flyerFrom === 'upload' || own}
					<label class="flex flex-col gap-1.5 text-sm font-medium">
						{own ? 'Your flyer' : 'Image'}
						<input
							type="file"
							name="reference"
							required
							accept={own
								? 'image/png,image/jpeg,image/webp,image/gif'
								: 'image/png,image/jpeg,image/webp'}
							class="field font-normal file:mr-3 file:rounded-full file:border-2 file:border-ink file:bg-white file:px-3 file:py-0.5"
						/>
						<span class="text-xs font-normal text-ink/55"
							>{own
								? 'Made in Canva, Figma or by a designer; used as is. PNG, JPEG, WebP or GIF, up to 20 MB.'
								: 'An earlier flyer, a poster or a photo. PNG, JPEG or WebP, up to 10 MB.'}</span
						>
					</label>
				{/if}

				{#if flyerFrom !== 'none' && !own}
					<fieldset class="flex flex-col gap-2">
						<legend class="mb-2 text-sm font-medium">Use it as</legend>
						<div class="grid gap-2 sm:grid-cols-2">
							<label
								class="flex cursor-pointer flex-col gap-0.5 rounded-xl border-2 border-ink px-4 py-3 text-sm has-[:checked]:bg-ink has-[:checked]:text-white"
							>
								<input
									type="radio"
									name="mode"
									value="update"
									bind:group={flyerMode}
									class="sr-only"
								/>
								<span class="font-semibold">The design: just update it</span>
								<span class="text-xs opacity-75"
									>Same layout, image and fonts, with this event’s details. Add changes below, e.g.
									other colours.</span
								>
							</label>
							<label
								class="flex cursor-pointer flex-col gap-0.5 rounded-xl border-2 border-ink px-4 py-3 text-sm has-[:checked]:bg-ink has-[:checked]:text-white"
							>
								<input
									type="radio"
									name="mode"
									value="style"
									bind:group={flyerMode}
									class="sr-only"
								/>
								<span class="font-semibold">A style reference</span>
								<span class="text-xs opacity-75"
									>A new design that looks like it belongs to the same series.</span
								>
							</label>
						</div>
					</fieldset>
				{/if}

				<div class={['grid items-start gap-4 sm:grid-cols-[1fr_16rem]', own && 'hidden']}>
					<label class="flex flex-col gap-1.5 text-sm font-medium">
						<span
							>{flyerFrom !== 'none' && flyerMode === 'update' ? 'Changes' : 'Extra direction'}
							<span class="font-normal text-ink/55">(optional)</span></span
						>
						<textarea
							name="prompt"
							maxlength="1000"
							class="min-h-20 field font-normal"
							placeholder={flyerFrom !== 'none' && flyerMode === 'update'
								? 'e.g. Use teal and yellow instead of orange. Make the date bigger.'
								: 'e.g. Gwangalli bridge at sunset in the background, lots of space around the title'}
						></textarea>
					</label>
					<label class="flex flex-col gap-1.5 text-sm font-medium">
						Format
						<select name="aspect" class="field">
							{#if flyerFrom.startsWith('flyer:')}<option value="same">Same as the original</option
								>{/if}
							<option value="4:5">Portrait 4:5 (Instagram post)</option>
							<option value="9:16">Story 9:16</option>
							<option value="1:1">Square 1:1</option>
							<option value="3:4">Poster 3:4</option>
							<option value="16:9">Wide 16:9</option>
						</select>
					</label>
				</div>
				{#if form?.uploadError}<p class="text-sm font-medium text-brand-deep" role="alert">
						{form.uploadError}
					</p>{/if}
				{#if form?.flyerError}<p class="text-sm font-medium text-brand-deep" role="alert">
						{form.flyerError}
					</p>{/if}
				<div>
					<button class="btn-ink" disabled={flyerBusy}
						>{#if own}<Upload size={16} />
							{flyerBusy ? 'Uploading…' : 'Upload flyer'}{:else}<Sparkles size={16} />
							{flyerBusy ? 'Drawing… (up to a minute)' : 'Generate flyer'}{/if}</button
					>
				</div>
			</form>
		{:else}
			<p class="card p-5 text-sm text-ink/70">
				Set an AI key (OPENROUTER_API_KEY, or SITE_AI_PROVIDER=ppq with PPQ_API_KEY) to generate
				flyers.
			</p>
		{/if}
		{#if data.flyers.length}
			<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.flyers as f (f.id)}
					{@const current = data.event.flyerId === f.id}
					<li class={['flex flex-col overflow-hidden card', current && 'ring-4 ring-brand']}>
						<a href="/flyers/{f.id}" target="_blank" rel="noopener" class="block bg-cream">
							<img
								src="/flyers/{f.id}"
								alt="Flyer for {data.event.name}"
								loading="lazy"
								class="mx-auto max-h-96 w-full object-contain"
							/>
						</a>
						<div class="flex flex-col gap-2 border-t-2 border-ink p-3 text-xs">
							<span class="text-ink/60"
								>{stamp(f.createdAt)}{f.aspect === 'own' ? '' : ` · ${f.aspect}`} · {MODE[f.mode] ??
									f.mode}{f.prompt ? ` · “${f.prompt}”` : ''}</span
							>
							<div class="flex flex-wrap items-center gap-2">
								<form method="POST" action="?/useFlyer" use:enhance>
									<input type="hidden" name="id" value={current ? '' : f.id} />
									<button
										class={[
											'rounded-full border-2 border-ink px-3 py-0.5 font-semibold',
											current ? 'bg-ink text-white' : 'bg-white'
										]}
										aria-pressed={current}
										>{current ? 'On the event page' : 'Use on event page'}</button
									>
								</form>
								<a class="inline-flex items-center gap-1 underline" href="/flyers/{f.id}?download"
									><Download size={12} /> Download</a
								>
								<form
									method="POST"
									action="?/deleteFlyer"
									class="ml-auto"
									use:enhance={({ cancel }) => {
										if (!confirm('Delete this flyer?')) cancel();
									}}
								>
									<input type="hidden" name="id" value={f.id} />
									<button class="text-ink/55 hover:text-brand-deep" aria-label="Delete flyer"
										><Trash2 size={14} /></button
									>
								</form>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Details: hidden, not removed, on other tabs, so unsaved edits survive switching -->
	<div
		class={['flex flex-col gap-3', tab !== 'details' && 'hidden']}
		oninput={() => (dirty = true)}
		onchange={() => (dirty = true)}
	>
		<h2 class="text-2xl font-semibold">Details</h2>
		{#if detailsMissing.length}
			<p class="rounded-xl bg-blush px-4 py-3 text-sm">
				Still missing: {detailsMissing.join(', ')}.
			</p>
		{/if}
		<EventForm
			event={data.event}
			signupForm={data.signupForm}
			action="?tab=details&/save"
			submitLabel="Save changes"
			ai={data.ai}
			error={form?.error}
		/>
		<form
			class="mt-6 border-t-2 border-dashed border-ink pt-6"
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (!confirm('Delete this event, its signups and results?')) cancel();
			}}
		>
			<button class="text-sm text-brand-deep underline">Delete event</button>
		</form>
	</div>
</section>
