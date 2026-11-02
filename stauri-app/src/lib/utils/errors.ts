/**
 * Разбор ошибок, приходящих из Rust-команд Tauri.
 *
 * Команды возвращают `AppError` (см. src-tauri/src/error.rs), который
 * сериализуется объектом:
 *
 *   { "kind": "backend", "message": "backend is not running" }
 *
 * Раньше на фронтенде было `e?.message || e`: для объекта без поля `message`
 * это давало `"[object Object]"` в UI. Здесь — единая точка разбора.
 */

/** Категория ошибки. Совпадает с `ErrorKind` в Rust. */
export type ErrorKind = 'backend' | 'config' | 'io' | 'network' | 'internal';

/** Ошибка команды Tauri после сериализации. */
export interface AppErrorPayload {
  kind: ErrorKind;
  message: string;
}

function isAppError(value: unknown): value is AppErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as AppErrorPayload).message === 'string'
  );
}

/**
 * Человекочитаемый текст ошибки.
 *
 * Для `AppError` берётся `message`; для `Error` — `message`; иначе
 * безопасное `String()`. Никогда не возвращает `[object Object]`.
 */
export function formatError(e: unknown, fallback = 'Произошла неизвестная ошибка'): string {
  if (isAppError(e)) {
    return e.message;
  }
  if (e instanceof Error) {
    return e.message || fallback;
  }
  if (typeof e === 'string' && e.trim() !== '') {
    return e;
  }
  return fallback;
}

/**
 * Категория ошибки, если удалось определить.
 *
 * Нужна, когда поведение зависит от причины: например, «бэкенд не запущен»
 * обрабатывается иначе, чем «сеть недоступна».
 */
export function errorKind(e: unknown): ErrorKind | null {
  return isAppError(e) ? e.kind : null;
}

/** Короткая метка для логов: `[backend]` или пусто. */
export function errorTag(e: unknown): string {
  const kind = errorKind(e);
  return kind ? `[${kind}] ` : '';
}
