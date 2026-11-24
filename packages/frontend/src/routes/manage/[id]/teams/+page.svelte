<script lang="ts">
	import { untrack } from 'svelte';
	import { GripVertical } from '@lucide/svelte';
	import type { Point, TeamDTO, TeamMoveBody } from 'common';
	import { events as eventsApi } from '$lib/api';
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import { segmentVertices } from '$lib/blueprint/geometry';
	import { LiveEvent } from '$lib/blueprint/live.svelte';
	import TeamSwatch from '$lib/components/TeamSwatch.svelte';
	import { handleError, toasts } from '$lib/stores/toast.svelte';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	const liveEvent = new LiveEvent(data.event.slug);
	// Subscription setup only; untracked so WS reconnects don't tear it down and redo it.
	$effect(() => untrack(() => liveEvent.start()));

	const snap = $derived(liveEvent.snapshot);
	const blueprint = $derived(snap?.blueprint ?? null);
	const teams = $derived(snap?.teams ?? []);
	const launched = $derived(snap?.event.status === 'live' || snap?.event.status === 'ended');
	/** People stay on their team once voting starts (ballots are per team); whole teams can still move. */
	const membersLocked = $derived((snap?.event.votingPhase ?? 'none') !== 'none');

	const areas = $derived(
		(blueprint?.segments ?? [])
			.filter((s) => s.stations.count > 0)
			.map((s) => {
				const here = teams.filter((t) => t.segmentId === s.id);
				const used = here.reduce((n, t) => n + t.members.length, 0);
				return { segment: s, teams: here, free: s.stations.count - used };
			})
	);
	const freeIn = (segmentId: string) => areas.find((a) => a.segment.id === segmentId)?.free ?? 0;
	const teamName = (t: TeamDTO) => t.codename ?? t.name;
	const teamOf = (participantId: string) =>
		teams.find((t) => t.members.some((m) => m.participantId === participantId));

	// ----- drag and drop (pointer events: mouse, touch, pen) plus click-to-pick-up -----

	type Item =
		{ kind: 'member'; id: string; label: string } | { kind: 'team'; id: string; label: string };
	/** Drop target: a person (swap) or a team (join) for people, an area for teams. */
	type Target = { participantId: string } | { teamId: string } | { segmentId: string };

	let picked = $state<Item | null>(null);
	let drag = $state<{
		item: Item;
		pointerId: number;
		x0: number;
		y0: number;
		x: number;
		y: number;
		active: boolean;
	} | null>(null);
	let saving = $state(false);
	let svg: SVGSVGElement | undefined = $state();

	const moving = $derived(drag?.active ? drag.item : picked);
	const hover = $derived(drag?.active ? targetAt(drag.x, drag.y, drag.item) : null);

	function canDrop(item: Item, target: Target): boolean {
		if (item.kind === 'member' && 'participantId' in target) {
			const other = teamOf(target.participantId);
			return !!other && teamOf(item.id)?.id !== other.id;
		}
		if (item.kind === 'member' && 'teamId' in target) {
			const from = teamOf(item.id);
			const to = teams.find((t) => t.id === target.teamId);
			return (
				!!from && !!to && from.id !== to.id && from.members.length > 1 && freeIn(to.segmentId) > 0
			);
		}
		if (item.kind === 'team' && 'segmentId' in target) {
			const team = teams.find((t) => t.id === item.id);
			return (
				!!team &&
				team.segmentId !== target.segmentId &&
				freeIn(target.segmentId) >= team.members.length
			);
		}
		return false;
	}

	function inside(p: Point, poly: Point[]): boolean {
		let hit = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const [xi, yi] = poly[i]!;
			const [xj, yj] = poly[j]!;
			if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
		}
		return hit;
	}

	/** Area of the blueprint under a screen point (team drops onto the plan). */
	function segmentOnPlan(x: number, y: number): string | null {
		const m = svg?.getScreenCTM();
		if (!svg || !m || !blueprint) return null;
		const p = new DOMPoint(x, y).matrixTransform(m.inverse());
		const s = blueprint.segments.find(
			(s) => s.stations.count > 0 && inside([p.x, p.y], segmentVertices(s))
		);
		return s?.id ?? null;
	}

	function targetAt(x: number, y: number, item: Item): Target | null {
		const el = document.elementFromPoint(x, y);
		let target: Target | null = null;
		if (item.kind === 'member') {
			const person = el?.closest<HTMLElement>('[data-drop-person]')?.dataset.dropPerson;
			const team = el?.closest<HTMLElement>('[data-drop-team]')?.dataset.dropTeam;
			if (person && canDrop(item, { participantId: person })) target = { participantId: person };
			else if (team) target = { teamId: team };
		} else {
			const id =
				el?.closest<HTMLElement>('[data-drop-segment]')?.dataset.dropSegment ??
				(el?.closest('svg') === svg ? segmentOnPlan(x, y) : null);
			if (id) target = { segmentId: id };
		}
		return target && canDrop(item, target) ? target : null;
	}

	const isHover = (t: Target) =>
		!!hover &&
		('participantId' in t
			? 'participantId' in hover && hover.participantId === t.participantId
			: 'teamId' in t
				? 'teamId' in hover && hover.teamId === t.teamId
				: 'segmentId' in hover && hover.segmentId === t.segmentId);

	function onpointerdown(e: PointerEvent, item: Item) {
		if (saving || (e.pointerType === 'mouse' && e.button !== 0)) return;
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = {
			item,
			pointerId: e.pointerId,
			x0: e.clientX,
			y0: e.clientY,
			x: e.clientX,
			y: e.clientY,
			active: false
		};
	}

	function onpointermove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		drag.x = e.clientX;
		drag.y = e.clientY;
		if (!drag.active && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > 6) {
			drag.active = true;
			picked = null;
		}
	}

	function onpointerup(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		const { item, active, x, y } = drag;
		drag = null;
		if (active) {
			const target = targetAt(x, y, item);
			if (target) drop(item, target);
		} else if (picked?.kind === 'member' && item.kind === 'member' && picked.id !== item.id) {
			// Clicking someone on another team while holding a person swaps the two.
			const target = { participantId: item.id };
			if (canDrop(picked, target)) drop(picked, target);
			else picked = item;
		} else {
			// A click picks the item up (or puts it back); the next click on a target drops it.
			picked = picked?.kind === item.kind && picked.id === item.id ? null : item;
		}
	}

	function cancel() {
		drag = null;
	}

	function clickTarget(e: Event, target: Target) {
		if (!picked) return;
		e.stopPropagation();
		if (canDrop(picked, target)) drop(picked, target);
	}

	/** Click on the plan while a team is picked up. */
	function clickPlan(e: MouseEvent) {
		if (picked?.kind !== 'team') return;
		const segmentId = segmentOnPlan(e.clientX, e.clientY);
		if (segmentId) clickTarget(e, { segmentId });
	}

	async function drop(item: Item, target: Target) {
		const body: TeamMoveBody =
			'participantId' in target
				? { kind: 'swap', participantId: item.id, withParticipantId: target.participantId }
				: 'teamId' in target
					? { kind: 'member', participantId: item.id, teamId: target.teamId }
					: { kind: 'team', teamId: item.id, segmentId: target.segmentId };
		const nameOf = (pid: string) =>
			teams.flatMap((t) => t.members).find((m) => m.participantId === pid)?.displayName;
		picked = null;
		saving = true;
		try {
			const res = await eventsApi.moveTeam(data.event.id, body);
			for (const team of res.teams) liveEvent.handle({ type: 'team.updated', team });
			toasts.success(
				'participantId' in target
					? `Swapped ${item.label} and ${nameOf(target.participantId)}`
					: `Moved ${item.label} to ${
							'teamId' in target
								? teamName(teams.find((t) => t.id === target.teamId)!)
								: blueprint?.segments.find((s) => s.id === target.segmentId)?.name
						}`
			);
		} catch (err) {
			handleError(err);
		} finally {
			saving = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') picked = null;
	}
</script>

<svelte:window {onkeydown} />
<svelte:head><title>Rearrange teams · {data.event.name} · Vibertron</title></svelte:head>

<main class="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8">
	<header class="flex flex-col gap-2 border-b border-bp-line/40 pb-5">
		<a href="/manage/{data.event.id}" class="bp-label text-xs opacity-60 hover:opacity-100"
			>← {data.event.name}</a
		>
		<h1 class="bp-label text-4xl font-semibold">Rearrange teams</h1>
		<p class="max-w-2xl text-sm opacity-70">
			Drag a person onto another team to move them, or onto another person to swap the two. Drag a
			team by its handle into another area, on the list or on the plan. Or click to pick something
			up, then click where it goes. Phones and the TV update right away.
		</p>
		{#if membersLocked}
			<p class="font-mono text-xs text-warning">
				Voting has started: people stay on their teams. Whole teams can still move.
			</p>
		{/if}
	</header>

	{#if !snap}
		<p class="bp-label opacity-50">{liveEvent.error ?? 'Loading…'}</p>
	{:else if !launched}
		<div class="border border-dashed border-bp-line/40 p-8 text-center">
			<p class="bp-label opacity-60">Teams are formed at launch</p>
			<p class="mt-1 font-mono text-xs opacity-50">Come back here once the event is live.</p>
		</div>
	{:else}
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<div class="lg:sticky lg:top-4 lg:self-start">
				{#if blueprint}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div onclick={clickPlan} class={[picked?.kind === 'team' && 'cursor-copy']}>
						<Blueprint
							{blueprint}
							{teams}
							bind:svg
							highlightSegmentId={hover && 'segmentId' in hover ? hover.segmentId : undefined}
							highlightTeamId={moving?.kind === 'team'
								? moving.id
								: hover && 'teamId' in hover
									? hover.teamId
									: undefined}
							showUnderlay
							class="w-full border border-bp-line/30"
						/>
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-5">
				{#each areas as area (area.segment.id)}
					{@const target = { segmentId: area.segment.id }}
					{@const open = moving?.kind === 'team' && canDrop(moving, target)}
					<section
						data-drop-segment={area.segment.id}
						aria-label={area.segment.name}
						class={[
							'flex flex-col gap-3 border p-3 transition-colors',
							isHover(target)
								? 'border-bp-accent bg-bp-accent/10'
								: open
									? 'border-dashed border-bp-accent/60'
									: 'border-bp-line/40',
							moving?.kind === 'team' && !open && 'opacity-50'
						]}
					>
						<div class="flex items-baseline justify-between gap-2">
							<h2 class="bp-label text-lg">
								{#if picked?.kind === 'team' && open}
									<button
										class="underline decoration-bp-accent"
										onclick={(e) => clickTarget(e, target)}>{area.segment.name} ← move here</button
									>
								{:else}
									{area.segment.name}
								{/if}
							</h2>
							<span class="font-mono text-xs opacity-60"
								>{area.free}/{area.segment.stations.count} free</span
							>
						</div>
						{#if area.teams.length === 0}
							<p class="font-mono text-xs opacity-40">No teams here</p>
						{/if}
						<div class="grid gap-3 sm:grid-cols-2">
							{#each area.teams as team (team.id)}
								{@const tt = { teamId: team.id }}
								{@const joinable = moving?.kind === 'member' && canDrop(moving, tt)}
								{@const teamPicked = moving?.kind === 'team' && moving.id === team.id}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<div
									data-drop-team={team.id}
									onclick={(e) => clickTarget(e, tt)}
									class={[
										'flex flex-col border bg-base-100',
										isHover(tt) || teamPicked
											? 'border-bp-accent shadow-[0_0_0_1px_var(--color-bp-accent)]'
											: joinable
												? 'border-dashed border-bp-accent/60'
												: 'border-bp-line/50',
										picked?.kind === 'member' && joinable && 'cursor-copy'
									]}
								>
									<div class="flex items-center gap-2 border-b border-bp-line/30">
										<button
											type="button"
											class={[
												'flex h-9 w-8 shrink-0 touch-none items-center justify-center border-r border-bp-line/30',
												drag?.item.id === team.id && drag.active ? 'cursor-grabbing' : 'cursor-grab'
											]}
											aria-label="Move team {teamName(team)} to another area"
											aria-pressed={picked?.kind === 'team' && picked.id === team.id}
											disabled={saving}
											onpointerdown={(e) =>
												onpointerdown(e, { kind: 'team', id: team.id, label: teamName(team) })}
											{onpointermove}
											{onpointerup}
											onpointercancel={cancel}
										>
											<GripVertical size={16} />
										</button>
										<TeamSwatch position={team.position} />
										<span class="min-w-0 flex-1 truncate bp-label">{teamName(team)}</span>
										<span class="pr-2 font-mono text-xs opacity-50">{team.name}</span>
									</div>
									<ul class="flex flex-wrap gap-1.5 p-2">
										{#each team.members as m (m.participantId)}
											{@const swap = { participantId: m.participantId }}
											{@const isPicked = moving?.kind === 'member' && moving.id === m.participantId}
											{@const swappable = moving?.kind === 'member' && canDrop(moving, swap)}
											<li data-drop-person={m.participantId}>
												<button
													type="button"
													class={[
														'flex touch-none items-center gap-1.5 border px-2 py-1 text-sm',
														isPicked || isHover(swap)
															? 'border-bp-accent text-bp-accent'
															: swappable
																? 'border-dashed border-bp-accent/60'
																: 'border-bp-line/40 hover:border-bp-line',
														membersLocked ? 'cursor-default opacity-60' : 'cursor-grab'
													]}
													title={membersLocked
														? 'Voting has started'
														: swappable
															? `Swap with ${m.displayName}`
															: 'Drag onto another team or person, or click then click where it goes'}
													aria-pressed={isPicked}
													disabled={membersLocked || saving}
													onpointerdown={(e) =>
														onpointerdown(e, {
															kind: 'member',
															id: m.participantId,
															label: m.displayName
														})}
													{onpointermove}
													{onpointerup}
													onpointercancel={cancel}
												>
													{m.displayName}
													<span class="font-mono text-[0.65rem] opacity-50"
														>{m.stationId.split('-').pop()}</span
													>
												</button>
											</li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		</div>
	{/if}
</main>

{#if drag?.active}
	<div
		class="pointer-events-none fixed z-50 translate-x-3 translate-y-3 border border-bp-accent bg-base-100 px-2 py-1 bp-label text-sm text-bp-accent shadow-lg"
		style:left="{drag.x}px"
		style:top="{drag.y}px"
	>
		{drag.item.label}
	</div>
{/if}
