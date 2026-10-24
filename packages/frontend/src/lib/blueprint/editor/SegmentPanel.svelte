<script lang="ts">
	import { LOW_CONFIDENCE, stationIds, type StationLayout } from 'common';
	import { Minus, Plus, Square, SquareDashed, Trash2 } from '@lucide/svelte';
	import type { Editor } from './editor.svelte';

	let { editor }: { editor: Editor } = $props();

	const s = $derived(editor.selected);
	const wall = $derived(editor.selectedWall);
	const room = $derived(editor.selectedRoom);
	/** Segment whose last Orthogonalize collapsed it (shows a hint until another segment is picked). */
	let orthoFailedId = $state<string | null>(null);

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

		{#if s.shape === 'polygon'}
			<div class="grid grid-cols-2 gap-2">
				<button class="btn btn-sm btn-outline bp-label" onclick={() => editor.convertToRect(s.id)} title="Replace the polygon with its bounding rect">
					<Square size={14} /> To rect
				</button>
				<button
					class="btn btn-sm btn-outline bp-label"
					onclick={() => (orthoFailedId = editor.orthogonalize(s.id) ? null : s.id)}
					title="Make every edge horizontal or vertical"
				>
					<SquareDashed size={14} /> Orthogonalize
				</button>
			</div>
			{#if orthoFailedId === s.id}
				<p class="font-mono text-xs text-bp-accent">Too few vertices left after straightening; try To rect.</p>
			{/if}
			{#if editor.selectedVertex !== null}
				<button
					class="btn btn-sm btn-outline bp-label"
					disabled={s.points.length <= 3}
					onclick={() => editor.deleteVertex(s.id, editor.selectedVertex!)}
				>
					<Trash2 size={14} /> Delete vertex {editor.selectedVertex + 1}
				</button>
			{/if}
		{/if}

		<button class="btn btn-sm btn-outline bp-label" onclick={() => editor.deleteSegment(s.id)}>
			<Trash2 size={14} /> Delete segment
		</button>
		<p class="font-mono text-[10px] leading-relaxed opacity-40">
			DBL-CLICK LABEL: RENAME · DRAG LABEL: SLIDE IT · EDGES SNAP TO WALLS · ALT: NO SNAP{s.shape === 'polygon'
				? ' · DBL-CLICK EDGE: ADD VERTEX · CLICK VERTEX + DEL: REMOVE'
				: ''}
		</p>
	</div>
{:else if wall}
	{@const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])}
	<div class="flex flex-col gap-4">
		<span class="bp-label text-sm">Wall</span>
		<dl class="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs opacity-60">
			<dt>ID</dt>
			<dd class="truncate">{wall.id}</dd>
			<dt>FROM</dt>
			<dd>{Math.round(wall.a[0])},{Math.round(wall.a[1])}</dd>
			<dt>TO</dt>
			<dd>{Math.round(wall.b[0])},{Math.round(wall.b[1])}</dd>
			<dt>LENGTH</dt>
			<dd>{Math.round(len)}</dd>
		</dl>
		<button class="btn btn-sm btn-outline bp-label" onclick={() => editor.deleteWall(wall.id)}>
			<Trash2 size={14} /> Delete wall
		</button>
		<p class="font-mono text-[10px] leading-relaxed opacity-40">
			DRAG: MOVE · DRAG END: RESIZE (STAYS STRAIGHT, ALT: ANY ANGLE) · ENDS SNAP TO WALLS · ARROWS: NUDGE · DEL: REMOVE
		</p>
	</div>
{:else if room}
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1">
			<span class="bp-label text-xs opacity-60">Room label</span>
			<input
				class="input input-sm bp-label w-full border-bp-line/40 bg-transparent"
				value={room.label}
				maxlength="60"
				oninput={(e) => editor.renameRoom(room.id, e.currentTarget.value, `room:${room.id}`)}
			/>
		</label>
		<p class="text-sm opacity-60">A non-work area (kitchen, WC, stairs). It has no stations.</p>
		<button class="btn btn-sm btn-outline bp-label" onclick={() => editor.deleteRoom(room.id)}>
			<Trash2 size={14} /> Delete room label
		</button>
		<p class="font-mono text-[10px] leading-relaxed opacity-40">DBL-CLICK: RENAME · DRAG: MOVE · DEL: REMOVE</p>
	</div>
{:else}
	<p class="bp-label text-sm opacity-50">
		Select a segment, wall or room, or draw with the rect / polygon / wall tool.
	</p>
{/if}
