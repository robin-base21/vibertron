<script lang="ts">
	let { dark = false, source }: { dark?: boolean; source: string } = $props();
</script>

<!-- Plain form post (works without JS); the /subscribe page confirms. The form's only purpose is the
     newsletter, so pressing Subscribe under the notice below is the opt-in. -->
<form method="POST" action="/subscribe" class="flex w-full max-w-xl flex-col gap-2">
	<input type="hidden" name="source" value={source} />
	<div class="flex gap-2">
		<input
			class={[
				'min-w-0 flex-1 rounded-full border-2 px-5 py-2.5 outline-none',
				dark ? 'border-white bg-white text-ink' : 'border-ink'
			]}
			type="email"
			name="email"
			required
			autocomplete="email"
			placeholder="you@email.com"
			aria-label="Email"
		/>
		<button class={dark ? 'btn-brand py-2.5' : 'btn-ink py-2.5'}>Subscribe</button>
	</div>
	<p class={['px-5 text-xs', dark ? 'text-white/75' : 'text-ink/70']}>
		By subscribing you agree to receive emails about upcoming events. Unsubscribe any time.
	</p>
</form>
