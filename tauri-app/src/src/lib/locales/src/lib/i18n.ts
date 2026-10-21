import i18n from 'sveltekit-i18n';
import type { Config } from 'sveltekit-i18n';

const config: Config = {
  loaders: [
    { locale: 'en', key: '', loader: async () => (await import('./locales/en.json')).default },
    { locale: 'ru', key: '', loader: async () => (await import('./locales/ru.json')).default },
    { locale: 'zh', key: '', loader: async () => (await import('./locales/zh.json')).default },
  ],
  initLocale: 'en', // Язык по умолчанию
};

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);
