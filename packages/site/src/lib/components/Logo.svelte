<script lang="ts">
	/** `light`: white lettering for dark backgrounds (the footer). */
	let { class: className = 'h-9', light = false }: { class?: string; light?: boolean } = $props();
</script>

<img
	src={light
		? '/brand/ourbusan-vibe-wordmark-white-orange.svg'
		: '/brand/ourbusan-vibe-wordmark-black-orange.svg'}
	alt="OurBusan.vibe"
	class={['w-auto', className]}
	width="1104"
	height="306"
/>
