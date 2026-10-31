import i18n from 'sveltekit-i18n';
import type { Config } from 'sveltekit-i18n';
import locales from './locales.json';

// Преобразуем плоский список в формат для библиотеки
const transformLocales = (lang: 'en' | 'ru' | 'zh') => {
  const result: Record<string, string> = {};
  for (const [key, translations] of Object.entries(locales)) {
    if (lang === 'en') {
      result[key] = key;
    } else {
      result[key] = (translations as any)[lang] || key;
    }
  }
  return result;
};


const config: Config = {
  fallbackLocale: 'en',
  // preprocess: 'none', // <-- Отключает преобразование ключей
  loaders: [
    { locale: 'en', namespace: '', loader: async () => transformLocales('en') },
    { locale: 'ru', namespace: '', loader: async () => transformLocales('ru') },
    { locale: 'zh', namespace: '', loader: async () => transformLocales('zh') },
  ],
  initLocale: 'en',
};

const i18nInstance = new i18n(config);

// Экспортируем всё необходимое, включая loadTranslations
export const {
  t,
  locale,
  locales: localesStore,
  loading,
  loadTranslations // <-- Вот он!
} = i18nInstance;

export { i18nInstance as i18n };
