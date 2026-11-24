<script lang="ts">
	import '../app.css';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Menu, X } from '@lucide/svelte';
	import Logo from '$lib/components/Logo.svelte';
	import NewsletterForm from '$lib/components/NewsletterForm.svelte';

	let { children, data } = $props();

	const admin = $derived(page.url.pathname.startsWith('/admin'));
	/** Keep the signup steps focused: no newsletter box competing with the form. */
	const inSignup = $derived(page.url.pathname.endsWith('/signup') || page.url.pathname === '/next');
	const nav = [
		{ href: '/events', label: 'Events' },
		{ href: '/showcase', label: 'Showcase' },
		{ href: '/about', label: 'About' }
	];
	const active = (href: string) => page.url.pathname.startsWith(href);

	const adminNav = [
		{ href: '/admin', label: 'Events' },
		{ href: '/admin/events/new', label: 'New event' },
		{ href: '/admin/showcase', label: 'Showcase' },
		{ href: '/admin/subscribers', label: 'Subscribers' },
		{ href: '/admin/emails', label: 'Emails' }
	];
	/** "Events" covers the events list and event pages, not the other admin pages. */
	const adminActive = (href: string) => {
		const path = page.url.pathname;
		if (href === '/admin')
			return (
				path === '/admin' || (path.startsWith('/admin/events/') && path !== '/admin/events/new')
			);
		return path.startsWith(href);
	};

	/** Mobile menu: closed after every navigation and on Escape. */
	let menuOpen = $state(false);
	afterNavigate(() => (menuOpen = false));
</script>

<svelte:head>
	<title>OurBusan.vibe · build something in one afternoon</title>
	<meta
		name="description"
		content="Hackathons and vibeathons: sign up for the next event and see what people built at the last ones."
	/>
</svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

{#if data.admin}
	<!-- Admin mode: admin links on every page, above the public header. -->
	<nav class="bg-ink text-sm text-white" aria-label="Admin">
		<div class="shell flex h-10 items-center gap-1 overflow-x-auto whitespace-nowrap">
			<span class="mr-2 rounded-full bg-brand px-2 py-0.5 font-display text-xs text-ink uppercase"
				>Admin</span
			>
			{#each adminNav as item (item.href)}
				<a
					href={item.href}
					aria-current={adminActive(item.href) ? 'page' : undefined}
					class={[
						'rounded-full px-3 py-1 hover:bg-white/10',
						adminActive(item.href) && 'bg-white/15 font-semibold'
					]}>{item.label}</a
				>
			{/each}
			<form method="POST" action="/admin/logout" class="ml-auto">
				<button class="rounded-full px-3 py-1 text-white/75 hover:bg-white/10 hover:text-white"
					>Sign out</button
				>
			</form>
		</div>
	</nav>
{/if}

<header class="sticky top-0 z-30 border-b-2 border-ink bg-white">
	<div class="shell flex h-16 items-center gap-3">
		<a href="/" aria-label="Home"><Logo class="h-8 sm:h-9" /></a>
		<nav class="ml-auto hidden items-center gap-1 sm:flex" aria-label="Main">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					aria-current={active(item.href) ? 'page' : undefined}
					class={[
						'rounded-full px-3 py-2 text-sm font-medium hover:bg-cream',
						active(item.href) && 'underline decoration-brand decoration-2 underline-offset-4'
					]}>{item.label}</a
				>
			{/each}
		</nav>
		{#if !admin}
			<!-- The featured or next event; with none scheduled, the "get notified" page. -->
			<a
				href={data.nextEvent ? `/events/${data.nextEvent.slug}/signup` : '/next'}
				class="ml-auto btn-ink px-4 py-2 text-sm sm:ml-2 sm:px-5">Sign up</a
			>
		{/if}
		<button
			type="button"
			class={[
				'grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink sm:hidden',
				admin && 'ml-auto',
				menuOpen && 'bg-ink text-white'
			]}
			aria-label={menuOpen ? 'Close menu' : 'Open menu'}
			aria-expanded={menuOpen}
			aria-controls="mobile-menu"
			onclick={() => (menuOpen = !menuOpen)}
		>
			{#if menuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
		</button>
	</div>
	{#if menuOpen}
		<nav
			id="mobile-menu"
			class="border-t-2 border-ink bg-white sm:hidden"
			aria-label="Main (mobile)"
		>
			<ul class="shell flex flex-col py-2">
				{#each nav as item (item.href)}
					<li class="border-b border-dashed border-ink last:border-0">
						<a
							href={item.href}
							aria-current={active(item.href) ? 'page' : undefined}
							class={[
								'flex items-center justify-between py-3.5 text-lg font-medium',
								active(item.href) && 'text-brand-deep'
							]}
						>
							{item.label}<span aria-hidden="true">→</span>
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
</header>

{#if menuOpen}
	<!-- Tap outside to close. -->
	<button
		type="button"
		class="fixed inset-0 z-20 bg-ink/30 sm:hidden"
		aria-label="Close menu"
		tabindex="-1"
		onclick={() => (menuOpen = false)}
	></button>
{/if}

<main>
	{@render children()}
</main>

{#if !admin}
	<footer class="mt-24 bg-ink text-white">
		{#if !inSignup}
			<div class="border-b border-white/15">
				<div class="shell flex flex-col items-center gap-3 py-6 md:flex-row md:justify-center">
					<span class="font-medium">Hear about the next event first</span>
					<NewsletterForm dark source="footer" />
				</div>
			</div>
		{/if}
		<div class="shell grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
			<div class="flex flex-col gap-3">
				<span class="font-semibold">Events</span>
				<a href="/events" class="text-white/75 hover:text-white">Upcoming events</a>
				<a href="/events#past" class="text-white/75 hover:text-white">Past events</a>
				<a href="/showcase" class="text-white/75 hover:text-white">Project showcase</a>
			</div>
			<div class="flex flex-col gap-3">
				<span class="font-semibold">OurBusan.vibe</span>
				<a href="/about" class="text-white/75 hover:text-white">How an event works</a>
				<a href="/about#faq" class="text-white/75 hover:text-white">FAQ</a>
			</div>
			<div class="flex flex-col gap-3 sm:col-span-2">
				<span class="font-semibold">Build something in one afternoon</span>
				<p class="max-w-md text-sm text-white/75">
					Random teams, one deadline, live on the big screen. Show up with an idea or without one;
					leave with a project and a new team.
				</p>
			</div>
		</div>
		<div class="border-t border-white/15">
			<div
				class="shell flex flex-wrap items-center justify-between gap-3 py-5 text-sm text-white/70"
			>
				<Logo light class="h-8" />
				<span>Made by builders · © {new Date().getFullYear()} OurBusan.vibe</span>
			</div>
		</div>
	</footer>
{/if}
