<script lang="ts">
	import { onMount } from 'svelte';
	import { totalStations, type Blueprint as BlueprintT, type BlueprintLibraryItemDTO } from 'common';
	import { LoaderCircle, X } from '@lucide/svelte';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import { blueprints } from '$lib/api';
	import { errorMessage } from '$lib/stores/toast.svelte';

	interface Props {
		eventId: string;
		/** Dev fixture mode: there is no backend to list from. */
		offline?: boolean;
		onaccept: (blueprint: BlueprintT, from: BlueprintLibraryItemDTO) => void;
		onclose: () => void;
	}

	let { eventId, offline = false, onaccept, onclose }: Props = $props();

	let items = $state.raw<BlueprintLibraryItemDTO[] | null>(null);
	let error = $state('');
	let selectedId = $state<string | null>(null);
	const selected = $derived(items?.find((i) => i.eventId === selectedId) ?? null);

	onMount(async () => {
		if (offline) {
			items = [];
			return;
		}
		try {
			items = (await blueprints.library(eventId)).items;
		} catch (e) {
			error = errorMessage(e);
		}
	});

	const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
</script>

<dialog class="modal" open aria-labelledby="reuse-title">
	<div class="modal-box flex max-h-[92vh] w-11/12 max-w-5xl flex-col gap-4 border border-bp-line/60">
		<div class="flex items-center gap-3">
			<h3 id="reuse-title" class="mr-auto bp-label text-lg font-semibold">Reuse a floorplan</h3>
			<button class="btn btn-square btn-ghost btn-sm" onclick={onclose} aria-label="Close"><X size={16} /></button>
		</div>

		{#if error}
			<p class="border border-bp-line/50 px-3 py-2 text-sm" role="alert">{error}</p>
		{:else if items === null}
			<p class="flex items-center gap-2 py-10 text-sm opacity-70">
				<LoaderCircle size={16} class="animate-spin" /> Loading your floorplans…
			</p>
		{:else if items.length === 0}
			<p class="py-10 text-center text-sm opacity-70">
				No saved floorplans from your other events yet. Draw or import one here, and it will be offered next time.
			</p>
		{:else}
			<div class="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
				{#each items as item (item.eventId)}
					<button
						class={[
							'flex flex-col gap-2 border p-2 text-left transition-colors',
							item.eventId === selectedId ? 'border-bp-accent' : 'border-bp-line/40 hover:border-bp-line'
						]}
						aria-pressed={item.eventId === selectedId}
						onclick={() => (selectedId = item.eventId)}
						ondblclick={() => onaccept(item.blueprint, item)}
					>
						<Blueprint blueprint={item.blueprint} showUnderlay showTitleBlock={false} class="aspect-[4/3] w-full" />
						<span class="truncate bp-label font-semibold">{item.eventName}</span>
						<span class="font-mono text-xs opacity-60">
							{day(item.startedAt ?? item.updatedAt)} · {item.blueprint.segments.length} SEG · {totalStations(item.blueprint)} ST
						</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="modal-action mt-0 flex-wrap">
			<span class="mr-auto self-center text-sm opacity-60">
				Replaces the current blueprint (walls, segments, stations, underlay). Undo with Ctrl+Z.
			</span>
			<button class="btn btn-ghost bp-label btn-sm" onclick={onclose}>Cancel</button>
			<button class="btn bp-label btn-primary btn-sm" disabled={!selected} onclick={() => selected && onaccept(selected.blueprint, selected)}>
				Use this floorplan
			</button>
		</div>
	</div>
	<button class="modal-backdrop" onclick={onclose} aria-label="Close dialog"></button>
</dialog>
