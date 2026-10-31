import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Важно для Tauri: запускаем по 1 тесту за раз, чтобы окна не мешали друг другу
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
  },

  // 🔥 ЧЕСТНЫЙ ЗАПУСК: Мы говорим Playwright запустить реальную среду разработки Tauri
  webServer: {
    command: 'pnpm tauri dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true, // Если вы уже запустили pnpm tauri dev в другой консоли, он подключится к нему
    timeout: 120000, // 2 минуты на первую компиляцию Rust. Последующие запуски будут за 2-3 секунды.
    stdout: 'pipe',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'tauri-chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
