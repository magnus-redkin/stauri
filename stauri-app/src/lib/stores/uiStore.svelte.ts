/**
 * Настройки отображения: размер шрифта и тема.
 *
 * ## Почему отдельный стор
 *
 * Раньше обе настройки жили внутри экрана «Настройки» и применялись только
 * при клике по контролу. Следствие было неприятным: после перезапуска
 * приложение выглядело по умолчанию, хотя значение в `localStorage` лежало
 * правильное — применить его при старте было некому. Пользователь открывал
 * Настройки и видел ползунок на старом месте, но интерфейс не менялся,
 * пока он не дёрнет ползунок заново.
 *
 * Теперь значения читаются и применяются при старте (`loadUiPreferences`),
 * а экран настроек и горячие клавиши только меняют их через этот стор.
 *
 * ## Почему размер корневого шрифта, а не отдельный класс
 *
 * Все размеры в разметке заданы в `rem` (Tailwind по умолчанию так делает),
 * поэтому изменение `font-size` у `<html>` масштабирует и текст, и отступы,
 * и контролы — как зум в браузере. Это предсказуемее, чем менять только
 * `font-size` у текстовых элементов: при втором варианте подписи перестают
 * помещаться в кнопки.
 *
 * Исключение — несколько мест с жёсткими `px`; они переведены в `rem`, иначе
 * не масштабировались бы вместе с остальным.
 */

const FONT_KEY = 'stauri-font-size';
const THEME_KEY = 'stauri-theme';

/**
 * Границы и шаг.
 *
 * Ниже 12px подписи перестают читаться, выше 24px панели разъезжаются так,
 * что список чатов занимает пол-экрана. Шаг 1px: Ctrl+«+» и Ctrl+«-» должны
 * ощущаться как точная подстройка, а не как рывок.
 */
export const FONT_MIN = 12;
export const FONT_MAX = 24;

/**
 * Значение по умолчанию.
 *
 * 17, а не 16: на этой сборке 16px читались мелковато на стандартном экране,
 * и пользователь просил сразу на пункт больше.
 */
export const FONT_DEFAULT = 17;

export type ThemeName = 'maroon' | 'light' | 'dark';
const THEMES: ThemeName[] = ['maroon', 'light', 'dark'];

export const uiState = $state({
  fontSize: FONT_DEFAULT,
  theme: 'maroon' as ThemeName,
});

/** Приводит значение к допустимому диапазону и целому числу. */
export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return FONT_DEFAULT;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(px)));
}

function applyFontSize(px: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.fontSize = `${px}px`;
}

function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.remove('dark');
  html.setAttribute('data-theme', theme);
  // `dark` — класс, на который завязан `@custom-variant dark` в app.css.
  // Без него тёмная тема не переключит служебные стили.
  if (theme === 'dark') html.classList.add('dark');
}

/**
 * Читает сохранённые значения и применяет их к документу.
 *
 * Вызывать один раз при старте, до первого рендера полезного содержимого:
 * иначе пользователь на мгновение увидит интерфейс в размере по умолчанию.
 * Ошибку чтения не пробрасываем — испорченное хранилище не должно мешать
 * приложению открыться.
 */
export function loadUiPreferences(): void {
  let size = FONT_DEFAULT;
  let theme: ThemeName = 'maroon';

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(FONT_KEY);
      if (raw) size = clampFontSize(Number(raw));
    } catch {
      // Заблокированное хранилище: остаёмся на значении по умолчанию.
    }
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved && (THEMES as string[]).includes(saved)) theme = saved as ThemeName;
    } catch {
      // То же самое.
    }
  }

  uiState.fontSize = size;
  uiState.theme = theme;
  applyFontSize(size);
  applyTheme(theme);
}

/** Задаёт размер шрифта, сохраняет и применяет. */
export function setFontSize(px: number): void {
  const size = clampFontSize(px);
  uiState.fontSize = size;
  applyFontSize(size);
  try {
    localStorage.setItem(FONT_KEY, String(size));
  } catch {
    // Не сохранилось — действует до перезапуска. Это не повод падать.
  }
}

export function increaseFontSize(): void {
  setFontSize(uiState.fontSize + 1);
}

export function decreaseFontSize(): void {
  setFontSize(uiState.fontSize - 1);
}

/** Возврат к значению по умолчанию (Ctrl+0). */
export function resetFontSize(): void {
  setFontSize(FONT_DEFAULT);
}

export function setTheme(theme: ThemeName): void {
  uiState.theme = theme;
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // См. `setFontSize`.
  }
}
