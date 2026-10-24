<script lang="ts">
	import { toasts } from '$lib/stores/toast.svelte';
	import { X } from '@lucide/svelte';
</script>

<div class="toast toast-end toast-bottom z-50" aria-live="polite">
	{#each toasts.items as t (t.id)}
		<div
			class={[
				'flex max-w-sm items-start gap-3 border bg-base-100 px-4 py-3 font-mono text-xs',
				t.kind === 'error' ? 'border-error text-error' : 'border-bp-line/60'
			]}
			role={t.kind === 'error' ? 'alert' : 'status'}
		>
			<span class="shrink-0 bp-label text-[0.7rem] opacity-70">
				{t.kind === 'error' ? 'ERR' : t.kind === 'success' ? 'OK' : 'INFO'}
			</span>
			<span class="flex-1 break-words whitespace-normal">{t.message}</span>
			<button
				class="opacity-60 hover:opacity-100"
				onclick={() => toasts.dismiss(t.id)}
				aria-label="Dismiss"
			>
				<X size={14} />
			</button>
		</div>
	{/each}
</div>
