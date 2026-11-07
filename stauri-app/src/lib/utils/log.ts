/**
 * Логирование фронтенда.
 *
 * ## Куда идут сообщения
 *
 * В webview логи бесполезны: в release-сборке `console.*` вырезается
 * бандлером, а stdout окна пользователь не видит. Поэтому всё уходит в Rust
 * командой `log_frontend`, и `logging.rs` пишет в тот же файл, что и
 * серверные сообщения:
 *
 *   ~/.local/share/com.magnus.stauri-app/logs/stauri.<дата>.log
 *
 * Вычищение секретов делает `RedactingWriter` на стороне Rust — здесь об этом
 * заботиться не нужно, и это правильно: чистка в одном месте, а не в каждом
 * вызове.
 *
 * ## Включение
 *
 * Во время отладки включено **всегда**. Отключить можно сборкой с
 * `VITE_DEBUG_LOG=0`.
 *
 * Так сделано намеренно: первый заход показал, что при выключенном по
 * умолчанию логировании разбор сценария в собранном приложении невозможен —
 * в файле были только сообщения Rust, а ни одного RPC-вызова нет. Когда
 * отладка закончится, условие меняется на `=== '1'`, и логирование
 * становится опциональным.
 */

import { invoke } from '@tauri-apps/api/core';

type Level = 'debug' | 'info' | 'warn' | 'error';

const isDev = import.meta.env.DEV;
// По умолчанию включено; выключается только явным VITE_DEBUG_LOG=0.
const enabled = import.meta.env.VITE_DEBUG_LOG !== '0';

/**
 * Ограничение на объём одного сообщения.
 *
 * Rust обрезает по 4096 символов, но лишний трафик через IPC ни к чему:
 * обрезаем здесь же.
 */
const MAX_LEN = 4000;

/** Превращает произвольное значение в строку, не падая на циклах. */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return value.stack ? `${value.message}\n${value.stack}` : value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function send(level: Level, args: unknown[]) {
  const message = args.map(stringify).join(' ');
  const trimmed = message.length > MAX_LEN ? `${message.slice(0, MAX_LEN)}…` : message;

  // В dev дублируем в консоль: так видно без переключения на файл.
  if (isDev) {
    // eslint-disable-next-line no-console -- модуль существует именно для этого
    (console[level] ?? console.log)(trimmed);
  }

  if (!enabled) return;

  // Не ждём промис: логирование не должно задерживать вызывающий код.
  // Ошибку глотаем — если IPC недоступен, падать из-за лога нельзя.
  //
  // `?.catch` обязателен: в тестах `invoke` мокается обычной функцией, и
  // прямой вызов `.catch` на undefined роняет вызывающий код.
  try {
    invoke('log_frontend', { level, message: trimmed })?.catch(() => {});
  } catch {
    // Синхронный throw от invoke (например, в тестовом окружении) тоже
    // не должен влиять на приложение.
  }
}

export const debug = (...args: unknown[]) => send('debug', args);
export const info = (...args: unknown[]) => send('info', args);
export const warn = (...args: unknown[]) => send('warn', args);
export const error = (...args: unknown[]) => send('error', args);

/**
 * Логирует вход и результат вызова RPC.
 *
 * Тела запросов и ответов НЕ логируются: `settings_getSettings` возвращает
 * seed-фразу в поле `mnemonic`. Логируем имя метода, размер ответа и признак
 * ошибки.
 *
 * Возвращает обёртку, чтобы вызывающий код не дублировал `try/finally`
 * в каждом месте.
 */
export async function traceRpc<T>(method: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  debug(`[rpc] → ${method}`);
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - started);
    const size = typeof result === 'object' && result !== null
      ? JSON.stringify(result).length
      : String(result ?? '').length;
    debug(`[rpc] ← ${method} ok ${ms}ms ${size}b`);
    return result;
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    error(`[rpc] ← ${method} FAILED ${ms}ms: ${stringify(e)}`);
    throw e;
  }
}
