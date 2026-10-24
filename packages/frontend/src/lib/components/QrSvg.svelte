<script lang="ts">
	import encodeQR from 'qr';

	let { text, class: klass = '' }: { text: string; class?: string } = $props();

	// Dark modules as one path on a white square with a 4-module quiet zone. Kept
	// dark-on-light (not inverted) because many phone scanners reject inverted codes.
	const qr = $derived.by(() => {
		const grid = encodeQR(text, 'raw', { ecc: 'medium', border: 0 });
		const n = grid.length;
		let d = '';
		for (let y = 0; y < n; y++)
			for (let x = 0; x < n; x++) if (grid[y]![x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
		return { size: n + 8, d };
	});
</script>

<svg
	viewBox="0 0 {qr.size} {qr.size}"
	class={klass}
	shape-rendering="crispEdges"
	role="img"
	aria-label="QR code"
>
	<rect width={qr.size} height={qr.size} fill="#f5f5f5" />
	<path d={qr.d} fill="#0a0a0a" />
</svg>
