<script lang="ts">
	import { tick } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { totalStations, unconfirmedSegments, type Blueprint as BlueprintT } from 'common';
	import {
		ArrowLeft,
		Download,
		Eye,
		EyeOff,
		Grid3x3,
		ImageUp,
		MousePointer2,
		Pentagon,
		Printer,
		Redo2,
		Save,
		Square,
		Undo2
	} from '@lucide/svelte';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import ImportDialog from '$lib/floorplan/ImportDialog.svelte';
	import EditorCanvas from '$lib/blueprint/editor/EditorCanvas.svelte';
	import MarkupPanel from '$lib/blueprint/editor/MarkupPanel.svelte';
	import SegmentPanel from '$lib/blueprint/editor/SegmentPanel.svelte';
	import { Editor, type Tool } from '$lib/blueprint/editor/editor.svelte';
	import { saveBlueprint } from '$lib/blueprint/api';
	import { downloadText, svgToString } from '$lib/blueprint/exportSvg';
	import { blueprints } from '$lib/api';
	import { handleError, toasts } from '$lib/stores/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The editor owns the document after load; `data` only seeds it.
	// svelte-ignore state_referenced_locally
	const editor = new Editor(structuredClone(data.blueprint));
	// svelte-ignore state_referenced_locally
	let version = $state(data.version);
	// svelte-ignore state_referenced_locally
	let savedJson = $state(JSON.stringify(data.blueprint));
	let saving = $state(false);
	let conflict = $state(false);
	let tab = $state<'segment' | 'markup' | 'sheet'>('segment');
	let showUnderlay = $state(true);
	let invert = $state(false);
	let canvas = $state<ReturnType<typeof EditorCanvas>>();
	let exporting = $state(false);
	let exportSvg = $state<SVGSVGElement>();
	let importing = $state(false);

	function acceptDraft(draft: BlueprintT) {
		editor.apply(draft);
		editor.selectedId = null;
		showUnderlay = true;
		importing = false;
		toasts.success(`Draft applied: ${draft.segments.length} segments. Review names and confirm counts.`);
	}

	const dirty = $derived(JSON.stringify(editor.bp) !== savedJson);
	const unconfirmed = $derived(unconfirmedSegments(editor.bp));

	const tools: { id: Tool; label: string; key: string; icon: typeof Square }[] = [
		{ id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
		{ id: 'rect', label: 'Rect', key: 'R', icon: Square },
		{ id: 'polygon', label: 'Polygon', key: 'P', icon: Pentagon }
	];

	async function save() {
		if (saving) return;
		if (data.fixture) {
			toasts.push('Fixture mode: nothing is saved');
			savedJson = JSON.stringify(editor.bp);
			return;
		}
		saving = true;
		try {
			const r = await saveBlueprint(data.eventId, editor.bp, version);
			if (r.ok) {
				version = r.version;
				savedJson = JSON.stringify(editor.bp);
				toasts.success(`Saved rev ${editor.bp.titleBlock.rev} · v${r.version}`);
			} else {
				conflict = true;
			}
		} catch (e) {
			handleError(e);
		} finally {
			saving = false;
		}
	}

	async function reloadFromServer() {
		conflict = false;
		try {
			const r = await blueprints.get(data.eventId);
			if (r.blueprint) {
				editor.reset(r.blueprint);
				savedJson = JSON.stringify(r.blueprint);
			}
			version = r.version;
			toasts.push('Reloaded the latest saved blueprint');
		} catch (e) {
			handleError(e);
		}
	}

	async function exportFile() {
		exporting = true;
		await tick();
		if (exportSvg) {
			const name = editor.bp.titleBlock.project.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'blueprint';
			downloadText(`${name}-rev-${editor.bp.titleBlock.rev}${invert ? '-print' : ''}.svg`, svgToString(exportSvg));
		}
		exporting = false;
	}

	function setTool(t: Tool) {
		canvas?.cancelDrawing();
		editor.tool = t;
	}

	function isTyping(t: EventTarget | null) {
		return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
	}

	function onKeydown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 's') {
			e.preventDefault();
			save();
			return;
		}
		if (isTyping(e.target)) return;
		const k = e.key.toLowerCase();
		if (mod && k === 'z') {
			e.preventDefault();
			if (e.shiftKey) editor.redo();
			else editor.undo();
		} else if (mod && k === 'y') {
			e.preventDefault();
			editor.redo();
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selectedId) {
			e.preventDefault();
			editor.deleteSegment(editor.selectedId);
		} else if (e.key === 'Escape') {
			if (!canvas?.cancelDrawing()) editor.selectedId = null;
		} else if (e.key === 'Enter' && editor.selectedId) {
			canvas?.startRename();
		} else if (!mod && (k === 'v' || k === 'r' || k === 'p')) {
			setTool(k === 'v' ? 'select' : k === 'r' ? 'rect' : 'polygon');
		} else if (e.key.startsWith('Arrow') && editor.selectedId) {
			e.preventDefault();
			const step = e.shiftKey ? 50 : 10;
			const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
			const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
			editor.updateSegment(
				editor.selectedId,
				(s) => ({
					...s,
					points: s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]),
					labelPos: [s.labelPos[0] + dx, s.labelPos[1] + dy]
				}),
				`nudge:${editor.selectedId}`
			);
		}
	}

	function onBeforeUnload(e: BeforeUnloadEvent) {
		if (dirty) e.preventDefault();
	}

	beforeNavigate((nav) => {
		if (dirty && nav.type !== 'leave' && !confirm('Discard unsaved blueprint changes?')) nav.cancel();
	});
