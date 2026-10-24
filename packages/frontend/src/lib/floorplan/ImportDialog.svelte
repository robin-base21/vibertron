<script lang="ts">
	import { totalStations, type Blueprint as BlueprintT } from 'common';
	import { Check, ImageUp, LoaderCircle, TriangleAlert, X } from '@lucide/svelte';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import { blueprints } from '$lib/api';
	import { errorMessage } from '$lib/stores/toast.svelte';
	import { detectContours, type ContourRun } from './contours';
	import { fitDraft, localDraft } from './draft';

	interface Props {
		eventId: string;
		current: BlueprintT;
		/** Dev fixture mode: skip upload/analyze (no backend), contours only. */
		offline?: boolean;
		onaccept: (draft: BlueprintT) => void;
		onclose: () => void;
	}

	let { eventId, current, offline = false, onaccept, onclose }: Props = $props();

	type StepState = 'idle' | 'running' | 'done' | 'warn' | 'error';
	let phase = $state<'pick' | 'working' | 'review' | 'failed'>('pick');
	let upload = $state<StepState>('idle');
	let contours = $state<StepState>('idle');
	let analyze = $state<StepState>('idle');
	let contourStage = $state('');
	let contourPct = $state(0);
	let contourNote = $state('');
	let fatal = $state('');
	let warning = $state('');
	let draft = $state.raw<BlueprintT | null>(null);
	let dragOver = $state(false);

	const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

	async function start(file: File) {
		if (!ACCEPT.split(',').includes(file.type)) {
			fatal = 'Use a PNG, JPEG, GIF or WebP image (export PDFs as an image first).';
			phase = 'failed';
			return;
		}
		phase = 'working';
		upload = offline ? 'warn' : 'running';
		contours = 'running';

		const uploadP: Promise<string | null> = offline
			? Promise.resolve(null)
			: blueprints.upload(eventId, file).then(
					(r) => ((upload = 'done'), r.imageRef),
					(e) => {
						upload = 'error';
						throw e;
					}
				);
		const contourP = detectContours(file, (stage, pct) => {
			contourStage = stage;
			contourPct = pct;
		}).then((r) => {
			contours = r.error ? 'warn' : 'done';
			contourNote = r.error
				? `${r.error}. Continuing without contours.`
				: `${r.candidates.length} room candidates · ${r.outlines.length} outlines`;
			return r;
		});

		let imageRef: string | null;
		let run: ContourRun;
		try {
			[imageRef, run] = await Promise.all([uploadP, contourP]);
		} catch (e) {
			fatal = `Upload failed: ${errorMessage(e)}`;
			phase = 'failed';
			return;
		}

		if (!imageRef) {
			analyze = 'warn';
			warning = 'Offline fixture mode: contours only, no underlay or AI labels.';
			draft = localDraft(run, current.titleBlock);
			phase = 'review';
			return;
		}

		analyze = 'running';
		try {
			const res = await blueprints.analyze(eventId, {
				imageRef,
				candidates: run.candidates,
				outlines: run.outlines
			});
			analyze = res.source === 'ai' ? 'done' : 'warn';
			warning = res.source === 'fallback' ? (res.warning ?? 'AI labelling was unavailable; areas are unnamed.') : '';
			draft = fitDraft(res.blueprint, run.canvas, current.titleBlock);
		} catch (e) {
			analyze = 'warn';
			warning = `AI labelling failed (${errorMessage(e)}); candidate polygons were added as unnamed areas.`;
			draft = localDraft(run, current.titleBlock, imageRef);
		}
		phase = 'review';
	}

	function onFiles(files: FileList | null | undefined) {
		const f = files?.[0];
		if (f) start(f);
	}

	const steps = $derived([
		{ label: 'Upload image', state: upload, note: offline ? 'skipped (offline)' : '' },
		{
			label: 'Detect walls & rooms',
			state: contours,
			note: contours === 'running' ? `${contourStage} · ${contourPct}%` : contourNote
		},
		{ label: 'Label areas (AI)', state: analyze, note: analyze === 'running' ? 'asking the model…' : '' }
	]);
</script>

<dialog class="modal" open aria-labelledby="import-title">
	<div class="modal-box flex max-h-[92vh] w-11/12 max-w-4xl flex-col gap-4 border border-bp-line/60">
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
				The image becomes the underlay. Walls and rooms are traced in your browser, then the AI names the work areas and
				suggests station counts. You review and confirm everything afterwards.
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
			{#if contours === 'running'}
				<progress class="progress w-full" value={contourPct} max="100"></progress>
			{/if}
			{#if phase === 'failed'}
				<p class="border border-bp-accent/60 p-3 text-sm" role="alert">{fatal}</p>
				<div class="modal-action mt-0">
					<button class="btn btn-sm btn-ghost bp-label" onclick={onclose}>Close</button>
					<button class="btn btn-sm btn-outline bp-label" onclick={() => ((phase = 'pick'), (fatal = ''))}>Try another image</button>
				</div>
			{/if}
		{:else if phase === 'review' && draft}
			{#if warning}
				<p class="flex items-start gap-2 border border-bp-accent/60 p-3 text-sm" role="status">
					<TriangleAlert size={16} class="mt-0.5 shrink-0 text-bp-accent" />
					{warning}
				</p>
			{/if}
			<div class="min-h-0 flex-1 overflow-auto border border-bp-line/40">
				<Blueprint blueprint={draft} showUnderlay class="w-full" />
			</div>
			<p class="font-mono text-xs opacity-70">
				{draft.segments.length} SEGMENTS · {totalStations(draft)} STATIONS · {draft.outlines.length} OUTLINES · CANVAS {draft.canvas.w}×{draft.canvas.h}
			</p>
			<div class="modal-action mt-0 flex-wrap">
				<span class="mr-auto self-center text-sm opacity-60">Accepting replaces the current segments (undo with Ctrl+Z).</span>
				<button class="btn btn-sm btn-ghost bp-label" onclick={onclose}>Discard</button>
				<button class="btn btn-sm btn-primary bp-label" onclick={() => draft && onaccept(draft)}>Accept draft</button>
			</div>
		{/if}
	</div>
	<button class="modal-backdrop" onclick={onclose} aria-label="Close dialog"></button>
</dialog>
