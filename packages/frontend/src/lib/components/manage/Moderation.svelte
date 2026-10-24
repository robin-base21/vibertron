<script lang="ts">
	import { launch } from '$lib/api';
	import { handleError } from '$lib/stores/toast.svelte';
	import type { MessageDTO } from 'common';
	import { Eye, EyeOff } from '@lucide/svelte';

	let { messages, onupdate }: { messages: MessageDTO[]; onupdate: (m: MessageDTO) => void } =
		$props();

	let pending = $state<string | null>(null);

	const newestFirst = $derived([...messages].sort((a, b) => b.createdAt - a.createdAt));

	async function toggle(m: MessageDTO) {
		pending = m.id;
		try {
			const { message } = await launch.moderate(m.id, { hidden: !m.hidden });
			onupdate(message);
		} catch (err) {
			handleError(err);
		} finally {
			pending = null;
		}
	}
</script>

<section class="flex flex-col gap-3">
	<div class="flex items-baseline justify-between">
		<h2 class="bp-label text-xl">Messages</h2>
		<span class="font-mono text-xs opacity-60">
			{messages.length} · {messages.filter((m) => m.hidden).length} hidden
		</span>
	</div>
	{#if newestFirst.length === 0}
		<div class="border border-dashed border-bp-line/40 p-6 text-center">
			<p class="bp-label text-sm opacity-60">No messages yet</p>
		</div>
	{:else}
		<ul
			class="flex max-h-[32rem] flex-col divide-y divide-bp-line/20 overflow-y-auto border border-bp-line/40"
		>
			{#each newestFirst as m (m.id)}
				<li class={['flex items-start gap-3 px-3 py-2', m.hidden && 'opacity-40']}>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<div class="flex items-baseline gap-2">
							<span class="bp-label text-sm">{m.codename}</span>
							<span class="truncate font-mono text-xs opacity-60">{m.authorName}</span>
							<span class="ml-auto shrink-0 font-mono text-xs opacity-50">
								{new Date(m.createdAt).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit'
								})}
							</span>
						</div>
						<p class={['text-sm break-words', m.hidden && 'line-through']}>{m.body}</p>
					</div>
					<button
						class="btn shrink-0 btn-ghost bp-label btn-xs"
						disabled={pending === m.id}
						onclick={() => toggle(m)}
						title={m.hidden ? 'Unhide' : 'Hide'}
					>
						{#if m.hidden}<Eye size={14} /> Unhide{:else}<EyeOff size={14} /> Hide{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
