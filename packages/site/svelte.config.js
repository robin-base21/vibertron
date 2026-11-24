import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({ out: 'build' }),
		// SITE_* settings live in the repo-root .env, shared with Vibertron.
		env: { dir: '../..' }
	}
};

export default config;
