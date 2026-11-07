/**
 * Состояние отправки средств.
 *
 * ## Где живёт пароль
 *
 * Пароль профиля нужен на каждом переводе: status-go разблокирует ключ им
 * (`wallet_signMessage` → `gethManager.LoadAccount`). Пользователь вводит его
 * **один раз за сессию**, как в мобильном Status, и дальше он хранится здесь,
 * в памяти фронтенда, до выхода из аккаунта.
 *
 * Это осознанный выбор с известной ценой: при XSS пароль доступен скрипту.
 * Поэтому сам перевод идёт через команду Rust `send_transfer` — пароль
 * передаётся в неё на время вызова, а подпись и сборка транзакции наружу не
 * выставлены. Так у чужого скрипта нет ни универсальной машинки подписи, ни
 * сохранённого пароля на диске.
 *
 * На диск пароль НЕ пишется никогда. `resetSend()` вызывается при выходе из
 * аккаунта.
 *
 * ## Почему шаги, а не одна форма
 *
 * Между «ввёл» и «улетело» нужен экран, где видно всё, что уйдёт: сеть,
 * актив, сумму, получателя и комиссию. Это последняя возможность заметить,
 * что адрес не тот. Кнопка «Отправить» на этом экране фиксирует намерение,
 * и только после неё начинается работа с ключом.
 */

import { invoke } from '@tauri-apps/api/core';
import { statusState } from './statusStore.svelte';
import { loadWallet, walletState, type WalletToken } from './walletStore.svelte';
import { restartWalletReloadTimer } from '$lib/status/wallet';
import { debug, info, warn } from '$lib/utils/log';
import { formatError } from '$lib/utils/errors';

export type SendStep = 'form' | 'confirm' | 'sending' | 'sent' | 'failed';

export const sendState = $state({
  step: 'form' as SendStep,
  /** Пароль сессии. В памяти, не на диске. */
  password: '',
  /** Пароль запрашивается у пользователя — показывается поле ввода. */
  needsPassword: false,
  isSending: false,
  error: '',
  /** Хэш отправленной транзакции — для ссылки в обозреватель. */
  txHash: '',
});

/** Забыть пароль. Вызывается при выходе из аккаунта и смене профиля. */
export function resetSend(): void {
  sendState.step = 'form';
  sendState.password = '';
  sendState.needsPassword = false;
  sendState.isSending = false;
  sendState.error = '';
  sendState.txHash = '';
}

/** Сохранить пароль в памяти сессии (после успешного ввода). */
export function rememberPassword(password: string): void {
  sendState.password = password;
  sendState.needsPassword = false;
}

export interface TransferInput {
  token: WalletToken;
  /** Адрес получателя, уже проверенный на форме. */
  to: string;
  /** Сумма в минимальных единицах. */
  amount: bigint;
}

/**
 * Отправляет перевод.
 *
 * ## Почему вся последовательность — в Rust
 *
 * `send_transfer` делает три вызова status-go: собрать, подписать, отправить.
 * Если бы их делал фронтенд, вебвью пришлось бы вызывать `wallet_signMessage`
 * напрямую, а это универсальная подпись произвольных байтов ключом кошелька.
 * См. шапку `src-tauri/src/transfer.rs`.
 *
 * ## Почему баланс обновляем после отправки
 *
 * Кэш бэкенда обновляет фоновый контроллер, а не наш запрос
 * (`forceRefresh` в `wallet_fetchOrGetCachedWalletBalances` игнорируется).
 * Поэтому после отправки запускаем полный перезапрос и перечитываем.
 */
export async function sendTransfer(input: TransferInput): Promise<boolean> {
  const port = statusState.backendPort;
  if (!port || !walletState.address) {
    sendState.error = 'Wallet is not ready';
    sendState.step = 'failed';
    return false;
  }

  if (!sendState.password) {
    sendState.needsPassword = true;
    sendState.error = '';
    return false;
  }

  sendState.isSending = true;
  sendState.step = 'sending';
  sendState.error = '';

  try {
    const result = await invoke<{ tx_hash: string }>('send_transfer', {
      request: {
        port,
        chain_id: input.token.chainId,
        from: walletState.address,
        to: input.to,
        token_address: input.token.tokenAddress,
        amount: input.amount.toString(),
        password: sendState.password,
      },
    });

    sendState.txHash = result?.tx_hash ?? '';
    sendState.step = 'sent';
    info(`[send] sent ${input.amount} of ${input.token.symbol} on ${input.token.chainId}`);

    // Баланс после перевода: перезапрос в фоне, затем чтение.
    void refreshAfterSend();
    return true;
  } catch (e) {
    // Неверный пароль — самый частый отказ. Стираем сохранённый, чтобы
    // следующий раз спросить заново, а не повторять неудачу молча.
    const message = formatError(e, 'Failed to send');
    if (looksLikeWrongPassword(message)) {
      // Стираем сохранённый пароль и просим ввести снова: повторять заведомо
      // неудачную попытку молча — худшее, что можно сделать на этом экране.
      sendState.password = '';
      sendState.needsPassword = true;
    }

    sendState.error = message;
    sendState.step = 'failed';
    warn('[send] failed:', e);
    return false;
  } finally {
    sendState.isSending = false;
  }
}

/**
 * Похоже ли сообщение status-go на неверный пароль.
 *
 * Текст приходит из `gethManager.LoadAccount` и не имеет кода, поэтому
 * различаем по подстроке. Ошибиться здесь не страшно: мы всего лишь стираем
 * пароль сессии и просим ввести снова — это не ломает отправку.
 */
function looksLikeWrongPassword(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('decrypt') ||
    m.includes('password') ||
    m.includes('authentication')
  );
}

/** Обновление баланса после отправки. Ошибку не показываем: она вторична. */
async function refreshAfterSend(): Promise<void> {
  try {
    // Даём сети принять транзакцию, затем просим бэкенд перезапросить всё.
    await new Promise((r) => setTimeout(r, 3000));
    if (statusState.backendPort) {
      await restartWalletReloadTimer(statusState.backendPort);
      await new Promise((r) => setTimeout(r, 2000));
      await loadWallet(true);
    }
  } catch (e) {
    debug('[send] balance refresh after send failed:', e);
  }
}

/** Возвращает форму на шаг ввода — используется кнопкой «Изменить». */
export function backToForm(): void {
  sendState.step = 'form';
  sendState.error = '';
  sendState.txHash = '';
}
