<script lang="ts">
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api';
	import { session } from '$lib/stores/session.svelte';
	import { errorMessage } from '$lib/stores/toast.svelte';

	let { data } = $props();

	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let error: string | null = $state(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			await session.login(email.trim(), password);
			await goto(data.next ?? (session.is('manager') ? '/manage' : '/'), { replaceState: true });
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 401
					? 'Wrong email or password'
					: errorMessage(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Sign in · Vibertron</title></svelte:head>

<main class="mx-auto flex max-w-sm flex-col gap-6 px-4 py-16">
	<div>
		<p class="bp-label text-sm opacity-60">Organisers</p>
		<h1 class="bp-label text-4xl font-semibold">Sign in</h1>
	</div>
	<form class="flex flex-col gap-4 border border-bp-line/40 p-5" onsubmit={submit}>
		<label class="flex flex-col gap-1">
			<span class="bp-label text-xs opacity-70">Email</span>
			<input
				class="input w-full font-mono"
				type="email"
				autocomplete="username"
				required
				bind:value={email}
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="bp-label text-xs opacity-70">Password</span>
			<input
				class="input w-full font-mono"
				type="password"
				autocomplete="current-password"
				required
				bind:value={password}
			/>
		</label>
		{#if error}
			<p class="font-mono text-xs text-error" role="alert">{error}</p>
		{/if}
		<button class="btn bp-label btn-primary" disabled={busy}>
			{busy ? 'Signing in…' : 'Sign in'}
		</button>
	</form>
	<p class="font-mono text-xs opacity-50">
		Attendees don’t need an account: scan the venue QR code.
	</p>
</main>
