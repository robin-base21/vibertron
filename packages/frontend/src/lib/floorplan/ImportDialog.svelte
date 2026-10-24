<script lang="ts">
	import { ROOM_MARK_BASE, totalStations, type Blueprint as BlueprintT } from 'common';
	import { Check, ImageUp, LoaderCircle, TriangleAlert, X } from '@lucide/svelte';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import { pointsAttr } from '$lib/blueprint/geometry';
	import { FONT_MONO } from '$lib/blueprint/types';
	import { blueprints } from '$lib/api';
	import { errorMessage } from '$lib/stores/toast.svelte';
	import { detectFloorplan, type DetectRun } from './detect';
	import { applyDraft, fitDraft, localDraft } from './draft';
	import { labelSpot, roomPolygon } from './marked';

	interface Props {
		eventId: string;
		current: BlueprintT;
		/** Dev fixture mode: skip upload/analyze (no backend), detection only. */
		offline?: boolean;
		onaccept: (next: BlueprintT) => void;
		onclose: () => void;
	}

	let { eventId, current, offline = false, onaccept, onclose }: Props = $props();

	type StepState = 'idle' | 'running' | 'done' | 'warn' | 'error';
	let phase = $state<'pick' | 'working' | 'review' | 'failed'>('pick');
	let upload = $state<StepState>('idle');
	let detect = $state<StepState>('idle');
	let analyze = $state<StepState>('idle');
	let detectStage = $state('');
	let detectPct = $state(0);
	let detectNote = $state('');
	let fatal = $state('');
	let warning = $state('');
	let run = $state.raw<DetectRun | null>(null);
	let draft = $state.raw<BlueprintT | null>(null);
	let dragOver = $state(false);
	let replaceWalls = $state(true);
	let replaceSegments = $state(true);
	let showCvRooms = $state(false);

	const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

	async function start(file: File) {
		if (!ACCEPT.split(',').includes(file.type)) {
			fatal = 'Use a PNG, JPEG, GIF or WebP image (export PDFs as an image first).';
			phase = 'failed';
			return;
		}
		phase = 'working';
		upload = offline ? 'warn' : 'running';
		detect = 'running';

		const uploadP: Promise<string | null> = offline
			? Promise.resolve(null)
			: blueprints.upload(eventId, file).then(
					(r) => r.imageRef,
					(e) => {
						upload = 'error';
						throw e;
					}
				);
		const detectP = detectFloorplan(file, (stage, pct) => {
			detectStage = stage;
			detectPct = pct;
		}).then((r) => {
			detect = r.error ? 'warn' : 'done';
			detectNote = r.geometry
				? `${r.geometry.walls.length} walls · ${r.geometry.rooms.length} rooms`
				: `${r.error}. Continuing without detection.`;
			return r;
		});

		let imageRef: string | null;
		try {
			[imageRef, run] = await Promise.all([uploadP, detectP]);
		} catch (e) {
			fatal = `Upload failed: ${errorMessage(e)}`;
			phase = 'failed';
			return;
		}
		const geometry = run.geometry;

		if (!imageRef) {
			analyze = 'warn';
			warning = 'Offline fixture mode: detection only, no underlay or AI labels.';
			draft = geometry ? localDraft(geometry, current.titleBlock) : null;
			finish();
			return;
		}

		// The numbered (Set-of-Marks) image is what the model sees; without it the server uses the original.
		let markedImageRef: string | undefined;
		if (run.marked && geometry?.rooms.length) {
			try {
				markedImageRef = (await blueprints.upload(eventId, run.marked)).imageRef;
			} catch {
				// non-fatal
			}
		}
		upload = 'done';

		analyze = 'running';
		try {
			const res = await blueprints.analyze(
				eventId,
				geometry
					? { imageRef, markedImageRef, crop: geometry.crop, canvas: geometry.canvas, rooms: geometry.rooms, walls: geometry.walls }
					: { imageRef }
			);
			analyze = res.source === 'ai' ? 'done' : 'warn';
			warning = res.source === 'fallback' ? (res.warning ?? 'AI labelling was unavailable; areas are unnamed.') : '';
			draft = fitDraft(res.blueprint, current.titleBlock);
		} catch (e) {
			analyze = 'warn';
			warning = `AI labelling failed (${errorMessage(e)}); detected rooms were added as unnamed areas.`;
			draft = geometry ? localDraft(geometry, current.titleBlock, imageRef) : null;
		}
		finish();
	}

	function finish() {
		if (!draft) {
			fatal = 'Nothing usable was detected in this image. Try a sharper image or draw the segments by hand.';
			phase = 'failed';
			return;
		}
		// Default: take everything; the toggles only matter when there's something to keep.
		replaceWalls = true;
		replaceSegments = true;
		phase = 'review';
	}

	function onFiles(files: FileList | null | undefined) {
		const f = files?.[0];
		if (f) start(f);
	}

	const hasCurrent = $derived({
		walls: current.walls.length > 0 || current.outlines.some((o) => !o.label),
		segments: current.segments.length > 0 || current.outlines.some((o) => o.label)
	});
	const result = $derived(draft ? applyDraft(current, draft, { walls: replaceWalls, segments: replaceSegments }) : null);
	const cvRooms = $derived(
		(run?.geometry?.rooms ?? []).map((r, i) => {
			const poly = roomPolygon(r);
			return { poly, n: i + ROOM_MARK_BASE, at: labelSpot(poly).at };
		})
	);

	const steps = $derived([
		{ label: 'Upload image', state: upload, note: offline ? 'skipped (offline)' : '' },
		{
			label: 'Detect walls & rooms',
			state: detect,
			note: detect === 'running' ? `${detectStage} · ${detectPct}%` : detectNote
		},
		{ label: 'Label areas (AI)', state: analyze, note: analyze === 'running' ? 'asking the model…' : '' }
	]);
