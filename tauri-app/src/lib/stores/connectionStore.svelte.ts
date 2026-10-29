import { statusState, setAccounts, setNetworkInfo, processSignal, waitForLogin } from './statusStore.svelte';
import {
  startBackend,
  stopBackend,
  initializeApplication,
  loginAccount,
  createAccountAndLogin,
  getFlatEthereumChains,
  setChainUserRpcProvider,
  startRpcProxy,
  setRpcUpstreams,
  startMessenger,
} from '$lib/status/api';
import WebSocket from '@tauri-apps/plugin-websocket';

const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_KEY as string | undefined;

/**
 * Публичные RPC (publicnode) — основной провайдер.
 *
 * Проверено на этой машине: все пять сетей отвечают за 0.12–0.18 с.
 * Alchemy в тех же условиях молча умирает: соединение остаётся ESTAB,
 * но ответов нет (retrans ~10k, backoff в максимуме, Send-Q 192 КБ не
 * убывает), поэтому он идёт только как запасной вариант.
 */
const PUBLIC_RPC: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  10: 'https://optimism-rpc.publicnode.com',
  56: 'https://bsc-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  97: 'https://bsc-testnet-rpc.publicnode.com',
};

/** Сетевые имена Alchemy — запасной провайдер, формат https://<host>.g.alchemy.com/v2/<key> */
const ALCHEMY_HOSTS: Record<number, string> = {
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
const USER_PROVIDER_NAME = 'stauri-rpc';

/** Основной URL сети: публичный RPC, если он известен. */
function rpcUrlForChain(chainId: number): string | null {
  return PUBLIC_RPC[chainId] ?? alchemyUrlForChain(chainId);
}

/** Запасной URL: Alchemy, если для сети есть ключ. */
function alchemyUrlForChain(chainId: number): string | null {
  const host = ALCHEMY_HOSTS[chainId];
  if (host && ALCHEMY_KEY) {
    return `https://${host}.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  }
  return null;
}

/**
 * Прописывает рабочий RPC-провайдер каждой активной сети.
 *
 * Встроенные провайдеры status-go непригодны: direct-grove указывает на
 * eth.rpc.grove.city, который больше не резолвится, а direct-infura упирается
 * в таймаут. Кроме того, прямой вызов провайдера из status-go залипает на
 * мёртвых TCP-соединениях из его пула (см. src-tauri/src/rpc_proxy.rs),
 * поэтому провайдер указывает не на сеть, а на локальный форвардер:
 *   http://127.0.0.1:<port>/<chainId>
 *
 * Вызывать нужно ПОСЛЕ login и ДО первого обращения к кошельку: RPC-клиенты
 * кэшируются по chainID в internal/rpc/client.go и не инвалидируются при
 * смене провайдеров, поэтому добавление после первого запроса не подействует
 * до перезапуска ноды.
 */
export async function configureWalletRpc(port: number | null = statusState.backendPort): Promise<void> {
  if (!port) return;

  // 1. Форвардер поднимаем ПЕРВЫМ и без участия status-go.
  // Его API (networks_*) регистрируется только в initServices, то есть после
  // старта ноды, поэтому до логина вызов сетей упадёт. Форвардер же — это
  // команда Tauri, она доступна всегда, и порт должен приниматься раньше,
  // чем status-go создаст RPC-клиенты: адрес провайдера уже лежит в БД
  // прошлым запуском, и клиент может обратиться к нему сразу.
  let proxyPort: number;
  try {
    proxyPort = await startRpcProxy();
    // Пока сети не прочитаны, даём форвардеру статическую таблицу: он не
    // должен отвечать 503 на первых же запросах.
    await setRpcUpstreams(PUBLIC_RPC);
    console.log(`[configureWalletRpc] rpc proxy on 127.0.0.1:${proxyPort}`);
  } catch (e: any) {
    console.warn('[configureWalletRpc] rpc proxy failed, falling back to direct URLs:', e?.message || e);
    proxyPort = 0;
  }

  // 2. Уточняем URL по активным сетям из status-go, если он уже поднят.
  let chains: any[];
  try {
    chains = await getFlatEthereumChains(port);
  } catch (e) {
    // До старта ноды сервис сетей ещё не зарегистрирован — это не ошибка,
    // форвардер уже работает со статической таблицей.
    console.log('[configureWalletRpc] networks API not ready yet:', e);
    return;
  }

  const upstreams: Record<number, string> = { ...PUBLIC_RPC };
  for (const chain of chains) {
    const chainId = Number(chain?.chainId);
    if (!chainId || !chain.enabled || !chain.isActive) continue;
    const url = rpcUrlForChain(chainId);
    if (url) upstreams[chainId] = url;
  }

  if (proxyPort) {
    try {
      await setRpcUpstreams(upstreams);
    } catch (e: any) {
      console.warn('[configureWalletRpc] failed to update proxy upstreams:', e?.message || e);
    }
  }

  for (const chain of chains) {
    const chainId = Number(chain?.chainId);
    // Имена полей — как в params.Network: enabled и isActive (не active!).
    if (!chainId || !chain.enabled || !chain.isActive) continue;

    const direct = upstreams[chainId];
    if (!direct) continue;

    // Через форвардер идём, если он поднялся; иначе — напрямую.
    const url = proxyPort
      ? `http://127.0.0.1:${proxyPort}/${chainId}`
      : direct;

    // Сверяемся по URL, а не только по имени: провайдер мог остаться от
    // прошлой конфигурации (например, с мёртвым на этой машине Alchemy),
    // и тогда его нужно перезаписать.
    const existing = (chain.rpcProviders || []).find(
      (p: any) => p.type === 'user' && p.name === USER_PROVIDER_NAME
    );
    if (existing && existing.url === url) continue;

    try {
      await setChainUserRpcProvider(port, chainId, USER_PROVIDER_NAME, url);
      console.log(
        `[configureWalletRpc] chain ${chainId}: provider ` +
        (existing ? 'updated' : 'added')
      );
    } catch (e: any) {
      console.warn(`[configureWalletRpc] chain ${chainId} failed:`, e?.message || e);
    }
  }
}

export const connectionState = $state({
  isConnecting: false,
  selectedNetwork: 'mainnet',
});

let ws: WebSocket | null = null;

/**
 * Запускает бэкенд, подключает WS и загружает аккаунты.
 */
export async function connect(network?: string) {
  if (statusState.isConnected || connectionState.isConnecting) return;

  if (statusState.backendPort) {
    await disconnect();
  }

  connectionState.isConnecting = true;
  statusState.errorMsg = '';

  try {
    const backendInfo = await startBackend(network);
    statusState.backendPort = backendInfo.port;
    statusState.backendDataDir = backendInfo.dataDir;
    connectionState.selectedNetwork = backendInfo.networkName;

    await new Promise(resolve => setTimeout(resolve, 1500));

    const initData = await initializeApplication(
      statusState.backendPort,
      statusState.backendDataDir,
      backendInfo.chainId
    );

    if (initData.accounts && initData.accounts.length > 0) {
      setAccounts(initData.accounts);
    } else {
      setAccounts([]);
    }

    setNetworkInfo(
      backendInfo.networkName,
      backendInfo.rpcUrl,
      backendInfo.wakuFleet,
      backendInfo.isTestnet,
      backendInfo.chainId
    );

    await reconnectWs(statusState.backendPort);
    statusState.isConnected = true;

    // Провайдеры прописываем сразу после инициализации — ДО логина.
    // RPC-клиенты status-go кэшируются по chainID и не инвалидируются,
    // поэтому если клиент создан раньше (например, messenger'ом или
    // фоновым refresher'ом), смена провайдера уже не подействует.
    await configureWalletRpc(backendInfo.port);

    // FIX: Блок preferences_set удалён отсюда.
    // Сети регистрируются в processSignal ПОСЛЕ node.login через ensureNetworksConfigured,
    // иначе LoginAccount перезатирает настройки.

  } catch (e: any) {
    statusState.errorMsg = `Connection failed: ${e?.message || e}`;
    statusState.isConnected = false;
  } finally {
    connectionState.isConnecting = false;
  }
}

/**
 * Перезапускает бэкенд для новой сети.
 */
export async function changeNetwork(network: string) {
  await disconnect();
  await connect(network);
}

/**
 * Подключает WebSocket.
 */
async function reconnectWs(port: number) {
  if (ws) {
    try { await ws.disconnect(); } catch (e) {}
    ws = null;
  }
  ws = await WebSocket.connect(`ws://127.0.0.1:${port}/signals`);
  ws.addListener((msg) => {
    // msg.data приходит как string | number[] | CloseFrame | null
    if (typeof msg.data === 'string') processSignal(msg.data);
  });
}

/**
 * Вход в аккаунт.
 *
 * Порядок важен: сначала прописываем RPC-провайдеры (configureWalletRpc),
 * и только потом стартуем messenger. RPC-клиенты status-go кэшируются по
 * chainID и не инвалидируются, поэтому messenger, запущенный раньше, создаст
 * клиентов с прежними (мёртвыми) URL, и балансы останутся с hasError.
 */
export async function login(password: string, keyUid: string) {
  if (!statusState.backendPort) return;
  if (!ws) await reconnectWs(statusState.backendPort);
  await loginAccount(statusState.backendPort, password, keyUid);
  await waitForLogin(30000);
  await configureWalletRpc();
  await startMessenger(statusState.backendPort);
}

/**
 * Создание аккаунта.
 */
export async function createAccount(password: string) {
  if (!statusState.backendPort) return;
  if (!ws) await reconnectWs(statusState.backendPort);
  const createResult = await createAccountAndLogin(
    statusState.backendPort,
    statusState.backendDataDir,
    password
  );
  if (createResult?.error) throw new Error(createResult.error);
  await waitForLogin(30000);
  await configureWalletRpc();
  await startMessenger(statusState.backendPort);
}

/**
 * Отключает WS и останавливает бэкенд.
 */
export async function disconnect() {
  if (ws) {
    try { await ws.disconnect(); } catch (e) {}
    ws = null;
  }
  if (statusState.backendPort) {
    try { await stopBackend(); } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 500));
  statusState.isConnected = false;
  statusState.backendPort = null;
}
