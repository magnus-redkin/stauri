/**
 * Группировка токенов для экрана «Отправить».
 *
 * ## Зачем не показывать всё
 *
 * `walletStore` намеренно хранит и нулевые балансы, и токены с `hasError`
 * (RPC не ответил): в списке активов они полезны — видно, что токен есть, но
 * баланс не получен. На экране отправки такой список мешает: 17 700
 * токенов, из которых отправить можно два. Человек ищет глазами по списку,
 * в котором почти всё недоступно.
 *
 * Поэтому здесь тот же набор делится на две группы: с чем можно отправлять
 * и что недоступно с причиной. «Недоступно» не скрываем совсем — иначе
 * пропадёт токен, на который только что пришли средства, и будет непонятно,
 * почему его нет.
 */

import { AmountError, parseAmount, type AmountErrorCode } from './amount';
import type { WalletToken } from '$lib/stores/walletStore.svelte';

/** Почему токен нельзя отправить. Пустая строка — можно. */
export type TokenBlockReason = 'no-balance' | 'rpc-error';

/**
 * Коды отказа при проверке суммы.
 *
 * Коды разбора (`AmountErrorCode`) плюс два случая, которые разбор сам не
 * видит: ноль и превышение баланса — их можно определить только зная
 * баланс токена.
 */
export type AmountCheckError = AmountErrorCode | 'amount-zero' | 'amount-insufficient';

export interface SendableToken {
  token: WalletToken;
  /** Ключ внутри группы: `chainId:address`, как и в остальном коде. */
  key: string;
  /** Причина недоступности; пусто — можно отправлять. */
  blocked: TokenBlockReason | '';
}

/**
 * Делит токены на доступные и недоступные.
 *
 * Порядок внутри групп совпадает с порядком в списке активов (ненулевые
 * сначала, затем по символу), менять его здесь не нужно: сортировку уже
 * сделал `walletStore`, а повторная сортировка по алфавиту перемешала бы
 * сети.
 */
export function groupTokensForSending(tokens: WalletToken[]): {
  available: SendableToken[];
  unavailable: SendableToken[];
} {
  const available: SendableToken[] = [];
  const unavailable: SendableToken[] = [];

  for (const token of tokens) {
    const item: SendableToken = {
      token,
      key: `${token.chainId}:${token.tokenAddress}`,
      blocked: blockReasonOf(token),
    };
    if (item.blocked) unavailable.push(item);
    else available.push(item);
  }

  return { available, unavailable };
}

/**
 * Причина, по которой токен не годится для отправки.
 *
 * `hasError` стоит первым: если RPC не ответил, про баланс ничего не
 * известно, и сказать «нет средств» было бы неправдой.
 */
export function blockReasonOf(token: WalletToken): TokenBlockReason | '' {
  if (token.hasError) return 'rpc-error';

  let balance: bigint;
  try {
    balance = BigInt(token.balance || '0');
  } catch {
    // Испорченное значение баланса — тоже недоступность, а не ноль.
    return 'rpc-error';
  }

  return balance <= 0n ? 'no-balance' : '';
}

/**
 * Проверяет, что сумма не превышает баланс токена.
 *
 * Проверка на клиенте, до обращения к сети: человек должен увидеть
 * «недостаточно средств» сразу, а не ждать ответа RPC. Это не заменяет
 * проверку бэкенда — только избавляет от лишнего шага.
 */
export function checkAmountAgainstBalance(
  raw: string,
  token: WalletToken
): { ok: true; amount: bigint } | { ok: false; error: AmountCheckError } {
  let amount: bigint;
  try {
    amount = parseAmount(raw, token.decimals);
  } catch (e) {
    // Наружу — код: интерфейс переводит его на язык пользователя. Английский
    // текст в `message` остаётся для логов.
    return {
      ok: false,
      error: e instanceof AmountError ? e.code : 'amount-invalid',
    };
  }

  if (amount <= 0n) {
    return { ok: false, error: 'amount-zero' };
  }

  if (amount > BigInt(token.balance || '0')) {
    return { ok: false, error: 'amount-insufficient' };
  }

  return { ok: true, amount };
}
