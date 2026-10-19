import { describe, it, expect } from 'vitest';
import { formatBalance } from './format';

describe('formatBalance', () => {
  it('должен возвращать "0" для нулевого баланса', () => {
    expect(formatBalance('0')).toBe('0');
    expect(formatBalance(undefined)).toBe('0');
    expect(formatBalance(null)).toBe('0');
  });

  it('должен корректно обрабатывать целые числа', () => {
    // 1 ETH = 10^18 wei
    expect(formatBalance('1000000000000000000')).toBe('1');
    // 5 ETH = 5 * 10^18 wei
    expect(formatBalance('5000000000000000000')).toBe('5');
  });

  it('должен корректно обрабатывать дробные числа', () => {
    // 1.5 ETH = 1.5 * 10^18 wei
    expect(formatBalance('1500000000000000000')).toBe('1.5');
    // 0.0001 ETH = 10^14 wei
    expect(formatBalance('100000000000000')).toBe('0.0001');
  });

  it('должен убирать лишние нули в конце дробной части', () => {
    // 1.50 ETH (в wei это 1.5 * 10^18, но с добавленным нулем)
    expect(formatBalance('1500000000000000000')).toBe('1.5'); // не "1.50"
  });

  it('должен поддерживать другие decimals (например, USDC с 6 знаками)', () => {
    // 1 USDC = 10^6
    expect(formatBalance('1000000', 6)).toBe('1');
    // 1.5 USDC = 1.5 * 10^6
    expect(formatBalance('1500000', 6)).toBe('1.5');
  });

  it('должен возвращать "0" при некорректном вводе', () => {
    // Если передать не число, BigInt выбросит исключение, и функция вернет '0'
    expect(formatBalance('invalid')).toBe('0');
  });
});
