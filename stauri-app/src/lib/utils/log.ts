/**
 * Отладочный вывод для разработки.
 *
 * В production вызовы `console.*` вырезаются плагином `dropConsolePlugin`
 * (см. vite.config.js), но полагаться только на бандлер не стоит: если
 * плагин отключён или сломан, отладочные сообщения попадут пользователю.
 * Здесь дополнительная страховка — в production функции становятся no-op.
 *
 * Логирование тел запросов и ответов запрещено: ответ
 * `settings_getSettings` содержит seed-фразу.
 */

const isDev = import.meta.env.DEV;

/** @param {...unknown[]} args */
function debugImpl(...args: unknown[]) {
  // eslint-disable-next-line no-console -- модуль существует именно для этого
  console.debug(...args);
}

/** @param {...unknown[]} args */
function logImpl(...args: unknown[]) {
  // eslint-disable-next-line no-console -- модуль существует именно для этого
  console.log(...args);
}

export const debug: (...args: unknown[]) => void = isDev ? debugImpl : () => {};
export const log: (...args: unknown[]) => void = isDev ? logImpl : () => {};
