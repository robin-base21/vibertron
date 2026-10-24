<script lang="ts">
	import { parseMarkup, serializeMarkup, type MarkupError } from 'common';
	import type { Editor } from './editor.svelte';

	let { editor }: { editor: Editor } = $props();

	// `synced` is the serialization of the blueprint the text last agreed with. When the
	// blueprint changes elsewhere (canvas, undo) the text is regenerated; while the text has
	// parse errors it is left alone so nothing the manager typed is lost.
	let text = $state('');
	let synced = '';
	let errors = $state<MarkupError[]>([]);

	// Syncing local, user-editable text from external state; a $derived can't keep unparsed text.
	$effect(() => {
		const ser = serializeMarkup(editor.bp);
		if (ser !== synced) {
			text = ser;
			synced = ser;
			errors = [];
		}
	});

	function onInput(value: string) {
		text = value;
		const r = parseMarkup(value, editor.bp);
		if (r.ok) {
			errors = [];
			synced = serializeMarkup(r.blueprint);
			if (synced !== serializeMarkup(editor.bp)) editor.apply(r.blueprint, 'markup');
		} else {
			errors = r.errors;
		}
	}

	const lines = $derived(text.split('\n'));
	const errorLines = $derived(new Set(errors.map((e) => e.line)));
</script>

<div class="flex h-full flex-col gap-2">
	<div class="relative flex max-h-[60vh] min-h-64 flex-1 overflow-y-auto border border-bp-line/40 font-mono text-xs leading-5">
		<div class="pointer-events-none py-2 pr-2 pl-2 text-right opacity-40 select-none" aria-hidden="true">
			{#each lines as _, i (i)}
				<div class={errorLines.has(i + 1) ? 'text-bp-accent opacity-100' : ''}>{i + 1}</div>
			{/each}
		</div>
		<textarea
			class="flex-1 resize-none overflow-x-auto overflow-y-hidden bg-transparent py-2 pr-2 leading-5 whitespace-pre outline-none"
			wrap="off"
			rows={lines.length + 1}
			spellcheck="false"
			aria-label="Blueprint markup"
			value={text}
			oninput={(e) => onInput(e.currentTarget.value)}
			onkeydown={(e) => e.stopPropagation()}
		></textarea>
	</div>
	{#if errors.length}
		<ul class="flex flex-col gap-1 border border-bp-accent/60 p-2 font-mono text-xs" role="alert">
			{#each errors as err, i (i)}
				<li><span class="text-bp-accent">L{err.line || '?'}</span> {err.message}</li>
			{/each}
			<li class="opacity-50">Not applied until it parses. Your text is kept.</li>
		</ul>
	{:else}
		<p class="font-mono text-[10px] opacity-40">
			title "Name" date YYYY-MM-DD rev A · segment "Hall" rect x,y WxH stations N grid|row [unconfirmed]
		</p>
	{/if}
</div>
