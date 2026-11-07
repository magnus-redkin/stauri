import { describe, it, expect } from 'vitest';
import { explorerTxUrl, explorerAddressUrl } from './explorer';

const HASH = '0x73a222f38c1029ceedf8c3f1af94572ad3ff88abcdef0123456789abcdef0123';

describe('explorerTxUrl', () => {
  it('ведёт на обозреватель той сети, где прошла транзакция', () => {
    // Главная проверка: раньше для любой тестовой сети подставлялся
    // `sepolia.etherscan.io`, и ссылка на Base Sepolia не находила
    // транзакцию, хотя перевод прошёл.
    expect(explorerTxUrl(11155111, HASH)).toBe(`https://sepolia.etherscan.io/tx/${HASH}`);
    expect(explorerTxUrl(84532, HASH)).toBe(`https://sepolia.basescan.org/tx/${HASH}`);
    expect(explorerTxUrl(421614, HASH)).toBe(`https://sepolia.arbiscan.io/tx/${HASH}`);
    expect(explorerTxUrl(11155420, HASH)).toBe(`https://sepolia-optimism.etherscan.io/tx/${HASH}`);
    expect(explorerTxUrl(560048, HASH)).toBe(`https://hoodi.etherscan.io/tx/${HASH}`);
  });

  it('ведёт на mainnet-обозреватели', () => {
    expect(explorerTxUrl(1, HASH)).toBe(`https://etherscan.io/tx/${HASH}`);
    expect(explorerTxUrl(8453, HASH)).toBe(`https://basescan.org/tx/${HASH}`);
    expect(explorerTxUrl(42161, HASH)).toBe(`https://arbiscan.io/tx/${HASH}`);
  });

  it('не даёт ссылку для неизвестной сети', () => {
    // Лучше никакой ссылки, чем заведомо нерабочая.
    expect(explorerTxUrl(999999, HASH)).toBeNull();
  });

  it('не даёт ссылку без хэша', () => {
    expect(explorerTxUrl(1, '')).toBeNull();
    expect(explorerTxUrl(1, '   ')).toBeNull();
  });

  it('обрезает пробелы вокруг хэша', () => {
    expect(explorerTxUrl(1, ` ${HASH} `)).toBe(`https://etherscan.io/tx/${HASH}`);
  });
});

describe('explorerAddressUrl', () => {
  const ADDR = '0xcd8fd2a9f9726729d19f9be57d959942d7eb578c';

  it('строит ссылку на адрес в нужной сети', () => {
    expect(explorerAddressUrl(11155111, ADDR)).toBe(
      `https://sepolia.etherscan.io/address/${ADDR}`
    );
    expect(explorerAddressUrl(84532, ADDR)).toBe(
      `https://sepolia.basescan.org/address/${ADDR}`
    );
  });

  it('не даёт ссылку без адреса или для неизвестной сети', () => {
    expect(explorerAddressUrl(1, '')).toBeNull();
    expect(explorerAddressUrl(123456, ADDR)).toBeNull();
  });
});
