import { invoke } from "@tauri-apps/api/core";
import { debug } from '$lib/utils/log';
import { INFURA_KEY, STATUS_LOG_LEVEL, STATUS_LOG_FILE } from '$lib/config/keys';
import { statusFetch } from "./http";
import type { StartBackendResponse } from "./types";

debug('[api] INFURA_KEY loaded:', !!INFURA_KEY);

/**
 * Токен аутентифицирующего прокси.
 *
 * Кэшируется на время жизни страницы: Rust отдаёт один и тот же токен
 * всё время работы приложения. Запрашиваем лениво — только когда реально
 * нужен первый запрос.
 */
let authToken: string | null = null;

export async function getAuthToken(): Promise<string> {
  if (authToken) return authToken;
  authToken = await invoke<string>('auth_proxy_token');
  return authToken;
}

/**
 * Секреты для LoginAccount / CreateAccountAndLogin.
 *
 * Ключи проверены по исходникам status-go:
 *
 * alchemyApiKey сюда НЕ передаётся. В status-go он идёт единственным
 * потребителем — collectibles-клиентом (pkg/services/wallet/service.go,
 * alchemy.NewClient), а NFT/коллекции в Stauri не реализованы. Сам ключ
 * при этом остаётся в бандле: его использует connectionStore для сборки
 * RPC-URL, поэтому убирать его из .env нельзя.
 *
 * infuraToken передаётся и нужен: из него status-go берёт VerifyENSURL
 * (pkg/backend/defaults.go, getMainnetRPCURL) для проверки ENS-имён и
 * подставляет его как AuthToken в direct-провайдер mainnet.infura.io.
 * Без токена getMainnetRPCURL возвращает пустую строку, и ENS-верификация
 * в internal/protocol/ens/verifier.go молча пропускается.
 */
function walletSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};

  if (INFURA_KEY) secrets.infuraToken = INFURA_KEY;

  return secrets;
}

/**
 * Вход в существующий аккаунт.
 * statusProxyStageName: "prod" — валидный stage name для status-go.
 * "mainnet" — не stage, а имя сети; с ним URL прокси получаются битыми
 * (https://mainnet.api.status.im/...), и RPC-клиенты не создаются.
 */
export async function loginAccount(
  port: number,
  password: string,
  keyUid: string
): Promise<any> {
  const payload: Record<string, any> = {
    password,
    keyUid,
    statusProxyStageName: 'prod',
    ...walletSecrets(),
  };
  debug('[Login] payload keys:', Object.keys(payload));
  return await statusFetch(port, "LoginAccount", payload);
}

/**
 * Логирование status-go отключено по умолчанию.
 *
 * status.log писался на уровне DEBUG при каждом запуске и складывал в
 * ~/.local/share/... полные URL RPC-провайдеров вместе с API-ключами
 * (Alchemy передаёт ключ в пути запроса). Это утечка секрета на диск
 * пользователя: файл переживает перезапуски и его легко приложить
 * к баг-репорту.
 *
 * Разработчику: задайте VITE_STATUS_LOG=debug (и при необходимости
 * VITE_STATUS_LOG_FILE=/abs/path) в .env — тогда лог включится.
 * Сами значения читаются в $lib/config/keys.
 */
function loggingConfig(dataDir: string): Record<string, unknown> {
  if (!STATUS_LOG_LEVEL) {
    return { logEnabled: false };
  }
  return {
    logEnabled: true,
    logLevel: STATUS_LOG_LEVEL,
    logFilePath: STATUS_LOG_FILE ?? `${dataDir}/status.log`,
  };
}

/**
 * Создает аккаунт и логинит в него.
 * thirdpartyServicesEnabled: true — включает RPC-провайдеров в BuildDefaultNetworks.
 * statusProxyStageName: "prod" — валидный stage name.
 * alchemyApiKey / infuraToken — из WalletSecretsConfig (плоские поля на верхнем уровне).
 */
export async function createAccountAndLogin(
  port: number,
  dataDir: string,
  password: string
): Promise<any> {
  const payload: Record<string, any> = {
    rootDataDir: dataDir,
    displayName: "Stauri User",
    password,
    customizationColor: "primary",
    thirdpartyServicesEnabled: true,
    statusProxyStageName: 'prod',
    ...loggingConfig(dataDir),
    ...walletSecrets(),
  };
  debug('[CreateAccount] payload keys:', Object.keys(payload));
  return await statusFetch(port, "CreateAccountAndLogin", payload);
}


export async function startBackend(network?: string): Promise<StartBackendResponse> {
  return await invoke<StartBackendResponse>('start_backend', { network });
}

export async function stopBackend(): Promise<void> {
  await invoke('stop_backend');
}

// ==========================================
// ЛОКАЛЬНЫЙ RPC-ФОРВАРДЕР
// ==========================================

/**
 * Запускает локальный HTTP-форвардер и возвращает его порт.
 *
 * Нужен из-за залипания TCP-соединений в пуле status-go: сокет остаётся
 * ESTAB, ответов нет, запрос висит до таймаута circuit breaker'а.
 * Форвардер открывает свежее соединение на каждый запрос (как curl).
 *
 * `upstreams` передаётся сразу: провайдер с прошлого запуска уже лежит в БД
 * status-go и указывает на наш порт, поэтому первый запрос может прийти раньше
 * любой второй команды. Форвардер без таблицы отвечает 503.
 */
