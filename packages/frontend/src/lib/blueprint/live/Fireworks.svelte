<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		/** Burst colours; the first one is used most (the winner's team colour). */
		colors: string[];
		/** How long new rockets keep launching. */
		durationMs?: number;
		class?: string;
	}

	let { colors, durationMs = 8000, class: className = '' }: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();

	interface Spark {
		x: number;
		y: number;
		vx: number;
		vy: number;
		life: number;
		color: string;
		rocket: boolean;
	}

	onMount(() => {
		// Respect the venue screen's reduced-motion setting: no animation at all.
		if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const ctx = canvas.getContext('2d')!;
		const dpr = Math.min(2, devicePixelRatio || 1);
		const resize = () => {
			canvas!.width = canvas!.clientWidth * dpr;
			canvas!.height = canvas!.clientHeight * dpr;
		};
		resize();
		addEventListener('resize', resize);

		const sparks: Spark[] = [];
		const pick = () =>
			Math.random() < 0.5 ? colors[0]! : colors[Math.floor(Math.random() * colors.length)]!;
		const launch = () => {
			const w = canvas!.width;
			const h = canvas!.height;
			sparks.push({
				x: w * (0.15 + Math.random() * 0.7),
				y: h,
				vx: (Math.random() - 0.5) * 2 * dpr,
				// Speed to peak (and burst) between 45% and 85% of the screen height.
				vy: -Math.sqrt(2 * 0.12 * dpr * h * (0.45 + Math.random() * 0.4)),
				life: 1,
				color: pick(),
				rocket: true
			});
		};
		const burst = (s: Spark) => {
			const n = 70 + Math.floor(Math.random() * 40);
			const speed = (3 + Math.random() * 3) * dpr;
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2;
				const v = speed * (0.4 + Math.random() * 0.6);
				sparks.push({
					x: s.x,
					y: s.y,
					vx: Math.cos(a) * v,
					vy: Math.sin(a) * v,
					life: 1,
					color: s.color,
					rocket: false
				});
			}
		};

		const start = performance.now();
		let last = start;
		let nextLaunch = start;
		let frame = 0;
		const tick = (now: number) => {
			const dt = Math.min(2, (now - last) / 16.7);
			last = now;
			if (now - start < durationMs && now >= nextLaunch) {
				launch();
				nextLaunch = now + 250 + Math.random() * 450;
			}
			// Trails: fade the previous frame instead of clearing it.
			ctx.globalCompositeOperation = 'destination-out';
			ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
			ctx.fillRect(0, 0, canvas!.width, canvas!.height);
			ctx.globalCompositeOperation = 'lighter';
			for (let i = sparks.length - 1; i >= 0; i--) {
				const s = sparks[i]!;
				s.x += s.vx * dt;
				s.y += s.vy * dt;
				if (s.rocket) {
					s.vy += 0.12 * dpr * dt;
					if (s.vy >= -1 * dpr) {
						burst(s);
						sparks.splice(i, 1);
						continue;
					}
				} else {
					s.vx *= 0.985;
					s.vy = s.vy * 0.985 + 0.06 * dpr * dt;
					s.life -= 0.012 * dt;
					if (s.life <= 0) {
						sparks.splice(i, 1);
						continue;
					}
				}
				ctx.globalAlpha = Math.max(0, s.life);
				ctx.fillStyle = s.color;
				ctx.beginPath();
				ctx.arc(s.x, s.y, (s.rocket ? 2.2 : 1.8) * dpr, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
			if (sparks.length || now - start < durationMs) frame = requestAnimationFrame(tick);
			else ctx.clearRect(0, 0, canvas!.width, canvas!.height);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener('resize', resize);
		};
	});
</script>

<canvas bind:this={canvas} class={['pointer-events-none', className]} aria-hidden="true"></canvas>
