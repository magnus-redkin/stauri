import { statusState } from './statusStore.svelte';
import {
  startWallet,
  getSettings,
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

    // 2. Адрес кошелька
    const settings = await getSettings(port);
    const address = settings.result?.['wallet-root-address'] || '';
    walletState.address = address;
    if (!address) throw new Error('Wallet address not found');

    // 3. Метаданные токенов (symbol, decimals)
    let metadata = new Map<string, { symbol: string; decimals: number }>();
    try {
      metadata = buildMetadataMap(await getTokensForActiveNetworksMode(port));
    } catch (e) {
      console.warn('[walletStore] failed to load token metadata:', e);
    }

    // 4. Балансы
    const balanceData = await getBalances(port, [address], true);
    const byAddr = (balanceData.result ?? {}) as Record<string, any[]>;

    const key = Object.keys(byAddr).find(
      (k) => k.toLowerCase() === address.toLowerCase()
    );
    const tokens = key ? byAddr[key] : [];

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

    if (tokens.length > 0 && errored === tokens.length) {
      walletState.rpcError =
        'RPC недоступен: ни одна сеть не вернула баланс. ' +
        'Проверьте RPC-провайдеров в настройках сети.';
      console.warn(`[Wallet] Все ${tokens.length} токенов с hasError=true (RPC недоступен)`);
    } else if (errored > 0) {
      console.warn(`[Wallet] ${errored} из ${tokens.length} токенов с hasError=true`);
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
  walletState.isLoading = false;
  walletState.error = '';
  walletState.rpcError = '';
  walletState.loaded = false;
  walletState.address = '';
  walletState.balances = [];
}
