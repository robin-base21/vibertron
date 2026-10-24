<script lang="ts">
	import { ApiError, launch } from '$lib/api';
	import { errorMessage } from '$lib/stores/toast.svelte';
	import type { EventDTO, LaunchPreviewDTO, TeamDTO } from 'common';

	interface Props {
		event: EventDTO;
		onlaunched: (event: EventDTO, teams: TeamDTO[]) => void;
	}

	let { event, onlaunched }: Props = $props();

	const PRESETS = [60, 120, 240, 480];

	let dialog: HTMLDialogElement | undefined = $state();
	// svelte-ignore state_referenced_locally
	let teamSize = $state(event.teamSize ?? 3);
	// svelte-ignore state_referenced_locally
	let duration = $state(event.durationMin ?? 120);
	let preview = $state<LaunchPreviewDTO | null>(null);
	let previewError = $state<string | null>(null);
	let loadingPreview = $state(false);
	let launching = $state(false);
	let launchError = $state<string | null>(null);
	let result = $state<TeamDTO[] | null>(null);
	let isOpen = $state(false);

	const validSize = $derived(Number.isInteger(teamSize) && teamSize >= 1 && teamSize <= 20);
	const validDuration = $derived(
		Number.isInteger(duration) && duration >= 1 && duration <= 60 * 72
	);
	const canLaunch = $derived(validSize && validDuration && preview?.ok === true && !launching);

	export function open() {
		result = null;
		launchError = null;
		isOpen = true;
		dialog?.showModal();
	}

	// Debounced capacity preview while the dialog is open.
	$effect(() => {
		if (!isOpen || !validSize) return;
		const size = teamSize;
		let cancelled = false;
		const t = setTimeout(async () => {
			loadingPreview = true;
			try {
				const p = await launch.preview(event.id, { teamSize: size });
				if (!cancelled) {
					preview = p;
					previewError = null;
				}
			} catch (err) {
				if (!cancelled) {
					preview = null;
					previewError = errorMessage(err);
				}
			} finally {
				if (!cancelled) loadingPreview = false;
			}
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	});

	async function doLaunch() {
		launching = true;
		launchError = null;
		try {
			const res = await launch.launch(event.id, { teamSize, durationMin: duration });
			result = res.teams;
			onlaunched(res.event, res.teams);
		} catch (err) {
			if (err instanceof ApiError && err.code === 'capacity') {
				const d = err.details as { needed?: number; available?: number } | undefined;
				launchError =
					d?.needed !== undefined
						? `Not enough stations: need ${d.needed}, have ${d.available}.`
						: err.message;
			} else {
				launchError = errorMessage(err);
			}
		} finally {
			launching = false;
		}
	}

	const sortedTeams = $derived(
		result ? [...result].sort((a, b) => a.name.localeCompare(b.name)) : []
	);
</script>

<dialog bind:this={dialog} class="modal" onclose={() => (isOpen = false)}>
	<div class="modal-box flex max-w-2xl flex-col gap-6 border border-bp-line/60 bg-base-100">
		<div class="flex items-baseline justify-between">
			<h2 class="bp-label text-3xl font-semibold">{result ? 'Launched' : 'Launch event'}</h2>
			<span class="font-mono text-xs opacity-60">{event.participantCount} participants</span>
		</div>

		{#if result}
			<p class="font-mono text-sm opacity-70">
				{result.length} teams assigned. Attendees now see their stations.
			</p>
			<div
				class="grid max-h-[50vh] gap-px overflow-y-auto border border-bp-line/40 bg-bp-line/40 sm:grid-cols-2"
			>
				{#each sortedTeams as team (team.id)}
					<div class="flex flex-col gap-1 bg-base-100 p-3">
						<div class="flex items-baseline justify-between gap-2">
							<span class="bp-label text-lg">{team.name}</span>
							<span class="font-mono text-xs opacity-60">{team.segmentId}</span>
						</div>
						<ul class="flex flex-col font-mono text-xs">
							{#each team.members as m (m.participantId)}
								<li class="flex justify-between gap-2">
									<span class="truncate">{m.displayName}</span><span class="opacity-60"
										>{m.stationId}</span
									>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
			<div class="modal-action">
				<form method="dialog"><button class="btn bp-label btn-primary">Done</button></form>
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="flex flex-col gap-1">
					<span class="bp-label text-xs opacity-70">Team size</span>
					<input
						class="input w-full font-mono"
						type="number"
						min="1"
						max="20"
						bind:value={teamSize}
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="bp-label text-xs opacity-70">Duration (minutes)</span>
					<input
						class="input w-full font-mono"
						type="number"
						min="1"
						max={60 * 72}
						bind:value={duration}
					/>
				</label>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each PRESETS as p (p)}
					<button
						type="button"
						class={['btn font-mono btn-xs', duration === p ? 'btn-primary' : 'btn-outline']}
						onclick={() => (duration = p)}
					>
						{p / 60}h
					</button>
				{/each}
			</div>

			<section class="flex flex-col gap-3 border border-bp-line/40 p-4" aria-live="polite">
				<div class="flex items-center justify-between">
					<span class="bp-label text-sm opacity-70">Capacity check</span>
					{#if loadingPreview}<span class="loading loading-xs loading-spinner"></span>{/if}
				</div>
				{#if previewError}
					<p class="font-mono text-xs text-error">{previewError}</p>
				{:else if preview}
					<dl class="grid grid-cols-3 gap-4">
						<div>
							<dt class="bp-label text-xs opacity-60">Teams</dt>
							<dd class="font-mono text-2xl">{preview.teams}</dd>
						</div>
						<div>
							<dt class="bp-label text-xs opacity-60">Participants</dt>
							<dd class="font-mono text-2xl">{preview.participants}</dd>
						</div>
						<div>
							<dt class="bp-label text-xs opacity-60">Stations</dt>
							<dd
								class={[
									'font-mono text-2xl',
									preview.stationsAvailable < preview.participants && 'text-error'
								]}
							>
								{preview.stationsAvailable}
							</dd>
						</div>
					</dl>
					{#if preview.unconfirmedSegments.length > 0}
						<div class="flex flex-col gap-1 border-t border-bp-line/20 pt-3">
							<span class="bp-label text-xs text-error">Unconfirmed segments</span>
							<span class="font-mono text-xs">{preview.unconfirmedSegments.join(', ')}</span>
							<a
								class="bp-label text-xs underline underline-offset-4"
								href="/manage/{event.id}/blueprint"
							>
								Confirm station counts in the editor →
							</a>
						</div>
					{/if}
					{#if preview.message}
						<p class={['font-mono text-xs', !preview.ok && 'text-error']}>{preview.message}</p>
					{:else if preview.ok}
						<p class="font-mono text-xs opacity-70">Ready to launch.</p>
					{/if}
				{:else if !validSize}
					<p class="font-mono text-xs text-error">Team size must be 1–20.</p>
				{/if}
			</section>

			{#if launchError}
				<p class="font-mono text-xs text-error" role="alert">{launchError}</p>
			{/if}

			<div class="modal-action">
				<form method="dialog"><button class="btn btn-ghost bp-label">Cancel</button></form>
				<button class="btn bp-label btn-primary" disabled={!canLaunch} onclick={doLaunch}>
					{launching ? 'Launching…' : `Launch · ${duration} min`}
				</button>
			</div>
		{/if}
	</div>
	<form method="dialog" class="modal-backdrop"><button aria-label="Close">close</button></form>
</dialog>
