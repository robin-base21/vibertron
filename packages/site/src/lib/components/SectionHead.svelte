<script lang="ts">
	let {
		label,
		title,
		href,
		linkText,
		id
	}: { label: string; title: string; href?: string; linkText?: string; id?: string } = $props();
</script>

<div class="mb-8 flex items-end justify-between gap-4" {id}>
	<div class="flex flex-col items-start gap-3">
		<span class="sticker">{label}</span>
		<h2 class="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h2>
	</div>
	{#if href}
		<a
			{href}
			class="shrink-0 border-b-2 border-brand pb-2 text-sm font-medium hover:text-brand-deep"
			>{linkText ?? 'See all'} →</a
		>
	{/if}
</div>
