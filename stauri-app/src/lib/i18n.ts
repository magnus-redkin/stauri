import i18n from 'sveltekit-i18n';
import type { Config } from 'sveltekit-i18n';
import { locales } from './locales';

// Каждый язык — плоский словарь строк.
// Для 'en' ключ = значение, для остальных — перевод или fallback на ключ.
function transformLocales(lang: keyof typeof locales): Record<string, string> {
  const source = locales[lang] as Record<string, string>;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = value || key;
  }
  return result;
}

const config: Config = {
  fallbackLocale: 'en',
  loaders: [
    { locale: 'en', namespace: '', loader: async () => transformLocales('en') },
    { locale: 'ru', namespace: '', loader: async () => transformLocales('ru') },
    { locale: 'zh', namespace: '', loader: async () => transformLocales('zh') },
    { locale: 'es', namespace: '', loader: async () => transformLocales('es') },
  ],
  initLocale: 'en',
};

const i18nInstance = new i18n(config);

export const {
  t,
  locale,
  locales: localesStore,
  loading,
  loadTranslations,
} = i18nInstance;

export { i18nInstance as i18n };
