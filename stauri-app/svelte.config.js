// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    alias: {
      $lib: './src/lib'
    },
    csp: {
      mode: 'auto',
      directives: {
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:', 'blob:', 'https://raw.githubusercontent.com', 'https://coin-images.coingecko.com', 'https://assets.coingecko.com'],
        'connect-src': ['self', 'http://127.0.0.1:*', 'ws://127.0.0.1:*', 'https://raw.githubusercontent.com', 'ipc:', 'http://ipc.localhost'],
        'object-src': ['none'],
        'base-uri': ['self']
      }
    },
  },
};

export default config;
