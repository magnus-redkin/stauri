/**
 * Граница status-go для кошелька и ENS.
 *
 * ## Зачем отдельный модуль
 *
 * Общая цель Stauri — брать из status-go только сеть и кошелёк, а всё
 * остальное выносить; при переходе на Logos status-go уходит совсем. Когда
 * это случится, менять придётся этот файл и его вызовы, а не весь фронтенд.
 * Раньше кошелёчные обёртки лежали вперемешку в `api.ts` рядом с жизненным
 * циклом бэкенда — граница была размыта.
 *
 * `api.ts` сохраняет реэкспорт ради существующих вызовов; новому коду
 * следует импортировать отсюда.
 *
 * ## Номера `id` в JSON-RPC
 *
 * Номера не обязаны быть уникальными между запросами: `statusFetch` работает
 * по одному HTTP-вызову на запрос, ответ приходит в том же соединении.
 * Нумерация внутри файла оставлена сквозной для читаемости логов.
 */

import { statusFetch } from './http';

// ===========================================================================
// ЖИЗНЕННЫЙ ЦИКЛ
// ===========================================================================

/**
 * Запускает сервис кошелька.
 *
 * Вызывать один раз за сессию, а не на каждом опросе балансов: повторные
 * вызовы ничего не дают, но стоят времени.
 */
export async function startWallet(port: number): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wallet_startWallet',
    params: [],
  });
}

// ===========================================================================
// АККАУНТЫ, БАЛАНСЫ, ТОКЕНЫ
// ===========================================================================

/**
 * Аккаунты профиля.
 *
 * Нужны, чтобы узнать адреса, по которым бэкенд реально считает балансы:
 * контроллер берёт их из `keypairs_accounts` с фильтром `chat = 0` (см.
 * internal/db/multiaccounts/accounts/database.go, `GetWalletAddresses`).
 * Поле `chat = true` — это адрес для чатов, у него нет кошелька.
 */
export async function getAccounts(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 2,
    method: 'accounts_getAccounts',
    params: [],
  });
  return res.result || [];
}

/**
 * Балансы из кэша бэкенда.
 *
 * ## Почему `forceRefresh` бесполезен
 *
 * Параметр принимается, но в `pkg/services/wallet/api.go` (`FetchOrGetCachedWalletBalances`)
 * игнорируется: метод читает кэш, который наполняет фоновый
 * `MultistandardBalanceController`. Поэтому баланс после перевода не
 * обновится мгновенно, сколько бы раз мы ни спросили — нужен повторный
 * опрос по таймеру.
 *
 * Формат результата: `{ "0xAddr": [ { tokenAddress, tokenChainId,
 * rawBalance, hasError } ] }`.
 */
export async function getBalances(
  port: number,
  addresses: string[],
  forceRefresh = false
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 3,
    method: 'wallet_fetchOrGetCachedWalletBalances',
    params: [addresses, forceRefresh],
  });
}

/**
 * Метаданные токенов (symbol, decimals, name) для активных сетей.
 *
 * `StorageToken` из `getBalances` НЕ содержит `symbol` и `decimals` — только
 * адрес, chainId, rawBalance и hasError. Без этого вызова баланс невозможно
 * ни подписать, ни перевести в человеческие единицы, ни показать в списке.
 *
 * Ответ большой (~4.6 МБ, ~17 700 токенов), поэтому в `walletStore` он
 * запрашивается один раз за сессию и кэшируется.
 */
export async function getTokensForActiveNetworksMode(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 4,
    method: 'wallet_getTokensForActiveNetworksMode',
    params: [],
  });
  return res.result || [];
}

/**
 * Настройки профиля.
 *
 * Содержат `mnemonic` — seed-фразу. Тело ответа не логируется
 * (`statusFetch`), но класть этот объект в стор или в лог нельзя.
 */
export async function getSettings(port: number): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 5,
    method: 'settings_getSettings',
    params: [],
  });
}

/**
 * Сохраняет настройку профиля.
 *
 * `key` — «react-имя» поля, как его ждёт status-go, вместе со знаком вопроса
 * для булевых: `test-networks-enabled?` (см. `internal/db/multiaccounts/settings/columns.go`).
 * Обычное имя поля (`test_networks_enabled`) здесь не подойдёт — метод ищет
 * поле по react-имени.
 */
export async function saveSetting(
  port: number,
  key: string,
  value: unknown
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 22,
    method: 'settings_saveSetting',
    params: [key, value],
  });
}

