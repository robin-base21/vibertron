<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Toasts from '$lib/components/Toasts.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { handleError } from '$lib/stores/toast.svelte';
	import { wsStore } from '$lib/stores/websocket.svelte';

	let { children } = $props();

	// Full-screen venue displays render without the top bar.
	const bareRoutes: string[] = ['/manage/[id]/qr/[inviteId]', '/e/[slug]/tv'];
	const bare = $derived(bareRoutes.includes(page.route.id ?? ''));
	const firstEvent = $derived(session.me.participations[0]);

	onMount(() => {
		wsStore.connect();
		return () => wsStore.disconnect();
	});

	async function signOut() {
		try {
			await session.logout();
			await goto('/');
		} catch (err) {
			handleError(err);
		}
	}

	const navLink = 'bp-label px-2 py-1 text-sm opacity-70 hover:opacity-100';
	const active = (prefix: string) => page.url.pathname.startsWith(prefix);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Vibertron</title>
</svelte:head>

<div class="flex min-h-screen flex-col">
	{#if !bare}
		<header class="border-b border-bp-line/40">
			<nav class="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
				<a href="/" class="bp-label mr-auto text-xl font-semibold tracking-[0.2em]">Vibertron</a>
				{#if session.is('admin')}
					<a href="/admin" class={[navLink, active('/admin') && 'underline underline-offset-4 opacity-100']}>
						Admin
					</a>
				{/if}
				{#if session.is('manager')}
					<a href="/manage" class={[navLink, active('/manage') && 'underline underline-offset-4 opacity-100']}>
						Events
					</a>
				{:else if firstEvent}
					<a href="/e/{firstEvent.slug}" class={[navLink, active('/e/') && 'underline underline-offset-4 opacity-100']}>
						My event
					</a>
				{/if}
				{#if session.user}
					<!-- Attendee sessions are name-only and can't be recovered, so no sign out for them. -->
					<span class="hidden font-mono text-xs opacity-50 sm:inline">{session.user.displayName}</span>
					{#if session.is('manager')}
						<button class="btn btn-outline btn-xs bp-label" onclick={signOut}>Sign out</button>
					{/if}
				{:else if page.url.pathname !== '/login'}
					<a href="/login" class="btn btn-outline btn-xs bp-label">Sign in</a>
				{/if}
			</nav>
		</header>
	{/if}
	<div class="flex-1">
		{@render children()}
	</div>
</div>

<Toasts />
