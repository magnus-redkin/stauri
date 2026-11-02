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


export async function startWallet(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 1,
    method: "wallet_startWallet",
    params: []
  });
}

export async function getBalances(port: number, addresses: string[], forceRefresh = false): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 2,
    method: "wallet_fetchOrGetCachedWalletBalances",
    params: [addresses, forceRefresh]
  });
}

/**
 * Аккаунты профиля.
 *
 * Нужны, чтобы узнать адреса, по которым бэкенд реально считает балансы:
 * контроллер берёт их из keypairs_accounts с фильтром chat = 0 (см.
 * internal/db/multiaccounts/accounts/database.go, GetWalletAddresses).
 * Поле chat=true — это адрес для чатов, у него нет кошелька.
 */
export async function getAccounts(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 5,
    method: "accounts_getAccounts",
    params: []
  });
  return res.result || [];
}

export async function getSettings(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 3,
    method: "settings_getSettings",
    params: []
  });
}

/**
 * Метаданные токенов (symbol, decimals, name) для активных сетей.
 *
 * StorageToken из wallet_fetchOrGetCachedWalletBalances НЕ содержит symbol и
 * decimals — только адрес, chainId, rawBalance и hasError. Без этого вызова
 * баланс невозможно ни подписать, ни перевести в человеческие единицы.
 */
export async function getTokensForActiveNetworksMode(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 4,
    method: "wallet_getTokensForActiveNetworksMode",
    params: []
  });
  return res.result || [];
}

/**
 * Список сетей, известных бэкенду, с их RPC-провайдерами.
 * Используется для диагностики: какие провайдеры включены и живы.
 */
export async function getFlatEthereumChains(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 5,
    method: "networks_getFlatEthereumChains",
    params: []
  });
  return res.result || [];
}

/**
 * Добавляет пользовательский RPC-провайдер к сети.
 *
 * Встроенные провайдеры status-go (direct-grove) больше не резолвятся,
 * а direct-infura упирается в таймаут — в итоге все балансы приходят с
 * hasError=true. Свой проверенный endpoint (Alchemy/Infura) чинит это.
 *
 * Бэкенд дописывает user-провайдеров рядом со встроенными и использует их
 * первыми, поэтому вызывать это безопасно.
 */
export async function setChainUserRpcProvider(
  port: number,
  chainId: number,
  name: string,
  url: string
): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 6,
    method: "networks_setChainUserRpcProviders",
    params: [chainId, [{
      id: 0,
      chainId,
      name,
      url,
      enableRpsLimiter: false,
      type: "user",
      enabled: true,
      authType: "no-auth",
      authLogin: "",
      authPassword: "",
      authToken: "",
    }]]
  });
}

export async function logout(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 1,
    method: "wakuext_logout",
    params: []
  });
}

export async function getAccountsList(port: number, dataDir: string, networkId: number): Promise<any[]> {
  const data = await initializeApplication(port, dataDir, networkId);
  return data.accounts || [];
}

// ==========================================
// ЧАТЫ
// ==========================================

export async function getChats(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0", id: 1, method: "wakuext_chats", params: []
  });
}

export async function getChatMessages(port: number, chatId: string, limit: number = 20): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0", id: 2, method: "wakuext_chatMessages", params: [chatId, "", limit]
  });
}

export async function sendChatMessage(port: number, chatId: string, text: string): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0", id: 3, method: "wakuext_sendChatMessage",
    params: [{ chatId: chatId, text: text, contentType: 1 }]
  });
}

export async function getContacts(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0", id: 1, method: "wakuext_contacts", params: []
  });
}

export async function acceptContactRequest(port: number, contactPublicKey: string): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0", id: 1, method: "wakuext_acceptLatestContactRequestForContact",
    params: [{ id: contactPublicKey }]
  });
}

// getSettingsWithMnemonic удалён: seed-фраза больше не покидает процесс Rust.
// Фронтенд работает через команды seed::* (см. src-tauri/src/seed.rs):
// fetch_seed_phrase, seed_word, seed_challenge, verify_seed_answer, clear_seed.

export async function sendContactRequest(port: number, publicKey: string, message: string = ""): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0", id: 1, method: "wakuext_sendContactRequest",
    params: [{ id: publicKey, message: message }]
  });
}

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
