import i18n from 'sveltekit-i18n';
import type { Config } from 'sveltekit-i18n';

const config: Config = {
  loaders: [
    { locale: 'en', namespace: '', loader: async () => (await import('./locales/en.json')).default },
    { locale: 'ru', namespace: '', loader: async () => (await import('./locales/ru.json')).default },
    { locale: 'zh', namespace: '', loader: async () => (await import('./locales/zh.json')).default },
  ],
  initLocale: 'en',
};

// Создаём инстанс
const i18nInstance = new i18n(config);

// Экспортируем всё, включая сам инстанс
export const { t, locale, locales, loading, loadTranslations } = i18nInstance;
export { i18nInstance as i18n }; // <-- Экспорт инстанса
