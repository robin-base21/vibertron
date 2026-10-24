import type { LiveEvent } from './live.svelte';

/** Dev preview: seed fixture data and post a fake message every few seconds. */
export function startFixture(live: LiveEvent, status: 'open' | 'live' | 'ended'): () => void {
	let timer: ReturnType<typeof setInterval> | undefined;
	import('./fixtures').then(({ fixtureSnapshot, fixtureTeams }) => {
		live.seed(fixtureSnapshot(status));
		if (status !== 'live') return;
		let n = 0;
		timer = setInterval(() => {
			const t = fixtureTeams[n % fixtureTeams.length]!;
			live.handle({
				type: 'message.created',
				message: {
					id: `fx_${n}`,
					eventId: 'evt_fixture',
					teamId: t.id,
					codename: t.codename ?? t.name,
					authorName: t.members[0]!.displayName,
					body: `Fixture message #${++n}: shipping the thing`,
					hidden: false,
					createdAt: Date.now()
				}
			});
		}, 4000);
	});
	return () => clearInterval(timer);
}
