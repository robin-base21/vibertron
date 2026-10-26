<script lang="ts">
	import type { Confirmation } from './lifecycle';

	interface Props {
		confirmation: Confirmation;
		busy?: boolean;
		onconfirm: () => void;
		onclose: () => void;
	}

	let { confirmation, busy = false, onconfirm, onclose }: Props = $props();
</script>

<dialog class="modal" open aria-labelledby="confirm-title">
	<div class="modal-box flex flex-col gap-4 border border-bp-line/60">
		<h3 id="confirm-title" class="bp-label text-lg font-semibold">{confirmation.title}</h3>
		<ul class="flex flex-col gap-2 text-sm">
			{#each confirmation.points as point (point)}
				<li class="flex gap-2">
					<span class="font-mono opacity-50">—</span>
					<span class="opacity-85">{point}</span>
				</li>
			{/each}
		</ul>
		<div class="modal-action mt-0">
			<button class="btn btn-ghost bp-label btn-sm" onclick={onclose} disabled={busy}>Cancel</button>
			<button
				class={['btn bp-label btn-sm', confirmation.danger ? 'btn-error' : 'btn-primary']}
				onclick={onconfirm}
				disabled={busy}
			>
				{confirmation.confirmLabel}
			</button>
		</div>
	</div>
	<button class="modal-backdrop" onclick={onclose} aria-label="Close dialog"></button>
</dialog>
