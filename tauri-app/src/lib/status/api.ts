import { invoke } from "@tauri-apps/api/core";
import { statusFetch } from "./http";
import type { StartBackendResponse } from "./types";

const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_KEY as string | undefined;
const INFURA_KEY = import.meta.env.VITE_INFURA_KEY as string | undefined;

console.log('[api] ALCHEMY_KEY loaded:', !!ALCHEMY_KEY, 'INFURA_KEY loaded:', !!INFURA_KEY);

/** Собирает секреты в строго валидную для status-go вложенную структуру */
function walletSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};

  // 🔥 ГЛАВНЫЙ ФИКС: Точное совпадение с Go-полями request.AlchemyAPIKey и request.InfuraAPIKey
  if (ALCHEMY_KEY) secrets.alchemyApiKey = ALCHEMY_KEY;
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
  console.log('[Login] payload keys:', Object.keys(payload));
  return await statusFetch(port, "LoginAccount", payload);
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
    logEnabled: true,
    logLevel: 'DEBUG',
    logFilePath: `${dataDir}/status.log`,
    ...walletSecrets(),
  };
  console.log('[CreateAccount] payload keys:', Object.keys(payload));
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

/** Регистрирует сеть в preferences (fallback). */
/**
 * Жестко конфигурирует сетевой слой в preferences,
 * используя ваши ключи из .env для полноценного RPC доступа
 */

/**
 * Жестко конфигурирует сетевой слой в preferences,
 * используя импортированные ключи из .env для полноценного RPC доступа
 */
export async function ensureNetworksConfigured(
  port: number,
  networkName: string,
  rpcUrl: string,
  chainId: number
): Promise<void> {
  const networkId = `${networkName}_rpc`;

  // 🔥 ГЛАВНЫЙ АРХИТЕКТУРНЫЙ ФИКС:
  // Игнорируем дефолтный публичный линк, прилетевший из Rust.
  // Если Vite успешно прочитал ALCHEMY_KEY из .env, собираем полноценный Alchemy-эндпоинт!
  let targetRpcUrl = rpcUrl;
  if (INFURA_KEY && networkName === 'mainnet') {
    targetRpcUrl = `https://mainnet.infura.io/v3/${INFURA_KEY}`;
  } else if (ALCHEMY_KEY && networkName === 'mainnet') {
    targetRpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  }

  const maskedUrl = targetRpcUrl.replace(/\/v[23]\/[^/]+$/, '/vX/***');
  console.log(`[Stauri Network] Injecting RPC URL to preferences (masked): ${maskedUrl}`);

  const networksJson = JSON.stringify([{
    id: networkId,
    name: networkName === 'mainnet' ? 'Ethereum Mainnet' : networkName,
    rpcUrl: targetRpcUrl, // Передаем ноду Alchemy со всеми методами индексации Status
    chainId,
    symbol: 'ETH',
    upstreamConfig: { enabled: true },
  }]);

  await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0', id: 900,
    method: 'preferences_set',
    params: ['settings', 'networks/networks', networksJson],
  });
  await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0', id: 901,
    method: 'preferences_set',
    params: ['settings', 'networks/current-network', networkId],
  });
  await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0', id: 902,
    method: 'preferences_set',
    params: ['settings', 'thirdparty_services_enabled', 'true'],
  });
}



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

export async function getSettingsWithMnemonic(port: number): Promise<string | null> {
  try {
    const res = await statusFetch<{ result?: { mnemonic?: string } }>(port, "CallRPC", {
      jsonrpc: "2.0", id: 1, method: "settings_getSettings", params: []
    });
    return res.result?.mnemonic || null;
  } catch (e) {
    console.warn("Failed to get mnemonic:", e);
    return null;
  }
}

export async function sendContactRequest(port: number, publicKey: string, message: string = ""): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0", id: 1, method: "wakuext_sendContactRequest",
    params: [{ id: publicKey, message: message }]
  });
}
