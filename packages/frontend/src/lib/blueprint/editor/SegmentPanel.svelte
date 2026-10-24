<script lang="ts">
	import { LOW_CONFIDENCE, stationIds, type StationLayout } from 'common';
	import { Minus, Plus, Trash2 } from '@lucide/svelte';
	import type { Editor } from './editor.svelte';

	let { editor }: { editor: Editor } = $props();

	const s = $derived(editor.selected);

	function setCount(n: number) {
		if (!s) return;
		const count = Math.max(0, Math.min(500, Math.round(n || 0)));
		editor.updateSegment(s.id, (seg) => ({ ...seg, stations: { ...seg.stations, count } }), `count:${s.id}`);
	}

	function setLayout(layout: StationLayout) {
		if (!s) return;
		editor.updateSegment(s.id, (seg) => ({ ...seg, stations: { ...seg.stations, layout } }));
	}

	function setName(name: string) {
		if (!s || !name.trim()) return;
		editor.updateSegment(s.id, (seg) => ({ ...seg, name: name.slice(0, 60) }), `name:${s.id}`);
	}
</script>

{#if s}
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1">
			<span class="bp-label text-xs opacity-60">Name</span>
			<input
				class="input input-sm bp-label w-full border-bp-line/40 bg-transparent"
				value={s.name}
				maxlength="60"
				oninput={(e) => setName(e.currentTarget.value)}
			/>
		</label>

		<div class="flex flex-col gap-1">
			<span class="bp-label text-xs opacity-60">Stations</span>
			<div class="flex items-stretch">
				<button class="btn btn-sm btn-outline btn-square" aria-label="Fewer stations" onclick={() => setCount(s.stations.count - 1)}>
					<Minus size={14} />
				</button>
				<input
					type="number"
					min="0"
					max="500"
					class="input input-sm w-20 border-x-0 border-bp-line/40 bg-transparent text-center font-mono"
					value={s.stations.count}
					oninput={(e) => setCount(e.currentTarget.valueAsNumber)}
				/>
				<button class="btn btn-sm btn-outline btn-square" aria-label="More stations" onclick={() => setCount(s.stations.count + 1)}>
					<Plus size={14} />
				</button>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span class="bp-label text-xs opacity-60">Layout</span>
			<div class="join">
				{#each ['grid', 'row'] as const as layout (layout)}
					<button
						class={['btn btn-sm join-item bp-label', s.stations.layout === layout ? 'btn-primary' : 'btn-outline']}
						onclick={() => setLayout(layout)}>{layout}</button
					>
				{/each}
			</div>
		</div>

		<label class="flex cursor-pointer items-center justify-between gap-2 border border-bp-line/30 p-2">
			<span class="bp-label text-sm">Count confirmed</span>
			<input
				type="checkbox"
				class="toggle toggle-sm"
				checked={s.stations.confirmed}
				onchange={(e) => editor.setConfirmed(s.id, e.currentTarget.checked)}
			/>
		</label>

		{#if s.confidence !== undefined}
			<p class="font-mono text-xs opacity-60">
				AI confidence {Math.round(s.confidence * 100)}%{s.confidence < LOW_CONFIDENCE ? ' · low, check it' : ''}
			</p>
		{/if}

		<dl class="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs opacity-60">
			<dt>ID</dt>
			<dd class="truncate">{s.id}</dd>
			<dt>SHAPE</dt>
			<dd>{s.shape} · {s.points.length} pts</dd>
			<dt>STATIONS</dt>
			<dd class="truncate">{s.stations.count ? `${stationIds(s)[0]} …` : '—'}</dd>
		</dl>

		<button class="btn btn-sm btn-outline bp-label" onclick={() => editor.deleteSegment(s.id)}>
			<Trash2 size={14} /> Delete segment
		</button>
		<p class="font-mono text-[10px] leading-relaxed opacity-40">
			DBL-CLICK LABEL: RENAME · DRAG LABEL: MOVE IT · ALT: NO SNAP{s.shape === 'polygon'
				? ' · DBL-CLICK EDGE: ADD VERTEX · ALT+CLICK VERTEX: REMOVE'
				: ''}
		</p>
	</div>
{:else}
	<p class="bp-label text-sm opacity-50">Select a segment, or draw one with the rect / polygon tool.</p>
{/if}
