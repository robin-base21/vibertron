<script lang="ts">
	import { ExternalLink, MapPin } from '@lucide/svelte';

	interface Props {
		venue: string;
		/** Map link; when set the venue opens it in a new tab. */
		url?: string | null;
		class?: string;
		/** Show the pin icon in front. */
		icon?: boolean;
	}

	let { venue, url = null, class: className = '', icon = true }: Props = $props();
</script>

{#if url}
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class={[
			'inline-flex items-center gap-1.5 underline decoration-1 underline-offset-2 hover:decoration-2',
			className
		]}
		title="Open the location in a new tab"
	>
		{#if icon}<MapPin size={14} class="shrink-0" />{/if}{venue}<ExternalLink
			size={12}
			class="shrink-0 opacity-60"
		/>
	</a>
{:else}
	<span class={['inline-flex items-center gap-1.5', className]}>
		{#if icon}<MapPin size={14} class="shrink-0" />{/if}{venue}
	</span>
{/if}
