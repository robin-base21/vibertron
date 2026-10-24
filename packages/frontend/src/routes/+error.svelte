<script lang="ts">
	import { page } from '$app/state';
</script>

<main class="mx-auto flex max-w-xl flex-col gap-4 px-4 py-20">
	<p class="font-mono text-sm opacity-60">ERR {page.status}</p>
	<h1 class="bp-label text-4xl font-semibold">{page.error?.message ?? 'Something went wrong'}</h1>
	<a href="/" class="btn btn-outline bp-label w-fit">Back to start</a>
</main>
