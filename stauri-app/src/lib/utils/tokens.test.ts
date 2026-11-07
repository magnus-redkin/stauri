import { describe, it, expect } from 'vitest';
import { groupTokensForSending, blockReasonOf, checkAmountAgainstBalance } from './tokens';
import type { WalletToken } from '$lib/stores/walletStore.svelte';

function token(overrides: Partial<WalletToken> = {}): WalletToken {
  return {
    symbol: 'ETH',
    decimals: 18,
    balance: '1000000000000000000',
    chainId: 1,
    tokenAddress: '0x0000000000000000000000000000000000000000',
    hasError: false,
    ...overrides,
  };
}

describe('blockReasonOf', () => {
  it('разрешает токен с положительным балансом', () => {
    expect(blockReasonOf(token())).toBe('');
  });

  it('блокирует нулевой баланс', () => {
    expect(blockReasonOf(token({ balance: '0' }))).toBe('no-balance');
  });

  it('ставит ошибку RPC выше нулевого баланса', () => {
    // Если RPC не ответил, про баланс ничего не известно: «нет средств»
    // здесь было бы неправдой.
    expect(blockReasonOf(token({ balance: '0', hasError: true }))).toBe('rpc-error');
    expect(blockReasonOf(token({ hasError: true }))).toBe('rpc-error');
  });

  it('считает испорченный баланс ошибкой RPC, а не нулём', () => {
    expect(blockReasonOf(token({ balance: 'не число' }))).toBe('rpc-error');
  });
});

describe('groupTokensForSending', () => {
  it('делит токены по доступности, сохраняя порядок', () => {
    const tokens = [
      token({ symbol: 'ETH', balance: '5' }),
      token({ symbol: 'USDC', decimals: 6, balance: '0' }),
      token({ symbol: 'DAI', chainId: 10, balance: '0', hasError: true }),
      token({ symbol: 'SNT', chainId: 10, balance: '7' }),
    ];

    const { available, unavailable } = groupTokensForSending(tokens);

    expect(available.map((i) => i.token.symbol)).toEqual(['ETH', 'SNT']);
    expect(unavailable.map((i) => i.token.symbol)).toEqual(['USDC', 'DAI']);
  });

  it('строит ключ chainId:address в нижнем регистре адреса не меняет', () => {
    const { available } = groupTokensForSending([
      token({ chainId: 10, tokenAddress: '0xAbC' }),
    ]);
    expect(available[0].key).toBe('10:0xAbC');
  });

  it('не теряет токены: сумма групп равна входу', () => {
    const tokens = [token(), token({ balance: '0' }), token({ hasError: true })];
    const { available, unavailable } = groupTokensForSending(tokens);
    expect(available.length + unavailable.length).toBe(tokens.length);
  });

  it('пустой список даёт пустые группы', () => {
    expect(groupTokensForSending([])).toEqual({ available: [], unavailable: [] });
  });
});

describe('checkAmountAgainstBalance', () => {
  it('принимает сумму в пределах баланса', () => {
    const res = checkAmountAgainstBalance('0.5', token());
    expect(res).toEqual({ ok: true, amount: 500000000000000000n });
  });

  it('принимает ровно весь баланс', () => {
    const res = checkAmountAgainstBalance('1', token());
    expect(res.ok).toBe(true);
  });

  it('отклоняет сумму больше баланса', () => {
    expect(checkAmountAgainstBalance('2', token())).toEqual({
      ok: false,
      error: 'amount-insufficient',
    });
  });

  it('отклоняет ноль', () => {
    const res = checkAmountAgainstBalance('0', token());
    expect(res.ok).toBe(false);
  });

  it('возвращает текст ошибки разбора, а не «insufficient funds»', () => {
    expect(checkAmountAgainstBalance('abc', token())).toMatchObject({
      ok: false,
      error: 'amount-invalid',
    });
    expect(checkAmountAgainstBalance('0.1234567', token({ decimals: 6 }))).toMatchObject({
      ok: false,
    });
  });

  it('сравнивает с балансом на 6 знаках корректно', () => {
    const usdc = token({ symbol: 'USDC', decimals: 6, balance: '1500000' });
    expect(checkAmountAgainstBalance('1.5', usdc).ok).toBe(true);
    expect(checkAmountAgainstBalance('1.51', usdc).ok).toBe(false);
  });
});
