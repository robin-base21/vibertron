import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { port: 3100, strictPort: true },
	// The server runs on Bun (bun:sqlite), so dev and build use `vite --bun`.
	ssr: { external: ['bun:sqlite'] },
	build: { rollupOptions: { external: ['bun:sqlite'] } }
});