/**
 * Включает или выключает показ тестовых сетей.
 *
 * ## Почему это отдельный вызов, а не следствие выбора сети
 *
 * Выбор сети в Stauri (`STAURI_NETWORK`) — это конфиг Rust: какая сеть
 * считается основной, какой waku-fleet и какой каталог данных. Он ничего не
 * говорит самому status-go. У status-go есть собственный флаг
 * `test-networks-enabled?`, и `networks.GetActiveNetworks()` фильтрует сети по
 * нему: при `false` активны mainnet-сети, при `true` — тестовые.
 *
 * Пока флаг не выставлен, профиль, запущенный как «sepolia», считает балансы
 * по mainnet-сетям (1, 10, 56, 8453, 42161) и показывает нули — ровно то,
 * что видел пользователь при первом запуске в Sepolia.
 *
 * Включение флага уведомляет `EventActiveNetworksChanged`, после чего
 * контроллер балансов перезапрашивает сети. Но RPC-клиенты кэшируются по
 * chainID, поэтому провайдеров для новых сетей нужно прописать заново —
 * вызывающий код делает это после переключения.
 *
 * ## Почему нельзя вызвать до входа
 *
 * `settings_*` регистрируется в `initServices`, то есть после старта ноды, а
 * нода стартует внутри `LoginAccount`. До входа вызов вернёт «method not
 * found» — так же, как `networks_*`.
 */
export async function setTestNetworksEnabled(
  port: number,
  enabled: boolean
): Promise<any> {
  return saveSetting(port, 'test-networks-enabled?', enabled);
}

/**
 * Текущее значение флага тестовых сетей.
 *
 * Читаем весь объект настроек и берём одно поле: отдельного геттера для
 * этого флага в status-go нет. Объект содержит seed-фразу (`mnemonic`),
 * поэтому его нельзя ни логировать, ни класть в стор — только вернуть
 * нужное поле и забыть.
 */
export async function getTestNetworksEnabled(port: number): Promise<boolean> {
  const settings = await getSettings(port);
  return settings?.result?.['test-networks-enabled?'] === true;
}

/**
 * Приводит режим сетей к нужному и сообщает, менялся ли он.
 *
 * Возвращает `true`, если флаг пришлось переписать: в этом случае набор
 * активных сетей изменился, и RPC-клиенты бэкенда собраны под прежний —
 * ноду нужно перезапустить, иначе балансы придут не по тем сетям.
 */
export async function ensureTestNetworkMode(
  port: number,
  enabled: boolean
): Promise<boolean> {
  const current = await getTestNetworksEnabled(port);
  if (current === enabled) return false;
  await setTestNetworksEnabled(port, enabled);
  return true;
}

/**
 * Разбор адреса получателя: возвращает ENS-имя для адреса.
 *
 * Используется на шаге проверки отправки, чтобы человек увидел «0x…» вместе
 * с именем, если оно есть, — это последняя возможность заметить подмену.
 */
export async function getAddressDetails(
  port: number,
  chainId: number,
  address: string
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 6,
    method: 'wallet_getAddressDetails',
    params: [chainId, address],
  });
}

/**
 * Запускает полный перезапрос балансов.
 *
 * ## Почему это единственный работающий способ обновить
 *
 * `getBalances` принимает `forceRefresh`, но игнорирует его — так и написано
 * в `pkg/services/wallet/api.go` над `FetchOrGetCachedWalletBalances`:
 *
 * > The client doesn't really need to force balance refreshes ... The only
 * > outlier is the user-triggered refresh, which is handled in API method
 * > RestartWalletReloadTimer
 *
 * Этот метод и есть та самая «кнопка обновить»: он дёргает
 * `multistandardBalanceController.TriggerFullFetch()`. Запрос асинхронный —
 * ответ приходит сразу, а числа появляются в кэше через несколько секунд,
 * поэтому вызывающий код должен перечитать балансы не один раз, а спустя
 * паузу.
 */
export async function restartWalletReloadTimer(port: number): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 21,
    method: 'wallet_restartWalletReloadTimer',
    params: [],
  });
}

// ===========================================================================
// ОТПРАВКА
// ===========================================================================
//
// Путь перевода в status-go трёхшаговый и требует пароль (см.
// `docs/ru/wallet_plan.md` §2.2):
//
//   buildTransaction(chainID, sendTxArgs) → { messageToSign, txArgs }
//   signMessage(messageToSign, from, password) → подпись
//   sendTransactionWithSignature(chainID, "WalletTransfer", txArgs, sig) → hash
//
// ## Почему эти три вызова не должны зваться из компонентов
//
// `wallet_signMessage` подписывает произвольные 32 байта ключом кошелька и
// не знает, что это за байты. Если пароль и последовательность шагов живут
// в webview, любая XSS получает универсальную машинку подписи. Поэтому вся
// отправка уходит в Rust одной командой (`send_transfer`), а эти обёртки
// оставлены для тестов и для отладки через консоль — не для UI.

/** Собирает транзакцию и возвращает хэш, который надо подписать. */
export async function buildTransaction(
  port: number,
  chainId: number,
  sendTxArgsJson: string
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 7,
    method: 'wallet_buildTransaction',
    params: [chainId, sendTxArgsJson],
  });
}

/** Подписывает 32 байта ключом аккаунта. Требует пароль. */
export async function signMessage(
  port: number,
  message: string,
  address: string,
  password: string
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 8,
    method: 'wallet_signMessage',
    params: [message, address, password],
  });
}

/** Отправляет подписанную транзакцию в сеть. */
export async function sendTransactionWithSignature(
  port: number,
  chainId: number,
  txType: 'WalletTransfer' | 'RegisterENS' | 'ReleaseENS' | 'SetPubKey',
  sendTxArgsJson: string,
  signature: string
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 9,
    method: 'wallet_sendTransactionWithSignature',
    params: [chainId, txType, sendTxArgsJson, signature],
  });
}

