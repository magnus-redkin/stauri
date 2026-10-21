// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info

import { loadTranslations } from '$lib/i18n';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ url }) => {
  // В прототипе просто берем 'en'. Позже можно брать из localStorage.
  const initLocale = 'en';
  await loadTranslations(initLocale, url.pathname);
  return {};
};

export const ssr = false;
