import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    sveltekit()
  ],

  // 🔥 Исправление для Svelte 5 + Vitest: используем клиентскую версию Svelte
  resolve: mode === 'test' ? { conditions: ['browser'] } : {},

  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Строка projects: [] удалена
    // isolate: false,
  },

  // Tauri development options
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
    : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
