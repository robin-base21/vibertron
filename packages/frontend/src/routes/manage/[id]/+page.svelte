<script lang="ts">
	import { goto } from '$app/navigation';
	import { events as eventsApi, invites as invitesApi, launch } from '$lib/api';
	import Countdown from '$lib/components/Countdown.svelte';
	import LaunchDialog from '$lib/components/manage/LaunchDialog.svelte';
	import Moderation from '$lib/components/manage/Moderation.svelte';
	import VotingPanel from '$lib/components/manage/VotingPanel.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { handleError, toasts } from '$lib/stores/toast.svelte';
	import { wsStore } from '$lib/stores/websocket.svelte';
	import type {
		EventDTO,
		MessageDTO,
		ProjectDTO,
		PublicEventDTO,
		TeamDTO,
		VotingStateDTO
	} from 'common';
	import { Copy, ExternalLink, QrCode, Trash2 } from '@lucide/svelte';

	let { data } = $props();

	// Writable deriveds: reset when navigating to another event, updated locally and via WS.
	let event = $derived(data.event);
	let participants = $derived(data.participants);
	let invites = $derived(data.invites);

	let messages = $state<MessageDTO[]>([]);
	let teams = $state<TeamDTO[]>([]);
	let projects = $state<ProjectDTO[]>([]);
	let voting = $state<VotingStateDTO | null>(null);
	const teamLabel = $derived(
		new Map(teams.map((t) => [t.id, t.codename ? `${t.codename} (${t.name})` : t.name]))
	);
	let busy = $state(false);
	let launchDialog: LaunchDialog | undefined = $state();

	const slug = $derived(event.slug);
	const eventId = $derived(event.id);
	const canToggleJoining = $derived(event.status === 'draft' || event.status === 'open');

	function upsertMessage(m: MessageDTO) {
		if (m.eventId !== event.id) return;
		const i = messages.findIndex((x) => x.id === m.id);
		if (i === -1) messages.push(m);
		else messages[i] = m;
	}

	function mergeEvent(next: PublicEventDTO | EventDTO) {
		if (next.id === event.id) event = { ...event, ...next };
	}

	$effect(() => {
		const id = eventId;
		const offs = [
			wsStore.subscribe(slug, 'manage'),
			wsStore.on('participants.updated', (e) => {
				if (e.eventId === id) participants = e.participants;
			}),
			wsStore.on('participants.count', (e) => {
				if (e.eventId === id) event = { ...event, participantCount: e.count };
			}),
			wsStore.on('event.manage.updated', (e) => mergeEvent(e.event)),
			wsStore.on('event.updated', (e) => mergeEvent(e.event)),
			wsStore.on('subscribed', (e) => {
				if (e.snapshot.event.id !== id) return;
				mergeEvent(e.snapshot.event);
				projects = e.snapshot.projects ?? [];
				voting = e.snapshot.voting ?? null;
				messages = e.snapshot.messages;
				teams = e.snapshot.teams;
			}),
			wsStore.on('launched', (e) => {
				if (e.snapshot.event.id !== id) return;
				mergeEvent(e.snapshot.event);
				teams = e.snapshot.teams;
			}),
			wsStore.on('team.updated', (e) => {
				if (e.team.eventId === id) teams = teams.map((t) => (t.id === e.team.id ? e.team : t));
			}),
			// Managers get every message (incl. hidden) on the manage topic; public copies dedupe.
			wsStore.on('project.updated', (e) => {
				if (e.project.eventId !== id) return;
				const i = projects.findIndex((p) => p.id === e.project.id);
				if (i === -1) projects.push(e.project);
				else projects[i] = e.project;
			}),
			wsStore.on('voting.updated', (e) => {
				if (e.eventId !== id) return;
				voting = e.voting;
				event = { ...event, votingPhase: e.voting.phase };
			}),
			wsStore.on('message.manage', (e) => upsertMessage(e.message)),
			wsStore.on('message.created', (e) => upsertMessage(e.message)),
			wsStore.on('message.hidden', (e) => {
				const m = messages.find((x) => x.id === e.messageId);
				if (m) m.hidden = e.hidden;
			})
		];
		return () => offs.forEach((off) => off());
	});

	async function setStatus(status: 'draft' | 'open') {
		busy = true;
		try {
			const res = await eventsApi.update(eventId, { status });
			event = res.event;
		} catch (err) {
			handleError(err);
		} finally {
			busy = false;
		}
	}

	async function endEvent() {
		if (!confirm('End the event now? The countdown stops and messaging closes.')) return;
		busy = true;
		try {
			const res = await launch.end(eventId);
			event = res.event;
		} catch (err) {
			handleError(err);
		} finally {
			busy = false;
		}
	}

	async function removeParticipant(pid: string, name: string) {
		if (!confirm(`Remove ${name} from this event?`)) return;
		try {
			await eventsApi.removeParticipant(eventId, pid);
			participants = participants.filter((p) => p.id !== pid);
			toasts.success(`Removed ${name}`);
		} catch (err) {
			handleError(err);
		}
	}

	async function createInvite() {
		try {
			const { invite } = await invitesApi.create(eventId);
			invites = [invite, ...invites];
		} catch (err) {
			handleError(err);
		}
	}

	async function setInviteActive(id: string, active: boolean) {
		try {
			const { invite } = await invitesApi.update(id, { active });
			invites = invites.map((i) => (i.id === id ? invite : i));
		} catch (err) {
			handleError(err);
		}
	}

	const joinLink = (token: string) => `${location.origin}/join/${token}`;

	async function copyLink(token: string) {
		try {
			await navigator.clipboard.writeText(joinLink(token));
			toasts.success('Join link copied');
		} catch {
			toasts.error('Clipboard unavailable: ' + joinLink(token));
		}
	}

	async function deleteEvent() {
		if (!confirm(`Delete “${event.name}” and all its data? This cannot be undone.`)) return;
		try {
			await eventsApi.remove(eventId);
			toasts.success('Event deleted');
			await goto('/manage');
		} catch (err) {
			handleError(err);
		}
	}

	const sortedParticipants = $derived([...participants].sort((a, b) => a.joinedAt - b.joinedAt));
	const sortedInvites = $derived(
		[...invites].sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt - a.createdAt)
	);
