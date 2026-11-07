/**
 * Адреса обозревателей для ссылки на транзакцию.
 *
 * ## Почему таблица, а не шаблон
 *
 * Раньше адрес собирался как `sepolia.etherscan.io` для любой тестовой сети.
 * Это неверно: транзакция в Base Sepolia живёт в `sepolia.basescan.org`, и
 * ссылка на Etherscan показала бы «транзакция не найдена» — при том, что
 * перевод прошёл. У каждой сети свой обозреватель; общего шаблона у них нет.
 *
 * ## Почему неизвестная сеть даёт `null`
 *
 * Лучше не дать ссылку вовсе, чем дать заведомо нерабочую: человек нажмёт и
 * решит, что транзакция не отправилась. Хэш он всё равно видит на экране и
 * может открыть обозреватель сам.
 */

/** Обозреватель для каждой поддерживаемой сети. */
const EXPLORERS: Record<number, string> = {
  // mainnet
  1: 'https://etherscan.io',
  10: 'https://optimistic.etherscan.io',
  56: 'https://bscscan.com',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  // тестовые
  97: 'https://testnet.bscscan.com',
  560048: 'https://hoodi.etherscan.io',
  84532: 'https://sepolia.basescan.org',
  11155111: 'https://sepolia.etherscan.io',
  11155420: 'https://sepolia-optimism.etherscan.io',
  421614: 'https://sepolia.arbiscan.io',
};

/**
 * Ссылка на транзакцию.
 *
 * @returns адрес или `null`, если для сети обозреватель неизвестен.
 */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
  // Сначала обрезаем, потом проверяем: строка из одних пробелов проходит
  // проверку на пустоту, но хэшем не является — ссылка получилась бы
  // заведомо нерабочей (`/tx/`).
  const hash = txHash.trim();
  if (!hash) return null;
  const base = EXPLORERS[chainId];
  if (!base) return null;
  return `${base}/tx/${hash}`;
}

/** Ссылка на адрес — пригодится в экране получения. */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  const value = address.trim();
  if (!value) return null;
  const base = EXPLORERS[chainId];
  if (!base) return null;
  return `${base}/address/${value}`;
}
