import en from './en.json';
import ru from './ru.json';
import zh from './zh.json';
import es from './es.json';

export const locales = {
  en,
  ru,
  zh,
  es,
} as const;

export type Locale = keyof typeof locales;
export const supportedLocales: Locale[] = ['en', 'ru', 'zh', 'es'];
