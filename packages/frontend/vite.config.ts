import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Read PUBLIC_* vars from the repo-root .env (shared with the backend)
	envDir: '../..',
	server: { port: 3000, strictPort: true },
	// opencv.js is only loaded inside the floorplan worker; pre-bundle it to avoid a dev reload on first import
	optimizeDeps: { include: ['@techstark/opencv-js'] }
});
