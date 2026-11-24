<script lang="ts">
	const faq = [
		[
			'Do I need a team or an idea?',
			'No. Teams are put together at random when the event starts (friends who pair up stay together), and plenty of people arrive without an idea.'
		],
		[
			'Who can join?',
			'Anyone who likes building things: developers, designers, writers, curious people. Bring a laptop and a charger.'
		],
		[
			'How does voting work?',
			'Each team ranks its own projects; the top one pitches. Then the whole room ranks the pitches and the winner is revealed on the big screen.'
		],
		[
			'What happens to my project?',
			'It stays yours. If you agree on your phone, it gets a spot in the public showcase after the event; otherwise it stays private.'
		],
		[
			'How do I pay?',
			'Each event page says what it costs and how to pay. The organisers mark your spot as paid once it arrives.'
		]
	];
</script>

<svelte:head><title>About · OurBusan.vibe</title></svelte:head>

<section class="border-b-2 border-ink bg-brand">
	<div class="shell flex flex-col items-start gap-3 py-7 sm:gap-4 sm:py-10">
		<span
			class="inline-block -rotate-3 rounded-full bg-ink px-4 py-1.5 font-display text-sm text-white"
			>The format</span
		>
		<h1 class="max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
			A hackathon you can finish in one afternoon.
		</h1>
	</div>
</section>

<section class="shell grid gap-6 pt-14 md:grid-cols-3">
	{#each [['Join', 'Scan the QR code at the venue, pick a name, and pair up with a friend if you came together.'], ['Build', 'You get a team, a station on the floor plan and a countdown on the TV. Post updates to the room from your phone.'], ['Pitch & vote', 'Teams choose their best project, the room ranks the pitches, and the winner gets fireworks.']] as [title, text], i (title)}
		<div class="flex flex-col gap-3 card p-6">
			<span class="font-display text-4xl text-brand">0{i + 1}</span>
			<h2 class="text-xl font-semibold">{title}</h2>
			<p class="text-ink/75">{text}</p>
		</div>
	{/each}
</section>

<section class="shell pt-20" id="faq">
	<span class="sticker">FAQ</span>
	<h2 class="mt-3 mb-8 text-3xl font-medium tracking-tight sm:text-4xl">Questions people ask</h2>
	<div class="flex flex-col gap-4">
		{#each faq as [q, a] (q)}
			<details class="group card p-5">
				<summary class="cursor-pointer list-none text-lg font-semibold">
					<span class="mr-2 inline-block text-brand transition-transform group-open:rotate-45"
						>+</span
					>{q}
				</summary>
				<p class="mt-3 text-ink/75">{a}</p>
			</details>
		{/each}
	</div>
</section>
