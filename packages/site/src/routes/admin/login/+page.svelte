<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Admin · OurBusan.vibe</title></svelte:head>

<section class="shell flex justify-center pt-20">
	<form method="POST" class="flex w-full max-w-sm flex-col gap-4 card p-7">
		<span class="sticker self-start">Admin</span>
		<h1 class="text-2xl font-semibold">Sign in</h1>
		{#if data.enabled}
			<input
				class="field"
				type="password"
				name="password"
				required
				autocomplete="current-password"
				placeholder="Password"
				aria-label="Password"
			/>
			{#if form?.error}<p class="text-sm font-medium text-brand-deep" role="alert">
					{form.error}
				</p>{/if}
			<button class="btn-ink">Sign in</button>
		{:else}
			<p class="text-ink/70">Set <code>SITE_ADMIN_PASSWORD</code> to enable the admin area.</p>
		{/if}
	</form>
</section>
