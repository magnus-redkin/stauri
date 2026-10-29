import { statusState } from './statusStore.svelte';
import {
  startWallet,
  getAccounts,
  getBalances,
  getTokensForActiveNetworksMode,
} from '$lib/status/api';

export type WalletToken = {
  symbol: string;
  decimals: number;
  balance: string;   // минимальные единицы (wei), formatBalance ожидает именно их
  chainId: number;
  tokenAddress: string;
  hasError: boolean;
};

export const walletState = $state({
  isLoading: false,
  error: '',
  loaded: false,
  address: '',
  balances: [] as WalletToken[],
  accounts: [] as any[],
  /** Заполнено, когда ни один токен не удалось получить с RPC. */
  rpcError: '',
});

/**
 * Кэш метаданных токенов (symbol, decimals) на время сессии.
 *
 * `wallet_getTokensForActiveNetworksMode` отдаёт ~4.6 МБ (17 682 токена), а
 * опрос идёт каждые 3 секунды — запрашивать это каждый раз бессмысленно.
 * Символы и decimals в рамках сессии не меняются; сбрасывается в resetWallet.
 */
let cachedMetadata: Map<string, { symbol: string; decimals: number }> | null = null;

function tokenKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

/** Карта метаданных: "chainId:адрес" -> { symbol, decimals }. */
function buildMetadataMap(tokens: any[]): Map<string, { symbol: string; decimals: number }> {
  const map = new Map<string, { symbol: string; decimals: number }>();
  for (const t of tokens) {
    const chainId = Number(t.chainId);
    const address = String(t.address || '');
    if (!Number.isFinite(chainId) || !address) continue;
    map.set(tokenKey(chainId, address), {
      symbol: String(t.symbol || ''),
      decimals: Number.isInteger(t.decimals) ? Number(t.decimals) : 18,
    });
  }
  return map;
}

/**
 * Загружает адрес кошелька и балансы.
 *
 * Формат ответа wallet_fetchOrGetCachedWalletBalances в этой версии status-go:
 *   { "0xAddr": [ { tokenAddress, tokenChainId, rawBalance, hasError } ] }
 *
 * ВАЖНО: StorageToken не содержит symbol и decimals — их даёт отдельный вызов
 * wallet_getTokensForActiveNetworksMode. Данные токена и его метаданные
 * сопоставляются по паре (chainId, tokenAddress).
 *
 * Флаг hasError означает «RPC не ответил», а не «баланс ноль». Такие токены
 * больше не отбрасываются молча: иначе недоступность сети выглядит как пустой
 * кошелёк.
 */
