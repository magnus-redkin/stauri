/**
 * Перевод сумм между тем, что видит человек, и тем, что принимает сеть.
 *
 * ## Почему `BigInt`, а не `Number`
 *
 * Минимальные единицы токена — целые числа, и у ETH это 18 знаков после
 * запятой. `Number` хранит 53 бита точно, то есть примерно 15–16 значащих
 * цифр: `0.1` в нём вообще не представимо, а `1e18` уже неточно. Отправка
 * через `parseFloat(amount) * 10 ** decimals` даёт сумму, не равную
 * введённой, и разница тем заметнее, чем больше знаков.
 *
 * Здесь всё считается целыми: строка разбирается поточечно, без
 * промежуточного `Number`. `Number` используется только там, где значение
 * заведомо мало (длина строки, количество цифр).
 *
 * ## Почему ошибки, а не «лучшее усилие»
 *
 * Функция разбора сидит на пути отправки денег. Молча «округлить» или
 * «принять что получилось» здесь недопустимо: пользователь увидит на экране
 * одно, а уйдёт другое. Всё, что не удалось разобрать однозначно, —
 * исключение.
 */

/**
 * Причина отказа разбора.
 *
 * Код, а не готовый текст: интерфейс переводит его на язык пользователя.
 * Сообщение в `message` остаётся английским — оно для логов.
 */
export type AmountErrorCode =
  | 'amount-empty'
  | 'amount-invalid'
  | 'amount-too-many-decimals'
  | 'amount-bad-decimals';

/** Ошибка разбора суммы. `code` — то, что показывает интерфейс. */
export class AmountError extends Error {
  readonly code: AmountErrorCode;

  constructor(code: AmountErrorCode, message: string) {
    super(message);
    this.name = 'AmountError';
    this.code = code;
  }
}

/**
 * Разбирает введённую сумму в минимальные единицы токена.
 *
 * Принимает то, что человек реально печатает:
 *   * `0.5`, `12`, `0,5` (запятая — распространённая раскладка);
 *   * `.5` и `5.` — как обычный калькулятор, `5.` означает `5`.
 *
 * Отклоняет:
 *   * пустую строку, `NaN`, буквы, два разделителя, экспоненту;
 *   * минус (отправка отрицательной суммы — не то, что имелось в виду);
 *   * больше знаков после запятой, чем есть у токена: `0.1234567` при
 *     `decimals = 6` — это не «0.123456», а ошибка ввода. Округление
 *     вниз потеряло бы часть суммы незаметно для человека.
 *
 * @param raw строка из поля ввода
 * @param decimals количество знаков после запятой у токена
 * @returns сумма в минимальных единицах (wei и т. п.)
 */
export function parseAmount(raw: string, decimals: number): bigint {
  const value = String(raw ?? '').trim().replace(',', '.');

  if (!value) throw new AmountError('amount-empty', 'Enter an amount');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new AmountError('amount-bad-decimals', `Invalid token decimals: ${decimals}`);
  }

  // Цифры, не более одного разделителя. Всё остальное — ошибка ввода:
  // `1e18`, `1.2.3`, `-1`, `1 000` сюда не проходят.
  const match = value.match(/^(\d*)(?:\.(\d*))?$/);
  if (!match) throw new AmountError('amount-invalid', 'Enter a valid number');

  const [, wholeRaw = '', fracRaw = ''] = match;
  if (!wholeRaw && !fracRaw) throw new AmountError('amount-empty', 'Enter an amount');

  if (fracRaw.length > decimals) {
    throw new AmountError(
      'amount-too-many-decimals',
      `Too many decimals: this token has ${decimals}`
    );
  }

  // Ведущие нули не нужны: `007` и `7` — одно и то же число, а длинные
  // строки только замедляют BigInt.
  const whole = wholeRaw.replace(/^0+/, '') || '0';
  const frac = fracRaw.padEnd(decimals, '0');

  return BigInt(whole + frac);
}

/**
 * Обратное преобразование: минимальные единицы в строку для показа.
 *
 * Без ведущих нулей и без хвоста из нулей: `1000000000000000000` при
 * `decimals = 18` даёт `"1"`, а `1500000` при `decimals = 6` — `"1.5"`.
 * Это — точное представление, не для экрана; округление для показа делает
 * `formatBalance` в `utils/format.ts`.
 *
 * @param units сумма в минимальных единицах
 * @param decimals количество знаков после запятой у токена
 */
export function formatUnits(units: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new AmountError('amount-bad-decimals', `Invalid token decimals: ${decimals}`);
  }

  const negative = units < 0n;
  const abs = negative ? -units : units;

  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;

  const fracStr = frac === 0n
    ? ''
    : '.' + frac.toString().padStart(decimals, '0').replace(/0+$/, '');

  return (negative ? '-' : '') + whole.toString() + fracStr;
}

/**
 * Сравнивает сумму с балансом в тех же единицах.
 *
 * Нужна на шаге проверки отправки: перевод больше баланса должен
 * отклоняться до обращения к сети, с понятным текстом, а не ответом RPC
 * «insufficient funds».
 */
export function exceedsBalance(amount: bigint, balance: bigint): boolean {
  return amount > balance;
}