</script>

<svelte:head><title>{event.name} · Vibertron</title></svelte:head>

<main class="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8">
	<header class="flex flex-col gap-4 border-b border-bp-line/40 pb-6 lg:flex-row lg:items-end">
		<div class="flex flex-1 flex-col gap-2">
			<a href="/manage" class="bp-label text-xs opacity-60 hover:opacity-100">← Events</a>
			<div class="flex flex-wrap items-center gap-3">
				<h1 class="bp-label text-4xl font-semibold">{event.name}</h1>
				<StatusBadge status={event.status} />
			</div>
			<p class="font-mono text-xs opacity-60">
				/{event.slug} · ID {event.id} · <span class="tabular-nums">{event.participantCount}</span> participants
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if canToggleJoining}
				{#if event.status === 'draft'}
					<button
						class="btn bp-label btn-primary btn-sm"
						disabled={busy}
						onclick={() => setStatus('open')}
					>
						Open joining
					</button>
				{:else}
					<button
						class="btn btn-outline bp-label btn-sm"
						disabled={busy}
						onclick={() => setStatus('draft')}
					>
						Close joining
					</button>
				{/if}
			{/if}
			{#if event.status === 'draft' || event.status === 'open'}
				<button class="btn bp-label btn-primary btn-sm" onclick={() => launchDialog?.open()}
					>Launch…</button
				>
			{:else if event.status === 'live'}
				<button
					class="btn btn-outline bp-label text-error btn-sm"
					disabled={busy}
					onclick={endEvent}
				>
					End event
				</button>
			{/if}
			<a class="btn btn-outline bp-label btn-sm" href="/manage/{event.id}/blueprint"
				>Edit blueprint</a
			>
			<a
				class="btn btn-outline bp-label btn-sm"
				href="/e/{event.slug}/tv"
				target="_blank"
				rel="noopener"
			>
				Open TV <ExternalLink size={14} />
			</a>
		</div>
	</header>

	{#if event.status === 'live' || event.status === 'ended'}
		<section class="flex flex-col gap-6 border border-bp-line/60 p-5 sm:flex-row sm:items-center">
			<div class="flex flex-col">
				<span class="bp-label text-xs opacity-60"
					>{event.status === 'live' ? 'Time left' : 'Event ended'}</span
				>
				<Countdown endsAt={event.status === 'live' ? event.endsAt : 0} class="text-6xl" />
			</div>
			<dl class="grid flex-1 grid-cols-3 gap-4 font-mono text-sm">
				<div>
					<dt class="bp-label text-xs opacity-60">Team size</dt>
					<dd>{event.teamSize ?? '—'}</dd>
				</div>
				<div>
					<dt class="bp-label text-xs opacity-60">Duration</dt>
					<dd>{event.durationMin ?? '—'} min</dd>
				</div>
				<div>
					<dt class="bp-label text-xs opacity-60">Ends</dt>
					<dd>
						{event.endsAt
							? new Date(event.endsAt).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit'
								})
							: '—'}
					</dd>
				</div>
			</dl>
		</section>
	{/if}

	<div class="grid gap-8 lg:grid-cols-[1fr_24rem]">
		<div class="flex flex-col gap-8">
			{#if event.status === 'live' || event.status === 'ended'}
				<VotingPanel
					{event}
					{teams}
					{projects}
					{voting}
					onchange={(next, state) => {
						event = next;
						voting = state;
					}}
				/>
				<Moderation {messages} onupdate={upsertMessage} />
			{/if}
			<section class="flex flex-col gap-3">
				<div class="flex items-baseline justify-between">
					<h2 class="bp-label text-xl">Participants</h2>
					<span class="font-mono text-xs opacity-60">{participants.length} total</span>
				</div>
				{#if sortedParticipants.length === 0}
					<div class="border border-dashed border-bp-line/40 p-8 text-center">
						<p class="bp-label opacity-60">Nobody has joined yet</p>
						<p class="mt-1 font-mono text-xs opacity-50">
							{event.status === 'draft'
								? 'Open joining, then show an invite QR on the venue screen.'
								: 'Show an invite QR on the venue screen.'}
						</p>
					</div>
				{:else}
					<div class="overflow-x-auto border border-bp-line/40">
						<table class="table table-sm">
							<thead>
								<tr class="bp-label">
									<th>Name</th>
									<th>Friend code</th>
									<th>Team</th>
									<th class="text-right">Joined</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each sortedParticipants as p (p.id)}
									<tr>
										<td class="text-base">{p.displayName}</td>
										<td class="font-mono text-xs">{p.friendCode}</td>
										<td class="bp-label text-sm opacity-80"
											>{p.teamId ? (teamLabel.get(p.teamId) ?? '…') : '—'}</td
										>
										<td class="text-right font-mono text-xs opacity-70">
											{new Date(p.joinedAt).toLocaleTimeString([], {
												hour: '2-digit',
												minute: '2-digit'
											})}
										</td>
										<td class="w-0 text-right">
											<button
												class="btn btn-ghost btn-xs"
												aria-label="Remove {p.displayName}"
												title="Remove"
												onclick={() => removeParticipant(p.id, p.displayName)}
											>
												<Trash2 size={14} />
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		</div>

		<aside class="flex flex-col gap-8">
			<section class="flex flex-col gap-3">
				<div class="flex items-center justify-between">
					<h2 class="bp-label text-xl">Invites</h2>
					<button class="btn btn-outline bp-label btn-xs" onclick={createInvite}>New invite</button>
				</div>
				{#if event.status === 'draft'}
					<p class="font-mono text-xs opacity-60">Joining is closed while the event is a draft.</p>
				{/if}
				{#if sortedInvites.length === 0}
					<div class="border border-dashed border-bp-line/40 p-6 text-center">
						<p class="bp-label text-sm opacity-60">No invites</p>
					</div>
				{/if}
				{#each sortedInvites as inv (inv.id)}
					<div
						class={[
							'flex flex-col gap-3 border p-3',
							inv.active ? 'border-bp-line/60' : 'border-bp-line/20 opacity-60'
						]}
					>
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-mono text-xs" title={inv.token}>/join/{inv.token}</span>
							<span class="shrink-0 bp-label text-xs">{inv.active ? 'Active' : 'Inactive'}</span>
						</div>
						{#if inv.expiresAt}
							<span class="font-mono text-xs opacity-60"
								>Expires {new Date(inv.expiresAt).toLocaleString()}</span
							>
						{/if}
						<div class="flex flex-wrap gap-2">
							{#if inv.active}
								<a class="btn bp-label btn-primary btn-xs" href="/manage/{event.id}/qr/{inv.id}">
									<QrCode size={14} /> Show QR on screen
								</a>
								<button class="btn btn-outline bp-label btn-xs" onclick={() => copyLink(inv.token)}>
									<Copy size={14} /> Copy link
								</button>
								<button
									class="btn btn-ghost bp-label btn-xs"
									onclick={() => setInviteActive(inv.id, false)}
								>
									Deactivate
								</button>
							{:else}
								<button
									class="btn btn-outline bp-label btn-xs"
									onclick={() => setInviteActive(inv.id, true)}
								>
									Reactivate
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</section>

			{#if session.is('manager') && event.status !== 'live'}
				<section class="flex flex-col gap-2 border-t border-bp-line/20 pt-6">
					<button class="btn w-fit btn-ghost bp-label text-error btn-xs" onclick={deleteEvent}
						>Delete event</button
					>
				</section>
			{/if}
		</aside>
	</div>
</main>

<!-- Stays mounted after launch so the result view survives the status change. -->
<LaunchDialog
	bind:this={launchDialog}
	{event}
	onlaunched={(next, launchedTeams) => {
		teams = launchedTeams;
		event = next;
		eventsApi.participants(eventId).then((r) => (participants = r.participants), handleError);
	}}
/>