</script>

<dialog class="modal" open aria-labelledby="import-title">
	<div class="modal-box flex max-h-[92vh] w-11/12 max-w-5xl flex-col gap-4 border border-bp-line/60">
		<div class="flex items-center gap-3">
			<h3 id="import-title" class="bp-label mr-auto text-lg font-semibold">Import floorplan</h3>
			<button class="btn btn-ghost btn-sm btn-square" onclick={onclose} aria-label="Close"><X size={16} /></button>
		</div>

		{#if phase === 'pick'}
			<label
				class={[
					'flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed px-6 py-16 text-center',
					dragOver ? 'border-bp-accent' : 'border-bp-line/50'
				]}
				ondragover={(e) => {
					e.preventDefault();
					dragOver = true;
				}}
				ondragleave={() => (dragOver = false)}
				ondrop={(e) => {
					e.preventDefault();
					dragOver = false;
					onFiles(e.dataTransfer?.files);
				}}
			>
				<ImageUp size={32} class="opacity-70" />
				<span class="bp-label text-xl">Drop a floorplan image or click to choose</span>
				<span class="font-mono text-xs opacity-60">PNG · JPEG · GIF · WEBP · ≤ 15 MB · phone photo, PDF screenshot or CAD export</span>
				<input type="file" accept={ACCEPT} class="hidden" onchange={(e) => onFiles(e.currentTarget.files)} />
			</label>
			<p class="text-sm opacity-60">
				The image becomes the underlay, cropped to the building. Walls and rooms are traced in your browser, then the AI
				names the rooms and splits open-plan space into work zones. You set the station counts afterwards.
			</p>
		{:else if phase === 'working' || phase === 'failed'}
			<ol class="flex flex-col gap-2">
				{#each steps as s (s.label)}
					<li class="flex items-center gap-3 border border-bp-line/30 px-3 py-2">
						<span class="w-5">
							{#if s.state === 'running'}<LoaderCircle size={16} class="animate-spin" />
							{:else if s.state === 'done'}<Check size={16} />
							{:else if s.state === 'warn' || s.state === 'error'}<TriangleAlert size={16} class="text-bp-accent" />
							{/if}
						</span>
						<span class={['bp-label', s.state === 'idle' && 'opacity-40']}>{s.label}</span>
						<span class="ml-auto font-mono text-xs opacity-60">{s.note}</span>
					</li>
				{/each}
			</ol>
			{#if detect === 'running'}
				<progress class="progress w-full" value={detectPct} max="100"></progress>
			{/if}
			{#if phase === 'failed'}
				<p class="border border-bp-accent/60 p-3 text-sm" role="alert">{fatal}</p>
				<div class="modal-action mt-0">
					<button class="btn btn-sm btn-ghost bp-label" onclick={onclose}>Close</button>
					<button class="btn btn-sm btn-outline bp-label" onclick={() => ((phase = 'pick'), (fatal = ''))}>Try another image</button>
				</div>
			{/if}
		{:else if phase === 'review' && draft && result}
			{#if warning}
				<p class="flex items-start gap-2 border border-bp-accent/60 p-3 text-sm" role="status">
					<TriangleAlert size={16} class="mt-0.5 shrink-0 text-bp-accent" />
					{warning}
				</p>
			{/if}
			<div class="min-h-0 flex-1 overflow-auto border border-bp-line/40" data-testid="import-preview">
				<Blueprint blueprint={result} showUnderlay showTitleBlock={false} class="w-full">
					{#snippet overlay(ctx)}
						{#if showCvRooms}
							{#each cvRooms as r (r.n)}
								<polygon
									points={pointsAttr(r.poly)}
									fill="none"
									stroke={ctx.accent}
									stroke-width={1.5 * ctx.u}
									stroke-dasharray="{6 * ctx.u} {4 * ctx.u}"
								/>
								<text
									x={r.at[0]}
									y={r.at[1]}
									font-family={FONT_MONO}
									font-size={14 * ctx.u}
									text-anchor="middle"
									dominant-baseline="central"
									fill={ctx.accent}>{r.n}</text
								>
							{/each}
						{/if}
					{/snippet}
				</Blueprint>
			</div>
			<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" class="toggle toggle-sm" bind:checked={replaceWalls} disabled={!hasCurrent.walls} />
					<span class="bp-label text-sm">Replace walls</span>
					<span class="font-mono text-xs opacity-60">{draft.walls.length}</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" class="toggle toggle-sm" bind:checked={replaceSegments} disabled={!hasCurrent.segments} />
					<span class="bp-label text-sm">Replace segments &amp; rooms</span>
					<span class="font-mono text-xs opacity-60">{draft.segments.length} + {draft.outlines.filter((o) => o.label).length}</span>
				</label>
				{#if cvRooms.length}
					<label class="flex cursor-pointer items-center gap-2">
						<input type="checkbox" class="toggle toggle-sm" bind:checked={showCvRooms} />
						<span class="bp-label text-sm">Show detected rooms</span>
					</label>
				{/if}
				<span class="ml-auto font-mono text-xs opacity-70">
					{result.walls.length} WALLS · {result.segments.length} SEGMENTS · {totalStations(result)} STATIONS · CANVAS {result.canvas.w}×{result.canvas.h}
				</span>
			</div>
			<div class="modal-action mt-0 flex-wrap">
				<span class="mr-auto self-center text-sm opacity-60">
					Station counts start at 0 and unconfirmed. Undo with Ctrl+Z after accepting.
				</span>
				<button class="btn btn-sm btn-ghost bp-label" onclick={onclose}>Discard</button>
				<button class="btn btn-sm btn-primary bp-label" onclick={() => onaccept(result)}>
					Accept draft
				</button>
			</div>
		{/if}
	</div>
	<button class="modal-backdrop" onclick={onclose} aria-label="Close dialog"></button>
</dialog>
