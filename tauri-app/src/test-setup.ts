import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Мокаем i18n, чтобы t() возвращал ключ (в тестах мы ищем текст по ключу)
vi.mock('$lib/i18n', () => ({
  i18n: {
    t: (key: string) => key,
    locale: 'en',
  },
  loadTranslations: vi.fn().mockResolvedValue({}),
  // Если что-то ещё импортируется из i18n — добавьте сюда
}));