/** Транзакции, ожидающие подтверждения. Для статуса на экране. */
export async function getPendingTransactions(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 10,
    method: 'wallet_getPendingTransactions',
    params: [],
  });
  return res.result || [];
}

/** Рекомендованные комиссии сети (в gwei). */
export async function getSuggestedFees(port: number, chainId: number): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 11,
    method: 'wallet_getSuggestedFees',
    params: [chainId],
  });
}

// ===========================================================================
// ON-RAMP (покупка)
// ===========================================================================
//
// Платёж идёт на стороне провайдера, Stauri только передаёт адрес и
// открывает ссылку внешним обработчиком.

/** Доступные провайдеры покупки. В testnet обычно пусто. */
export async function getCryptoOnRamps(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 12,
    method: 'wallet_getCryptoOnRamps',
    params: [],
  });
  return res.result || [];
}

/** Ссылка на провайдера с подставленным адресом получения. */
export async function getCryptoOnRampUrl(
  port: number,
  providerId: string,
  parameters: { destAddress?: string; chainID?: number; symbol?: string }
): Promise<string> {
  const res = await statusFetch<{ result?: string }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 13,
    method: 'wallet_getCryptoOnRampURL',
    params: [providerId, parameters],
  });
  return res.result || '';
}

// ===========================================================================
// СЕТИ И RPC-ПРОВАЙДЕРЫ
// ===========================================================================
//
// Это не кошелёк в чистом смысле, но живёт рядом: сети настраивает
// `rpcConfig.ts` при подключении, и без этих вызовов балансы не придут.

/** Сети, известные бэкенду, с их RPC-провайдерами. */
export async function getFlatEthereumChains(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 14,
    method: 'networks_getFlatEthereumChains',
    params: [],
  });
  return res.result || [];
}

/**
 * Добавляет пользовательский RPC-провайдер к сети.
 *
 * Встроенные провайдеры status-go (direct-grove) больше не резолвятся, а
 * direct-infura упирается в таймаут — в итоге все балансы приходят с
 * `hasError = true`. Свой проверенный endpoint (через локальный форвардер)
 * чинит это. Бэкенд дописывает пользовательских провайдеров рядом со
 * встроенными и использует их первыми, поэтому вызывать это безопасно.
 */
export async function setChainUserRpcProvider(
  port: number,
  chainId: number,
  name: string,
  url: string
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 15,
    method: 'networks_setChainUserRpcProviders',
    params: [
      chainId,
      [
        {
          id: 0,
          chainId,
          name,
          url,
          enableRpsLimiter: false,
          type: 'user',
          enabled: true,
          authType: 'no-auth',
          authLogin: '',
          authPassword: '',
          authToken: '',
        },
      ],
    ],
  });
}

// ===========================================================================
// ENS
// ===========================================================================
//
// Служба ENS зарегистрирована в RPC-сервере под пространством имён `ens`
// (pkg/services/ens/service.go). Регистрация имени здесь НЕ делается:
// она идёт только Router-путём (`SendType: ENSRegister`), потому что на
// mainnet оплата в SNT, а на testnet — в STT. См. `docs/ru/wallet_plan.md` §3.

/** Имена ENS этого профиля. */
export async function getEnsUsernames(port: number): Promise<any[]> {
  const res = await statusFetch<{ result?: any[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 16,
    method: 'ens_getEnsUsernames',
    params: [],
  });
  return res.result || [];
}

/**
 * Имя ENS для адреса.
 *
 * Возвращает пустую строку, если имени нет, — это не ошибка, а обычный
 * случай: у большинства адресов имени нет.
 */
export async function ensGetName(
  port: number,
  chainId: number,
  address: string
): Promise<string> {
  const res = await statusFetch<{ result?: string }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 17,
    method: 'ens_getName',
    params: [chainId, address],
  });
  return res.result || '';
}

/**
 * Адрес, на который указывает имя ENS.
 *
 * Нужен в поле получателя: человек вводит `vitalik.eth`, отправляем на
 * адрес. Ответ `null`/пустой — имени нет.
 */
export async function ensAddressOf(
  port: number,
  chainId: number,
  username: string
): Promise<string> {
  const res = await statusFetch<{ result?: string }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 18,
    method: 'ens_addressOf',
    params: [chainId, username],
  });
  return res.result || '';
}

/** Цена регистрации имени. */
export async function ensPrice(port: number, chainId: number): Promise<string> {
  const res = await statusFetch<{ result?: string }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 19,
    method: 'ens_price',
    params: [chainId],
  });
  return res.result || '';
}

/** Когда истекает имя (RFC3339). Пусто — имя не зарегистрировано. */
export async function ensExpireAt(
  port: number,
  chainId: number,
  username: string
): Promise<string> {
  const res = await statusFetch<{ result?: string }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 20,
    method: 'ens_expireAt',
    params: [chainId, username],
  });
  return res.result || '';
}
