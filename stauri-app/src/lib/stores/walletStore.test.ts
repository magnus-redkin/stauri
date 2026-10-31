import { describe, it, expect, vi, beforeEach } from 'vitest';
import { walletState, loadWallet, resetWallet } from './walletStore.svelte';
import { statusState } from './statusStore.svelte';
import { startWallet, getAccounts, getBalances, getTokensForActiveNetworksMode } from '$lib/status/api';

// Мокаем API
vi.mock('$lib/status/api', () => ({
  startWallet: vi.fn(),
  getAccounts: vi.fn(),
  getBalances: vi.fn(),
  getTokensForActiveNetworksMode: vi.fn(),
}));

// Мокаем statusState
vi.mock('./statusStore.svelte', () => ({
  statusState: { backendPort: 12345, isLoggedIn: true },
}));

/** Метаданные в том виде, в каком их отдаёт status-go. */
const mockMetadata = [
  { chainId: 1, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
  { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
];

/**
 * Аккаунты в том виде, в каком их отдаёт accounts_getAccounts.
 * chat=true — адрес для чатов, кошелька у него нет и балансы по нему не считаются.
 */
const mockAccounts = [
  { address: '0xCHAT', chat: true, name: '' },
  { address: '0xABC123', chat: false, name: 'Account 1' },
];

describe('walletStore', () => {
  beforeEach(() => {
    resetWallet();
    vi.clearAllMocks();
    (startWallet as any).mockResolvedValue({});
    (getAccounts as any).mockResolvedValue(mockAccounts);
    (getTokensForActiveNetworksMode as any).mockResolvedValue(mockMetadata);
  });

  it('должен загружать адрес и балансы', async () => {
    (getBalances as any).mockResolvedValue({
      result: {
        '0xABC123': [
          { tokenAddress: '0x0000000000000000000000000000000000000000', tokenChainId: 1, rawBalance: '1000000000000000000', hasError: false },
          { tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', tokenChainId: 1, rawBalance: '5000000', hasError: false },
        ],
      },
    });

    await loadWallet();

    expect(walletState.address).toBe('0xABC123');
    expect(walletState.balances).toHaveLength(2);
    const symbols = walletState.balances.map(t => t.symbol).sort();
    expect(symbols).toEqual(['ETH', 'USDC']);
    expect(walletState.loaded).toBe(true);
    expect(walletState.isLoading).toBe(false);
  });

  it('подставляет symbol и decimals из метаданных токенов', async () => {
    (getBalances as any).mockResolvedValue({
      result: {
        '0xABC123': [
          { tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', tokenChainId: 1, rawBalance: '5000000', hasError: false },
        ],
      },
    });

    await loadWallet();

    expect(walletState.balances[0].symbol).toBe('USDC');
    expect(walletState.balances[0].decimals).toBe(6);
  });

  it('должен сохранять нулевые балансы, а не выбрасывать их', async () => {
    (getBalances as any).mockResolvedValue({
      result: {
        '0xABC123': [
          { tokenAddress: '0x0000000000000000000000000000000000000000', tokenChainId: 1, rawBalance: '0', hasError: false },
          { tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', tokenChainId: 1, rawBalance: '5000000', hasError: false },
        ],
      },
    });

    await loadWallet();

    expect(walletState.balances).toHaveLength(2);
    // Ненулевой баланс идёт первым
    expect(walletState.balances[0].symbol).toBe('USDC');
    expect(walletState.balances[1].balance).toBe('0');
  });

  it('показывает ошибку RPC, когда все токены с hasError', async () => {
    (getBalances as any).mockResolvedValue({
      result: {
        '0xABC123': [
          { tokenAddress: '0x0000000000000000000000000000000000000000', tokenChainId: 1, rawBalance: '0', hasError: true },
        ],
      },
    });

    await loadWallet();

    expect(walletState.rpcError).toContain('RPC');
    expect(walletState.balances).toHaveLength(1);
    expect(walletState.balances[0].hasError).toBe(true);
  });

  it('показывает сообщение о пустом каталоге токенов', async () => {
    // Пустой ответ — это НЕ ошибка RPC: каталог не наполнен, спрашивать нечего.
    (getBalances as any).mockResolvedValue({ result: {} });

    await loadWallet();

    expect(walletState.rpcError).toContain('аталог токенов пуст');
    expect(walletState.balances).toHaveLength(0);
  });

  it('запрашивает метаданные токенов один раз, а не на каждом опросе', async () => {
    (getBalances as any).mockResolvedValue({
      result: {
        '0xABC123': [
          { tokenAddress: '0x0000000000000000000000000000000000000000', tokenChainId: 1, rawBalance: '0', hasError: false },
        ],
      },
    });

    await loadWallet();
    await loadWallet(true);
    await loadWallet(true);

    // Ответ весит ~4.6 МБ, поэтому второй и третий опрос не должны его тянуть.
    expect(getTokensForActiveNetworksMode).toHaveBeenCalledTimes(1);
  });

  it('не выставляет rpcError, когда часть токенов загрузилась', async () => {
    (getBalances as any).mockResolvedValue({
      result: {
        '0xABC123': [
          { tokenAddress: '0x0000000000000000000000000000000000000000', tokenChainId: 1, rawBalance: '1', hasError: false },
          { tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', tokenChainId: 1, rawBalance: '0', hasError: true },
        ],
      },
    });

    await loadWallet();

    expect(walletState.rpcError).toBe('');
  });

  it('должен выбрасывать ошибку, если адрес не найден', async () => {
    // Только чат-адрес: у него нет кошелька, поэтому кошелёк-адресов не остаётся.
    (getAccounts as any).mockResolvedValue([{ address: '0xCHAT', chat: true }]);

    await loadWallet();

    expect(walletState.error).toContain('Wallet address not found');
    expect(walletState.loaded).toBe(false);
  });

  it('не должен загружать, если loaded=true и force=false', async () => {
    walletState.loaded = true;
    await loadWallet();
    expect(startWallet).not.toHaveBeenCalled();
  });

  it('должен сбрасывать состояние', () => {
    walletState.address = '0xABC';
    walletState.balances = [{ symbol: 'ETH', decimals: 18, balance: '1', chainId: 1, tokenAddress: '0x0', hasError: false }];
    walletState.loaded = true;
    walletState.rpcError = 'err';

    resetWallet();

    expect(walletState.address).toBe('');
    expect(walletState.balances).toHaveLength(0);
    expect(walletState.loaded).toBe(false);
    expect(walletState.rpcError).toBe('');
  });
});