export async function loadWallet(force = false) {
  console.log('[walletStore] loadWallet called', {
    port: statusState.backendPort,
    loaded: walletState.loaded,
    isLoading: walletState.isLoading,
    force,
  });

  if (!statusState.backendPort) {
    console.warn('[walletStore] no backendPort, abort');
    return;
  }
  if (walletState.isLoading) {
    console.warn('[walletStore] already loading, skip');
    return;
  }
  if (walletState.loaded && !force) {
    console.log('[walletStore] already loaded, skip (use force=true to reload)');
    return;
  }

  walletState.isLoading = true;
  walletState.error = '';
  // rpcError НЕ сбрасываем здесь: иначе каждый опрос на мгновение убирает
  // плашку, UI мигает между ошибкой и списком нулей. Состояние перезапишется
  // ниже, когда придёт ответ.

  try {
    const port = statusState.backendPort;

    // 1. Старт кошелька — один раз, повторные вызовы каждые 3 с бессмысленны.
    if (!walletState.loaded) {
      const startRes = await startWallet(port);
      if (startRes && (startRes as any).error) {
        const err = (startRes as any).error;
        throw new Error(
          `wallet_startWallet: ${err.message || JSON.stringify(err)}`
        );
      }
    }

    // 2. Адреса, за которыми следит контроллер балансов.
    //
    // wallet-root-address из settings_getSettings — НЕ тот адрес, по которому
    // бэкенд считает балансы. Контроллер берёт их из keypairs_accounts
    // (GetWalletAddresses: chat = 0 AND removed = 0, internal/db/multiaccounts/
    // accounts/database.go), то есть это адреса обычных аккаунтов профиля.
    // Запрос по wallet-root-address возвращал пустой кэш: ключа такого адреса
    // в нём просто нет, и это выглядело как «все балансы с ошибкой».
    const accounts = await getAccounts(port);
    const addresses: string[] = accounts
      .filter((a: any) => a && a.address && !a.chat)
      .map((a: any) => String(a.address));

    walletState.address = addresses[0] || '';
    if (addresses.length === 0) throw new Error('Wallet address not found');

    // 3. Метаданные токенов (symbol, decimals)
    //
    // Ответ весит ~4.6 МБ (17 682 токена), а опрос идёт каждые 3 с. Символы и
    // decimals внутри сессии не меняются, поэтому берём их один раз.
    if (!cachedMetadata) {
      try {
        cachedMetadata = buildMetadataMap(await getTokensForActiveNetworksMode(port));
      } catch (e) {
        console.warn('[walletStore] failed to load token metadata:', e);
      }
    }
    const metadata =
      cachedMetadata ?? new Map<string, { symbol: string; decimals: number }>();

    // 4. Балансы — по всем адресам аккаунтов кошелька сразу.
    // Контроллер балансов считает их именно для этого набора, поэтому здесь
    // должен быть тот же список, иначе ответ придёт пустым.
    const balanceData = await getBalances(port, addresses, true);
    const byAddr = (balanceData.result ?? {}) as Record<string, any[]>;

    // Собираем токены по всем адресам: у аккаунта их обычно один, но ответ
    // содержит запись на каждый запрошенный адрес.
    const tokens: any[] = [];
    for (const addr of addresses) {
      const key = Object.keys(byAddr).find(
        (k) => k.toLowerCase() === addr.toLowerCase()
      );
      if (key && Array.isArray(byAddr[key])) tokens.push(...byAddr[key]);
    }

    let errored = 0;

    const parsed: WalletToken[] = tokens.map((t: any) => {
      const chainId = Number(t.tokenChainId);
      const tokenAddress = String(t.tokenAddress || '');
      const hasError = t.hasError === true || t.hasError === 'true';
      if (hasError) errored++;

      const meta = metadata.get(tokenKey(chainId, tokenAddress));
      const symbol =
        meta?.symbol ||
        (tokenAddress.startsWith('0x') ? tokenAddress.slice(0, 6) : 'Unknown');

      return {
        symbol,
        decimals: meta?.decimals ?? 18,
        balance: String(t.rawBalance ?? '0'),
        chainId,
        tokenAddress,
        hasError,
      };
    });

    // Сортировка: сначала токены с ненулевым балансом, затем по символу.
    parsed.sort((a, b) => {
      const aZero = a.balance === '0' ? 1 : 0;
      const bZero = b.balance === '0' ? 1 : 0;
      if (aZero !== bZero) return aZero - bZero;
      return a.symbol.localeCompare(b.symbol);
    });

    walletState.balances = parsed;
    walletState.loaded = true;

    if (tokens.length === 0) {
      // Пустой ответ — это НЕ ошибка RPC. Бэкенд вернул ноль токенов, то есть
      // каталог токенов не наполнен: спрашивать балансы было не о чем, и ни
      // один запрос к сети не уходил. Говорить здесь «RPC недоступен» значит
      // отправлять пользователя чинить провайдеров, которые ни при чём.
      walletState.rpcError =
        'Каталог токенов пуст: бэкенд не вернул ни одного токена ' +
        'для активных сетей, поэтому балансы запрашивать не о чем. ' +
        'Проверьте список токенов и активные сети.';
      console.warn(
        '[Wallet] wallet_fetchOrGetCachedWalletBalances вернул 0 токенов — ' +
        'каталог токенов пуст (это не ошибка RPC)'
      );
    } else if (errored === tokens.length) {
      walletState.rpcError =
        'RPC недоступен: ни одна сеть не вернула баланс. ' +
        'Проверьте RPC-провайдеров в настройках сети.';
      console.warn(`[Wallet] Все ${tokens.length} токенов с hasError=true (RPC недоступен)`);
    } else if (errored > 0) {
      console.warn(`[Wallet] ${errored} из ${tokens.length} токенов с hasError=true`);
    } else {
      // Всё в порядке — снимаем плашку, если она висела с прошлого опроса.
      walletState.rpcError = '';
    }

    console.log('[walletStore] ✓ loaded', {
      tokens: parsed.length,
      errored,
    });
  } catch (e: any) {
    walletState.error = e.message || 'Failed to load wallet';
    console.error('[walletStore] ✗ Wallet error:', e);
  } finally {
    walletState.isLoading = false;
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Периодическое обновление балансов.
 *
 * wallet_fetchOrGetCachedWalletBalances ЧИТАЕТ КЭШ: параметр forceRefresh в
 * status-go игнорируется (pkg/services/wallet/api.go). Поэтому баланс в UI не
 * обновится сам — кэш наполняется фоновым refresher'ом бэкенда, а нам нужно
 * его перечитывать.
 */
export function startWalletPolling(intervalMs = 3000) {
  stopWalletPolling();
  pollTimer = setInterval(() => {
    if (statusState.isLoggedIn && !walletState.isLoading) {
      loadWallet(true);
    }
  }, intervalMs);
}

export function stopWalletPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function resetWallet() {
  stopWalletPolling();
  cachedMetadata = null;
  walletState.isLoading = false;
  walletState.error = '';
  walletState.rpcError = '';
  walletState.loaded = false;
  walletState.address = '';
  walletState.balances = [];
}
