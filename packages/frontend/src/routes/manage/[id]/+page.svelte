<script lang="ts">
	import { goto } from '$app/navigation';
	import { events as eventsApi, invites as invitesApi } from '$lib/api';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { handleError, toasts } from '$lib/stores/toast.svelte';
	import { wsStore } from '$lib/stores/websocket.svelte';
	import type { EventDTO, PublicEventDTO } from 'common';
	import { Copy, ExternalLink, QrCode, Trash2 } from '@lucide/svelte';

	let { data } = $props();

	// Writable deriveds: reset when navigating to another event, updated locally and via WS.
	let event = $derived(data.event);
	let participants = $derived(data.participants);
	let invites = $derived(data.invites);

	let busy = $state(false);

	const slug = $derived(event.slug);
	const eventId = $derived(event.id);
	const canToggleJoining = $derived(event.status === 'draft' || event.status === 'open');

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
				if (e.snapshot.event.id === id) mergeEvent(e.snapshot.event);
			}),
			wsStore.on('launched', (e) => mergeEvent(e.snapshot.event))
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
	const sortedInvites = $derived([...invites].sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt - a.createdAt));
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
					<button class="btn btn-primary btn-sm bp-label" disabled={busy} onclick={() => setStatus('open')}>
						Open joining
					</button>
				{:else}
					<button class="btn btn-outline btn-sm bp-label" disabled={busy} onclick={() => setStatus('draft')}>
						Close joining
					</button>
				{/if}
			{/if}
			<a class="btn btn-outline btn-sm bp-label" href="/manage/{event.id}/blueprint">Edit blueprint</a>
			<a class="btn btn-outline btn-sm bp-label" href="/e/{event.slug}/tv" target="_blank" rel="noopener">
				Open TV <ExternalLink size={14} />
			</a>
		</div>
	</header>

	<div class="grid gap-8 lg:grid-cols-[1fr_24rem]">
		<section class="flex flex-col gap-3">
			<div class="flex items-baseline justify-between">
				<h2 class="bp-label text-xl">Participants</h2>
				<span class="font-mono text-xs opacity-60">{participants.length} total</span>
			</div>
			{#if sortedParticipants.length === 0}
				<div class="border border-dashed border-bp-line/40 p-8 text-center">
					<p class="bp-label opacity-60">Nobody has joined yet</p>
					<p class="mt-1 font-mono text-xs opacity-50">
						{event.status === 'draft' ? 'Open joining, then show an invite QR on the venue screen.' : 'Show an invite QR on the venue screen.'}
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
									<td>{p.displayName}</td>
									<td class="font-mono text-xs">{p.friendCode}</td>
									<td class="font-mono text-xs opacity-70">{p.teamId ?? '—'}</td>
									<td class="text-right font-mono text-xs opacity-70">
										{new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

		<aside class="flex flex-col gap-8">
			<section class="flex flex-col gap-3">
				<div class="flex items-center justify-between">
					<h2 class="bp-label text-xl">Invites</h2>
					<button class="btn btn-outline btn-xs bp-label" onclick={createInvite}>New invite</button>
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
					<div class={['flex flex-col gap-3 border p-3', inv.active ? 'border-bp-line/60' : 'border-bp-line/20 opacity-60']}>
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-mono text-xs" title={inv.token}>/join/{inv.token}</span>
							<span class="bp-label shrink-0 text-xs">{inv.active ? 'Active' : 'Inactive'}</span>
						</div>
						{#if inv.expiresAt}
							<span class="font-mono text-xs opacity-60">Expires {new Date(inv.expiresAt).toLocaleString()}</span>
						{/if}
						<div class="flex flex-wrap gap-2">
							{#if inv.active}
								<a class="btn btn-primary btn-xs bp-label" href="/manage/{event.id}/qr/{inv.id}">
									<QrCode size={14} /> Show QR on screen
								</a>
								<button class="btn btn-outline btn-xs bp-label" onclick={() => copyLink(inv.token)}>
									<Copy size={14} /> Copy link
								</button>
								<button class="btn btn-ghost btn-xs bp-label" onclick={() => setInviteActive(inv.id, false)}>
									Deactivate
								</button>
							{:else}
								<button class="btn btn-outline btn-xs bp-label" onclick={() => setInviteActive(inv.id, true)}>
									Reactivate
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</section>

			{#if session.is('manager') && event.status !== 'live'}
				<section class="flex flex-col gap-2 border-t border-bp-line/20 pt-6">
					<button class="btn btn-ghost btn-xs bp-label w-fit text-error" onclick={deleteEvent}>Delete event</button>
				</section>
			{/if}
		</aside>
	</div>
</main>
