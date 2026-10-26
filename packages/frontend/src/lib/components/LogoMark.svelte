<script lang="ts">
	interface Props {
		class?: string;
	}

	let { class: className = 'size-6' }: Props = $props();
</script>

<!-- Two drafting lines crossing into a V, with a station square at the crossing. Same geometry as static/favicon.svg, without the tile. -->
<svg viewBox="10 9 44 48" class={className} aria-hidden="true">
	<g stroke="currentColor" stroke-width="5.5" stroke-linecap="square" fill="none">
		<path d="M14.5 12 35.5 54" />
		<path d="M49.5 12 28.5 54" />
	</g>
	<rect x="27.5" y="42.5" width="9" height="9" class="fill-bp-accent stroke-base-100" stroke-width="2.4" />
</svg>