export async function startRpcProxy(upstreams: Record<number, string> = {}): Promise<number> {
  return await invoke<number>('start_rpc_proxy', { upstreams });
}

/**
 * Секрет пути форвардера.
 *
 * В форвардер ходит `status-go`, а не наш фронтенд, поэтому защита живёт в
 * самом URL: `http://127.0.0.1:<port>/<секрет>/<chainId>`. Заголовок нода
 * послать не может.
 *
 * `null` — форвардер ещё не запущен.
 */
export async function getRpcProxySecret(): Promise<string | null> {
  return await invoke<string | null>('rpc_proxy_secret');
}

/** Задаёт upstream-URL для каждой сети: map chainId -> URL провайдера. */
export async function setRpcUpstreams(upstreams: Record<number, string>): Promise<void> {
  await invoke('set_rpc_upstreams', { upstreams });
}

export async function stopRpcProxy(): Promise<void> {
  await invoke('stop_rpc_proxy');
}

export async function initializeApplication(port: number, dataDir: string, networkId: number): Promise<any> {
  return await statusFetch(port, "InitializeApplication", {
    dataDir: dataDir,
    NetworkID: networkId,
  });
}

export async function startMessenger(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 1,
    method: "wakuext_startMessenger",
    params: []
  });
}

// ensureNetworksConfigured() удалена.
//
// Она жёстко прописывала preferences_set → networks/networks с прямым
// Infura/Alchemy-эндпоинтом в обход локального RPC-форвардера и осталась
// без вызовов после того, как configureWalletRpc() в connectionStore взял
// эту роль на себя. Держать её было опасно: при случайном вызове она
// возвращала прямой провайдер и обнуляла обход залипающих соединений,
// ради которого написан src-tauri/src/rpc_proxy.rs.
//
// Сети и провайдеры теперь настраиваются только через
// configureWalletRpc() → setChainUserRpcProvider() → http://127.0.0.1:<port>/<chainId>.


// ==========================================
// КОШЕЛЁК И ENS
// ==========================================
//
// Обёртки `wallet_*`, `ens_*` и настройки RPC-провайдеров переехали в
// `wallet.ts`: кошелёк — отдельная граница status-go, и держать её в одном
// месте нужно, чтобы при переходе на Logos менять было нечего, кроме этого
// файла. Здесь — только реэкспорт для существующих вызовов; новому коду
// следует импортировать напрямую из `$lib/status/wallet`.
export {
  startWallet,
  getBalances,
  getAccounts,
  getSettings,
  getTokensForActiveNetworksMode,
  getAddressDetails,
  buildTransaction,
  signMessage,
  sendTransactionWithSignature,
  getPendingTransactions,
  getSuggestedFees,
  getCryptoOnRamps,
  getCryptoOnRampUrl,
  getFlatEthereumChains,
  setChainUserRpcProvider,
  getEnsUsernames,
  ensGetName,
  ensAddressOf,
  ensPrice,
  ensExpireAt,
} from './wallet';

/**
 * Выход из аккаунта.
 *
 * НЕ `wakuext_logout`: такого метода в этой ветке status-go нет, вызов
 * отвечал «the method wakuext_logout does not exist/is not available».
 * Выход — отдельный эндпоинт `/statusgo/Logout`, зарегистрированный в
 * `EndpointsWithoutRequest` (cmd/status-backend/server/endpoints.go), то есть
 * обработчик тела не читает и его можно не передавать.
 *
 * Это же исправление разблокирует перезапуск ноды: `restartNodeForProviders`
 * вызывал `logout`, получал ошибку и падал, из-за чего вход не завершался и
 * сообщества с чатами не загружались вовсе.
 */
export async function logout(port: number): Promise<any> {
  return await statusFetch(port, 'Logout', {});
}

export async function getAccountsList(port: number, dataDir: string, networkId: number): Promise<any[]> {
  const data = await initializeApplication(port, dataDir, networkId);
  return data.accounts || [];
}

// ==========================================
// ЧАТЫ И СООБЩЕСТВА
// ==========================================
//
// Логика мессенджинга переехала в `messaging.ts` (шаг 15 плана, вариант A):
// все методы `wakuext_*` живут там, здесь — только реэкспорт ради
// совместимости существующих вызовов. Новому коду следует импортировать
// напрямую из `$lib/status/messaging`.

export {
  getChatPreviews,
  getChat,
  getChatMessages,
  getJoinedCommunities,
  getCommunities,
  getSpectatedCommunities,
  getCuratedCommunities,
  fetchCommunity,
  joinCommunity,
  leaveCommunity,
  joinPublicChat,
  normalizeHex,
  normalizeChatId,
  communityIdFromInvite,
  communityChannels,
  communityChatId,
  channelIdFromInvite,
  communityAccess,
  checkPermissionsToJoinCommunity,
  generateJoiningRequestsForSigning,
  signJoinRequestData,
  requestToJoinCommunity,
  spectateCommunity,
  sendChatMessage,
  isReply,
  getContacts,
  acceptContactRequest,
  sendContactRequest,
  ChatType,
  CommunityAccessValue,
  TokenPermissionType,
  isChannel,
  isCommunityChat,
  isDirectMessage,
} from './messaging';

export interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number | null;
}

export async function fetchMarketData(): Promise<MarketCoin[]> {
  return await invoke<MarketCoin[]>('fetch_market_data');
}
