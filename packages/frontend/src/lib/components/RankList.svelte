<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronDown, ChevronUp, GripVertical } from '@lucide/svelte';

	interface Props {
		/** Ids, best first. Reordered in place by dragging or the ▲/▼ buttons. */
		order: string[];
		/** Row content. */
		row: Snippet<[id: string, index: number]>;
		/** Accessible name of an item (for the move buttons). */
		label?: (id: string) => string;
		disabled?: boolean;
		class?: string;
	}

	let {
		order = $bindable(),
		row,
		label = (id) => id,
		disabled = false,
		class: klass = ''
	}: Props = $props();

	const EDGE = 64;

	let list: HTMLOListElement | undefined = $state();

	/** Active drag: geometry is measured once at pointerdown, in page coordinates. */
	let drag = $state<{
		index: number;
		pointerId: number;
		startY: number;
		tops: number[];
		heights: number[];
		gap: number;
		clientY: number;
	} | null>(null);
	let offset = $state(0);
	/** Disables transitions for the frame in which the reorder is committed (avoids a jump). */
	let settling = $state(false);
	let frame = 0;

	const pageY = (clientY: number) => clientY + window.scrollY;

	/** Slot the dragged row would drop into: rows whose centre is above the dragged centre. */
	const target = $derived.by(() => {
		if (!drag) return -1;
		const centre = drag.tops[drag.index]! + drag.heights[drag.index]! / 2 + offset;
		let t = 0;
		for (let i = 0; i < drag.tops.length; i++) {
			if (i !== drag.index && drag.tops[i]! + drag.heights[i]! / 2 < centre) t++;
		}
		return t;
	});

	function shiftFor(i: number): number {
		if (!drag) return 0;
		if (i === drag.index) return offset;
		const step = drag.heights[drag.index]! + drag.gap;
		if (drag.index < i && i <= target) return -step;
		if (target <= i && i < drag.index) return step;
		return 0;
	}

	/** Position a row is shown at during a drag (for its number). */
	function slotOf(i: number): number {
		if (!drag) return i;
		if (i === drag.index) return target;
		if (drag.index < i && i <= target) return i - 1;
		if (target <= i && i < drag.index) return i + 1;
		return i;
	}

	function move(from: number, to: number) {
		if (to < 0 || to >= order.length || from === to) return;
		const next = [...order];
		const [id] = next.splice(from, 1);
		next.splice(to, 0, id!);
		order = next;
	}

	function onpointerdown(e: PointerEvent, index: number) {
		if (disabled || !list || (e.pointerType === 'mouse' && e.button !== 0)) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const rects = [...list.children].map((el) => el.getBoundingClientRect());
		drag = {
			index,
			pointerId: e.pointerId,
			startY: pageY(e.clientY),
			tops: rects.map((r) => pageY(r.top)),
			heights: rects.map((r) => r.height),
			gap: rects.length > 1 ? rects[1]!.top - rects[0]!.bottom : 0,
			clientY: e.clientY
		};
		offset = 0;
		frame = requestAnimationFrame(autoScroll);
	}

	function onpointermove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		drag.clientY = e.clientY;
		offset = pageY(e.clientY) - drag.startY;
	}

	/** Scroll the page while the pointer is held near the top or bottom edge. */
	function autoScroll() {
		if (!drag) return;
		const y = drag.clientY;
		const dy =
			y < EDGE ? -(EDGE - y) / 4 : y > innerHeight - EDGE ? (y - (innerHeight - EDGE)) / 4 : 0;
		if (dy) {
			window.scrollBy(0, dy);
			offset = pageY(y) - drag.startY;
		}
		frame = requestAnimationFrame(autoScroll);
	}

	function onpointerup(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		cancelAnimationFrame(frame);
		const from = drag.index;
		const to = target;
		settling = true;
		drag = null;
		offset = 0;
		move(from, to);
		requestAnimationFrame(() => (settling = false));
	}

	function onkeydown(e: KeyboardEvent, index: number) {
		if (disabled) return;
		const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1;
		if (to === -1) return;
		e.preventDefault();
		move(index, to);
		// Keep focus on the moved row's handle.
		requestAnimationFrame(() =>
			list
				?.querySelectorAll<HTMLElement>('[data-handle]')
				[Math.max(0, Math.min(to, order.length - 1))]?.focus()
		);
	}
</script>

<ol bind:this={list} class={['flex flex-col gap-2', klass]} aria-label="Ranking">
	{#each order as id, i (id)}
		{@const dragging = drag?.index === i}
		<li
			class={[
				'relative flex items-stretch border bg-base-100 select-none',
				dragging
					? 'z-10 border-bp-accent shadow-[0_0_0_1px_var(--color-bp-accent)]'
					: 'border-bp-line/50',
				!dragging && !settling && 'transition-transform duration-150'
			]}
			style:transform="translateY({shiftFor(i)}px)"
			data-rank-id={id}
		>
			<button
				type="button"
				data-handle
				class={[
					'flex w-12 shrink-0 touch-none items-center justify-center border-r border-bp-line/30',
					disabled ? 'cursor-default opacity-30' : dragging ? 'cursor-grabbing' : 'cursor-grab'
				]}
				aria-label="Drag {label(id)}, or use the arrow keys"
				{disabled}
				onpointerdown={(e) => onpointerdown(e, i)}
				{onpointermove}
				{onpointerup}
				onpointercancel={onpointerup}
				onkeydown={(e) => onkeydown(e, i)}
			>
				<GripVertical size={18} />
			</button>
			<span
				class={[
					'flex w-14 shrink-0 items-center justify-center font-mono text-3xl tabular-nums',
					dragging && 'text-bp-accent'
				]}
			>
				{String(slotOf(i) + 1).padStart(2, '0')}
			</span>
			<div class="flex min-w-0 flex-1 flex-col justify-center py-3 pr-2">
				{@render row(id, i)}
			</div>
			<div class="flex shrink-0 flex-col border-l border-bp-line/30">
				<button
					type="button"
					class="flex flex-1 items-center justify-center px-3 hover:bg-base-200 disabled:opacity-20"
					aria-label="Move {label(id)} up"
					disabled={disabled || i === 0}
					onclick={() => move(i, i - 1)}
				>
					<ChevronUp size={18} />
				</button>
				<button
					type="button"
					class="flex flex-1 items-center justify-center border-t border-bp-line/30 px-3 hover:bg-base-200 disabled:opacity-20"
					aria-label="Move {label(id)} down"
					disabled={disabled || i === order.length - 1}
					onclick={() => move(i, i + 1)}
				>
					<ChevronDown size={18} />
				</button>
			</div>
		</li>
	{/each}
</ol>
