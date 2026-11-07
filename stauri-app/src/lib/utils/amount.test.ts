import { describe, it, expect } from 'vitest';
import { parseAmount, formatUnits, exceedsBalance, AmountError } from './amount';

/**
 * Разбор сумм.
 *
 * Главное, что здесь проверяется, — отказ вместо «лучшего усилия».
 * Каждый тест на исключение соответствует ошибке ввода, которая иначе
 * молча превратилась бы в неправильную сумму перевода.
 */
describe('parseAmount', () => {
  it('переводит целое число', () => {
    expect(parseAmount('12', 18)).toBe(12n * 10n ** 18n);
    expect(parseAmount('1', 6)).toBe(1000000n);
  });

  it('переводит дробь', () => {
    expect(parseAmount('0.5', 18)).toBe(500000000000000000n);
    expect(parseAmount('1.5', 6)).toBe(1500000n);
  });

  it('не теряет точность на 18 знаках', () => {
    // Именно здесь `Number` врёт: parseFloat('0.1') * 1e18 !== 1e17.
    expect(parseAmount('0.000000000000000001', 18)).toBe(1n);
    // 15 значащих цифр после запятой дополняются нулями до 18.
    expect(parseAmount('123.456789012345678', 18)).toBe(123456789012345678000n);
  });

  it('принимает запятую как разделитель', () => {
    expect(parseAmount('0,5', 18)).toBe(500000000000000000n);
  });

  it('принимает точку без целой или без дробной части', () => {
    expect(parseAmount('.5', 6)).toBe(500000n);
    expect(parseAmount('5.', 6)).toBe(5000000n);
  });

  it('обрезает пробелы вокруг', () => {
    expect(parseAmount('  2.5  ', 6)).toBe(2500000n);
  });

  it('игнорирует ведущие нули', () => {
    expect(parseAmount('007', 6)).toBe(7000000n);
    expect(parseAmount('000.5', 6)).toBe(500000n);
  });

  it('отклоняет пустой ввод', () => {
    expect(() => parseAmount('', 18)).toThrow(AmountError);
    expect(() => parseAmount('   ', 18)).toThrow(AmountError);
    expect(() => parseAmount('.', 18)).toThrow(AmountError);
  });

  it('отклоняет мусор и экспоненту', () => {
    expect(() => parseAmount('abc', 18)).toThrow(AmountError);
    expect(() => parseAmount('1e18', 18)).toThrow(AmountError);
    expect(() => parseAmount('1.2.3', 18)).toThrow(AmountError);
    expect(() => parseAmount('1 000', 18)).toThrow(AmountError);
  });

  it('отклоняет отрицательные суммы', () => {
    expect(() => parseAmount('-1', 18)).toThrow(AmountError);
  });

  it('отклоняет дробную часть, которая не помещается в decimals', () => {
    // USDC — 6 знаков. Седьмой знак — ошибка ввода, а не повод округлить.
    expect(() => parseAmount('0.1234567', 6)).toThrow(AmountError);
    expect(() => parseAmount('0.0000001', 6)).toThrow(AmountError);
  });

  it('проверяет decimals себя, а не только ввод', () => {
    expect(() => parseAmount('1', -1)).toThrow(AmountError);
    expect(() => parseAmount('1', 1.5)).toThrow(AmountError);
  });

  it('принимает decimals = 0', () => {
    expect(parseAmount('42', 0)).toBe(42n);
    expect(() => parseAmount('4.2', 0)).toThrow(AmountError);
  });
});

describe('formatUnits', () => {
  it('возвращает целое без хвоста из нулей', () => {
    expect(formatUnits(10n ** 18n, 18)).toBe('1');
    expect(formatUnits(0n, 18)).toBe('0');
  });

  it('срезает незначащие нули в дробной части', () => {
    expect(formatUnits(1500000n, 6)).toBe('1.5');
    expect(formatUnits(1000000000000000000n, 18)).toBe('1');
    expect(formatUnits(1230000000000000000n, 18)).toBe('1.23');
  });

  it('сохраняет значащие нули внутри дробной части', () => {
    expect(formatUnits(1000001n, 6)).toBe('1.000001');
  });

  it('обратен parseAmount', () => {
    for (const [value, decimals] of [
      ['0.5', 18],
      ['1.5', 6],
      ['123.456789012345678', 18],
      ['0.000001', 6],
    ] as const) {
      expect(formatUnits(parseAmount(value, decimals), decimals)).toBe(value);
    }
  });
});

describe('exceedsBalance', () => {
  it('сравнивает без переполнения', () => {
    expect(exceedsBalance(101n, 100n)).toBe(true);
    expect(exceedsBalance(100n, 100n)).toBe(false);
    expect(exceedsBalance(99n, 100n)).toBe(false);
  });

  it('работает на суммах больше 2^53', () => {
    const big = 10n ** 20n;
    expect(exceedsBalance(big + 1n, big)).toBe(true);
    expect(exceedsBalance(big, big)).toBe(false);
  });
});
