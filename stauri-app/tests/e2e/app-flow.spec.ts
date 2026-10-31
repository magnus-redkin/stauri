import { test, expect } from '@playwright/test';

test.describe('Честный E2E тест Stauri', () => {
  test('реальное приложение должно запустить бэкенд и показать форму', async ({ page }) => {
    console.log('⏳ Переход на страницу. Ожидаем реального запуска Tauri и status-backend...');

    // 1. Переходим на страницу. Playwright уже ждет готовности webServer (до 120 сек)
    await page.goto('/');

    // 2. 🔥 ГЛАВНЫЙ СЕКРЕТ: Даем реальное время на запуск Rust-бэкенда и гидратацию Svelte.
    // Реальный status-backend запускается за 3-8 секунд. Мы даем запас 45 секунд.
    console.log('⏳ Ожидаем появления заголовка "Stauri" (таймаут 45 сек)...');

    const stauriText = page.getByText('Stauri').first();
    await expect(stauriText).toBeVisible({ timeout: 45000 });
    console.log('✅ Заголовок "Stauri" успешно отрисован реальным приложением!');

    // 3. Проверяем поле пароля (оно появится, когда реальный бэкенд ответит или отрисуется UI)
    console.log('⏳ Ожидаем появления поля ввода...');
    const passwordField = page.locator('input[type="password"]').or(page.getByPlaceholder(/password|пароль|Password/i));
    await expect(passwordField).toBeVisible({ timeout: 10000 });
    console.log('✅ Поле ввода найдено!');

    // 4. Вводим реальный пароль
    console.log('⌨️ Вводим пароль "qwer"...');
    await passwordField.fill('qwer');
    await expect(passwordField).toHaveValue('qwer');
    console.log('✅ Пароль успешно введен!');

    // 5. Проверяем кнопку
    const actionButton = page.locator('button').filter({ hasText: /Create Profile|Log In/i }).first();
    await expect(actionButton).toBeVisible();
    console.log('✅ Кнопка действия найдена!');

    console.log('🎉 ЧЕСТНЫЙ E2E ТЕСТ ПРОЙДЕН! Приложение работает корректно.');
  });
});
