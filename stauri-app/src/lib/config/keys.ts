/**
 * Единая точка чтения конфигурации ключей и адресов.
 *
 * Раньше `import.meta.env` был размазан по трём файлам: `ALCHEMY_KEY` в
 * `connectionStore`, `INFURA_KEY` в `status/api`, лог-настройки там же.
 * Из-за этого нельзя было одним взглядом ответить, какие секреты вообще
 * попадают в бандл.
 *
 * Важно понимать, что происходит при сборке: Vite инлайнит переменные
 * `VITE_*` в код. Значит любой ключ из этого файла физически находится
 * внутри бандла и извлекается из собранного AppImage. Это не секреты —
 * это идентификаторы с квотой, и защищать их надо лимитами на стороне
 * провайдера, а не сокрытием.
 */

/** Ключ Alchemy. Используется для сборки RPC-URL, когда публичный RPC неизвестен. */
export const ALCHEMY_KEY: string | undefined = import.meta.env.VITE_ALCHEMY_KEY;

/**
 * Токен Infura.
 *
 * Передаётся в status-go как `infuraToken`: из него берётся VerifyENSURL
 * (pkg/backend/defaults.go, getMainnetRPCURL) для проверки ENS-имён.
 * Без токена getMainnetRPCURL возвращает пустую строку, и ENS-верификация
 * молча пропускается (internal/protocol/ens/verifier.go).
 */
export const INFURA_KEY: string | undefined = import.meta.env.VITE_INFURA_KEY;

/**
 * Уровень логирования status-go. Не задан — логирование выключено.
 *
 * Разработчику: `VITE_STATUS_LOG=debug` в `.env`. Включать в релизе нельзя:
 * status.log пишет полные URL RPC-провайдеров вместе с ключами.
 */
export const STATUS_LOG_LEVEL: string | undefined = import.meta.env.VITE_STATUS_LOG;

/** Путь к файлу лога. По умолчанию `${dataDir}/status.log`. */
export const STATUS_LOG_FILE: string | undefined = import.meta.env.VITE_STATUS_LOG_FILE;

/**
 * Публичные RPC (publicnode) — основной провайдер.
 *
 * Проверено на этой машине: все пять сетей отвечают за 0.12–0.18 с.
 * Alchemy в тех же условиях молча умирает: соединение остаётся ESTAB,
 * но ответов нет (retrans ~10k, backoff в максимуме, Send-Q 192 КБ не
 * убывает), поэтому он идёт только как запасной вариант.
 */
export const PUBLIC_RPC: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  10: 'https://optimism-rpc.publicnode.com',
  56: 'https://bsc-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  // Тестовые сети. Нужны, потому что с включённым `test-networks-enabled?`
  // status-go считает активными именно их, и без адреса сеть остаётся без
  // провайдера — баланс по ней не приходит вовсе.
  97: 'https://bsc-testnet-rpc.publicnode.com',
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  11155420: 'https://optimism-sepolia-rpc.publicnode.com',
  84532: 'https://base-sepolia-rpc.publicnode.com',
  421614: 'https://arbitrum-sepolia-rpc.publicnode.com',
  560048: 'https://ethereum-hoodi-rpc.publicnode.com',
};

/** Сетевые имена Alchemy — формат https://<host>.g.alchemy.com/v2/<key> */
export const ALCHEMY_HOSTS: Record<number, string> = {
  1: 'eth-mainnet',
  10: 'opt-mainnet',
  8453: 'base-mainnet',
  42161: 'arb-mainnet',
  11155111: 'eth-sepolia',
  11155420: 'opt-sepolia',
  84532: 'base-sepolia',
  421614: 'arb-sepolia',
};

/** Имя нашего user-провайдера: по нему же проверяем, не добавлен ли он уже. */
export const USER_PROVIDER_NAME = 'stauri-rpc';

/** Запасной URL сети: Alchemy, если для неё есть ключ. */
export function alchemyUrlForChain(chainId: number): string | null {
  const host = ALCHEMY_HOSTS[chainId];
  if (host && ALCHEMY_KEY) {
    return `https://${host}.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  }
  return null;
}

/** Основной URL сети: публичный RPC, если он известен, иначе Alchemy. */
export function rpcUrlForChain(chainId: number): string | null {
  return PUBLIC_RPC[chainId] ?? alchemyUrlForChain(chainId);
}
