<script lang="ts">
	import type { Blueprint, TeamDTO } from 'common';
	import type { Component } from 'svelte';

	interface Props {
		blueprint: Blueprint | null;
		teams?: TeamDTO[];
		highlightStationId?: string;
		highlightSegmentId?: string;
		class?: string;
	}

	let { blueprint, class: klass = '', ...rest }: Props = $props();

	// TODO(blueprint): the renderer is delivered by the blueprint worker. The glob resolves to
	// nothing until `$lib/blueprint/Blueprint.svelte` exists, so this shows a placeholder box.
	const modules = import.meta.glob<{ default: Component<Omit<Props, 'blueprint'> & { blueprint: Blueprint }> }>(
		'/src/lib/blueprint/Blueprint.svelte'
	);
	const load = Object.values(modules)[0];
</script>

{#if blueprint && load}
	{#await load() then { default: Renderer }}
		<Renderer {blueprint} class={klass} {...rest} />
	{/await}
{:else}
	<div
		class={[
			'flex aspect-square w-full items-center justify-center border border-dashed border-bp-line/40',
			klass
		]}
	>
		<span class="bp-label text-sm opacity-50">
			{blueprint ? 'Blueprint' : 'No blueprint yet'}
			{#if rest.highlightStationId}
				· <span class="font-mono">{rest.highlightStationId}</span>
			{/if}
		</span>
	</div>
{/if}