</script>

<svelte:window onkeydown={onKeydown} onbeforeunload={onBeforeUnload} />

<svelte:head>
	<title>Blueprint · {data.eventName}</title>
</svelte:head>

<div class="mx-auto flex max-w-[1600px] flex-col gap-3 p-3 lg:p-4">
	<header class="flex flex-wrap items-center gap-3">
		<a href="/manage/{data.eventId}" class="btn btn-ghost btn-sm btn-square" aria-label="Back to event">
			<ArrowLeft size={16} />
		</a>
		<div class="mr-auto flex flex-col">
			<span class="bp-label text-xs opacity-60">Blueprint</span>
			<h1 class="bp-label text-2xl leading-none font-semibold">{data.eventName}</h1>
		</div>
		<span class="font-mono text-xs opacity-60">
			{editor.bp.segments.length} SEG · {totalStations(editor.bp)} ST · V{version}{dirty ? ' · UNSAVED' : ''}
		</span>
		<button class="btn btn-sm btn-primary bp-label" onclick={save} disabled={saving || (!dirty && !data.fixture)}>
			<Save size={14} />
			{saving ? 'Saving…' : 'Save'}
		</button>
	</header>

	<div class="flex flex-wrap items-center gap-2 border border-bp-line/40 p-2" role="toolbar" aria-label="Editor tools">
		<div class="join">
			{#each tools as t (t.id)}
				<button
					class={['btn btn-sm join-item bp-label', editor.tool === t.id ? 'btn-primary' : 'btn-ghost']}
					onclick={() => setTool(t.id)}
					title="{t.label} ({t.key})"
				>
					<t.icon size={14} />
					<span class="hidden sm:inline">{t.label}</span>
				</button>
			{/each}
		</div>
		<div class="join">
			<button class="btn btn-sm btn-ghost join-item" onclick={() => editor.undo()} disabled={!editor.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
				<Undo2 size={14} />
			</button>
			<button class="btn btn-sm btn-ghost join-item" onclick={() => editor.redo()} disabled={!editor.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
				<Redo2 size={14} />
			</button>
		</div>
		<button
			class={['btn btn-sm bp-label', editor.snap ? 'btn-outline' : 'btn-ghost opacity-60']}
			onclick={() => (editor.snap = !editor.snap)}
			title="Snap to the 10-unit grid (hold Alt to bypass)"
		>
			<Grid3x3 size={14} /> Snap
		</button>
		{#if editor.bp.underlay}
			<div class="flex items-center gap-2 border border-bp-line/30 px-2 py-1">
				<button class="btn btn-ghost btn-xs btn-square" onclick={() => (showUnderlay = !showUnderlay)} aria-label="Toggle underlay" title="Toggle underlay">
					{#if showUnderlay}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
				</button>
				<span class="bp-label text-xs opacity-60">Underlay</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					class="range range-xs w-24"
					value={editor.bp.underlay.opacity}
					disabled={!showUnderlay}
					oninput={(e) => editor.setUnderlayOpacity(e.currentTarget.valueAsNumber)}
					aria-label="Underlay opacity"
				/>
				<span class="w-8 font-mono text-xs">{Math.round(editor.bp.underlay.opacity * 100)}%</span>
			</div>
		{/if}
		<div class="ml-auto flex flex-wrap gap-2">
			<button class="btn btn-sm btn-outline bp-label" onclick={() => (importing = true)} title="Import floorplan">
				<ImageUp size={14} /> Import floorplan
			</button>
			<button class={['btn btn-sm bp-label', invert ? 'btn-primary' : 'btn-ghost']} onclick={() => (invert = !invert)} title="Invert for print">
				<Printer size={14} /> Invert
			</button>
			<button class="btn btn-sm btn-ghost bp-label" onclick={exportFile} title="Download as SVG">
				<Download size={14} /> SVG
			</button>
		</div>
	</div>

	{#if unconfirmed.length}
		<div class="flex flex-wrap items-center gap-3 border border-bp-accent/70 px-3 py-2" role="status">
			<span class="bp-label text-sm font-semibold text-bp-accent">Launch is blocked until counts are confirmed</span>
			<span class="flex flex-wrap gap-1">
				{#each unconfirmed as s (s.id)}
					<button
						class="bp-label border border-bp-line/40 px-2 text-xs hover:border-bp-accent"
						onclick={() => {
							editor.selectedId = s.id;
							tab = 'segment';
						}}>{s.name} · <span class="font-mono">{s.stations.count}</span></button
					>
				{/each}
			</span>
			<button class="btn btn-xs btn-outline bp-label ml-auto" onclick={() => editor.confirmAll()}>Confirm all</button>
		</div>
	{/if}

	<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
		<div class="border border-bp-line/40 lg:h-[calc(100vh-15rem)] lg:min-h-[480px]">
			<EditorCanvas bind:this={canvas} {editor} {showUnderlay} {invert} class="h-full w-full" />
		</div>

		<aside class="flex flex-col gap-3 border border-bp-line/40 p-3">
			<div role="tablist" class="tabs tabs-border">
				<button role="tab" class={['tab bp-label', tab === 'segment' && 'tab-active']} onclick={() => (tab = 'segment')}>Segment</button>
				<button role="tab" class={['tab bp-label', tab === 'markup' && 'tab-active']} onclick={() => (tab = 'markup')}>Markup</button>
				<button role="tab" class={['tab bp-label', tab === 'sheet' && 'tab-active']} onclick={() => (tab = 'sheet')}>Sheet</button>
			</div>
			{#if tab === 'segment'}
				<SegmentPanel {editor} />
			{:else if tab === 'markup'}
				<MarkupPanel {editor} />
			{:else}
				<div class="flex flex-col gap-3">
					<label class="flex flex-col gap-1">
						<span class="bp-label text-xs opacity-60">Project</span>
						<input class="input input-sm bp-label w-full bg-transparent" value={editor.bp.titleBlock.project} oninput={(e) => editor.setTitle({ project: e.currentTarget.value })} />
					</label>
					<div class="grid grid-cols-2 gap-2">
						<label class="flex flex-col gap-1">
							<span class="bp-label text-xs opacity-60">Date</span>
							<input class="input input-sm w-full bg-transparent font-mono" value={editor.bp.titleBlock.date} oninput={(e) => editor.setTitle({ date: e.currentTarget.value })} />
						</label>
						<label class="flex flex-col gap-1">
							<span class="bp-label text-xs opacity-60">Rev</span>
							<input class="input input-sm w-full bg-transparent font-mono" maxlength="4" value={editor.bp.titleBlock.rev} oninput={(e) => editor.setTitle({ rev: e.currentTarget.value.replace(/\s/g, '') || 'A' })} />
						</label>
					</div>
					<p class="font-mono text-xs opacity-60">CANVAS {editor.bp.canvas.w}×{editor.bp.canvas.h} · {editor.bp.outlines.length} OUTLINES</p>
				</div>
			{/if}
		</aside>
	</div>
</div>

{#if exporting}
	<div class="pointer-events-none fixed top-0 -left-[9999px] w-[1600px]" aria-hidden="true">
		<Blueprint blueprint={editor.bp} {invert} bind:svg={exportSvg} />
	</div>
{/if}

{#if importing}
	<ImportDialog
		eventId={data.eventId}
		current={editor.bp}
		offline={data.fixture}
		onaccept={acceptDraft}
		onclose={() => (importing = false)}
	/>
{/if}

{#if conflict}
	<dialog class="modal" open>
		<div class="modal-box border border-bp-line/60">
			<h3 class="bp-label text-lg font-semibold">Blueprint changed elsewhere</h3>
			<p class="py-3 text-sm opacity-80">
				Someone saved a newer version while you were editing. Reload it (your unsaved changes are discarded) or keep
				editing and export your work first.
			</p>
			<div class="modal-action">
				<button class="btn btn-sm btn-ghost bp-label" onclick={() => (conflict = false)}>Keep editing</button>
				<button class="btn btn-sm btn-primary bp-label" onclick={reloadFromServer}>Reload latest</button>
			</div>
		</div>
	</dialog>
{/if}
