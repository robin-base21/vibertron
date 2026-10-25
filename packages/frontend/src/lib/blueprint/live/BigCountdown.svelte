<script lang="ts">
	import { clock } from '$lib/stores/clock.svelte';
	import { hms } from '../live.svelte';

	let { endsAt, class: className = '' }: { endsAt: number | null; class?: string } = $props();

	const remaining = $derived(endsAt === null ? null : endsAt - clock.now);
	// Final ten minutes: digits switch to the accent and pulse gently.
	const final = $derived(remaining !== null && remaining > 0 && remaining <= 10 * 60_000);
</script>

<time
	class={[
		'block font-mono leading-none font-medium tabular-nums',
		final && 'final text-bp-accent',
		className
	]}
	aria-live="off"
	aria-label="Time remaining">{remaining === null ? '--:--:--' : hms(remaining)}</time
>

<style>
	.final {
		animation: pulse 2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.final {
			animation: none;
		}
	}
</style>
