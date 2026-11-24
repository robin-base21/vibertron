<script lang="ts">
	import { formatDate, formatTime } from '$lib/format';

	let { data } = $props();

	const KIND: Record<string, string> = {
		confirm: 'Confirm email',
		resume: 'Signup link',
		done: 'You’re in',
		promoted: 'Seat opened',
		paid: 'Payment received',
		announce: 'Announcement',
		cancelled: 'Cancelled',
		organiser: 'To organisers'
	};
	const STATUS: Record<string, string> = {
		sent: 'pill',
		logged: 'tag',
		failed: 'tag bg-brand text-ink'
	};
	let open = $state<string | null>(null);
</script>

<svelte:head><title>Emails · Admin</title></svelte:head>

<section class="shell flex flex-col gap-6 pt-10">
	<div class="flex flex-col items-start gap-3">
		<span class="sticker">Admin</span>
		<h1 class="text-4xl font-semibold tracking-tight">Emails</h1>
		<p class="max-w-2xl text-sm text-ink/65">
			{#if data.configured}
				Sent through Resend from <span class="font-mono">{data.from}</span>. The latest 200 are
				listed here.
			{:else}
				<strong>RESEND_API_KEY isn’t set</strong>, so nothing is actually sent: emails are only
				logged here (“Logged”). Open one to use its links while testing.
			{/if}
		</p>
	</div>

	<div class="overflow-x-auto card">
		<table class="w-full text-left text-sm">
			<thead class="border-b-2 border-ink bg-cream">
				<tr>
					<th class="px-4 py-3">When</th>
					<th class="px-4 py-3">To</th>
					<th class="px-4 py-3">Email</th>
					<th class="px-4 py-3 text-right">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.emails as m (m.id)}
					<tr class="border-b border-dashed border-ink last:border-0">
						<td class="px-4 py-3 align-top whitespace-nowrap text-ink/70"
							>{formatDate(m.createdAt)}<br />{formatTime(m.createdAt)}</td
						>
						<td class="px-4 py-3 align-top">{m.to}</td>
						<td class="px-4 py-3 align-top">
							<button
								class="text-left font-semibold underline decoration-brand underline-offset-2"
								aria-expanded={open === m.id}
								onclick={() => (open = open === m.id ? null : m.id)}>{m.subject}</button
							>
							<span class="block text-xs text-ink/60"
								>{KIND[m.kind] ?? m.kind}{m.eventName ? ` · ${m.eventName}` : ''}</span
							>
							{#if m.error}<span class="block text-xs text-brand-deep">{m.error}</span>{/if}
							{#if open === m.id}
								<!-- Rendered sandboxed: no scripts, links open in a new tab. -->
								<iframe
									title="Preview of {m.subject}"
									class="mt-3 h-[34rem] w-full max-w-xl rounded-xl border-2 border-ink bg-white"
									sandbox="allow-popups allow-popups-to-escape-sandbox"
									srcdoc={m.html.replace('<head>', '<head><base target="_blank">')}
								></iframe>
							{/if}
						</td>
						<td class="px-4 py-3 text-right align-top">
							<span class={STATUS[m.status] ?? 'tag'}
								>{m.status === 'sent' ? 'Sent' : m.status === 'logged' ? 'Logged' : 'Failed'}</span
							>
						</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="px-4 py-8 text-center text-ink/60">No emails yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
