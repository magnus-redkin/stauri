/**
 * Настройка RPC-провайдеров для status-go.
 *
 * Вынесено из `connectionStore`: это чистая логика конфигурации, она не
 * участвует в реактивном состоянии соединения (нет `$state`, нет сокета).
 */

import { statusState } from './statusStore.svelte';
import { debug } from '$lib/utils/log';
import { formatError } from '$lib/utils/errors';
import {
  getFlatEthereumChains,
  setChainUserRpcProvider,
  startRpcProxy,
  setRpcUpstreams,
  getRpcProxySecret,
} from '$lib/status/api';
import { PUBLIC_RPC, USER_PROVIDER_NAME, rpcUrlForChain } from '$lib/config/keys';

/**
 * `wroteProviders` — пришлось ли что-то записывать. Это признак того, что
 * RPC-клиент мог быть собран не с теми URL: status-go создаёт и кэширует
 * клиентов при старте ноды, а провайдеры мы пишем уже после. См. `login()`
 * в connectionStore.
 */
export type ConfigureResult = { wroteProviders: boolean };

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
export async function configureWalletRpc(
  port: number | null = statusState.backendPort
): Promise<ConfigureResult> {
  if (!port) return { wroteProviders: false };

  // 1. Форвардер поднимаем ПЕРВЫМ и без участия status-go.
  // Его API (networks_*) регистрируется только в initServices, то есть после
  // старта ноды, поэтому до логина вызов сетей упадёт. Форвардер же — это
  // команда Tauri, она доступна всегда, и порт должен приниматься раньше,
  // чем status-go создаст RPC-клиенты: адрес провайдера уже лежит в БД
  // прошлым запуском, и клиент может обратиться к нему сразу.
  let proxyPort: number;
  let proxySecret: string | null = null;
  try {
    // Таблица передаётся сразу с запуском: провайдер с прошлого запуска уже
    // указывает на этот порт, и первый же запрос приходит раньше, чем успела
    // бы выполниться отдельная команда set_rpc_upstreams.
    proxyPort = await startRpcProxy(PUBLIC_RPC);
    // Секрет нужен для пути провайдера: в форвардер ходит status-go, а
    // заголовок с токеном нода послать не может. Без секрета любой процесс
    // на машине (и любой сайт в WebView dApp) получил бы доступ к RPC.
    proxySecret = await getRpcProxySecret();
    debug(`[configureWalletRpc] rpc proxy on 127.0.0.1:${proxyPort}`);
  } catch (e: any) {
    // Порт форвардера фиксирован, потому что на него уже указывают провайдеры
    // в БД status-go. Если он занят, работать «напрямую» нельзя: клиент ноды
    // всё равно пойдёт на старый адрес и попадёт в чужой процесс либо получит
    // отказ. Сообщаем пользователю причину, а не деградируем молча.
    const reason = formatError(e);
    statusState.errorMsg = reason;
    console.error('[configureWalletRpc] rpc proxy failed:', reason);
    proxyPort = 0;
  }

  // 2. Уточняем URL по активным сетям из status-go, если он уже поднят.
  let chains: any[];
  try {
    chains = await getFlatEthereumChains(port);
  } catch (e) {
    // До старта ноды сервис сетей ещё не зарегистрирован — это не ошибка,
    // форвардер уже работает со статической таблицей.
    debug('[configureWalletRpc] networks API not ready yet:', e);
    // Провайдеров мы не видели и ничего не писали: судить о том, правильно ли
    // собран RPC-клиент, по этому вызову нельзя. Перезапуск ноды здесь
    // бессмысленен — вызывающий код в этом случае просто пропускает его.
    return { wroteProviders: false };
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
      console.warn(
        '[configureWalletRpc] failed to update proxy upstreams:',
        formatError(e)
      );
    }
  }

  let wroteProviders = false;

  for (const chain of chains) {
    const chainId = Number(chain?.chainId);
    // Имена полей — как в params.Network: enabled и isActive (не active!).
    if (!chainId || !chain.enabled || !chain.isActive) continue;

    const direct = upstreams[chainId];
    if (!direct) continue;

    // Через форвардер идём, если он поднялся; иначе — напрямую.
    //
    // Путь обязательно содержит секрет: форвардер отклоняет запросы без него
    // (отвечает 404, чтобы не выдавать своего присутствия). В форвардер ходит
    // status-go, а не наш фронтенд, поэтому секрет в URL, а не в заголовке.
    const url =
      proxyPort && proxySecret
        ? `http://127.0.0.1:${proxyPort}/${proxySecret}/${chainId}`
        : direct;

    if (proxyPort && !proxySecret) {
      // Секрета нет, а форвардер поднялся — это несогласованное состояние:
      // идти напрямую нельзя, клиент ноды всё равно смотрит на наш порт.
      console.error(
        '[configureWalletRpc] rpc proxy started without a secret; providers not updated'
      );
      continue;
    }

    // Сверяемся по URL, а не только по имени: провайдер мог остаться от
    // прошлой конфигурации (например, с мёртвым на этой машине Alchemy),
    // и тогда его нужно перезаписать.
    const existing = (chain.rpcProviders || []).find(
      (p: any) => p.type === 'user' && p.name === USER_PROVIDER_NAME
    );
    if (existing && existing.url === url) continue;

    try {
      await setChainUserRpcProvider(port, chainId, USER_PROVIDER_NAME, url);
      wroteProviders = true;
      debug(
        `[configureWalletRpc] chain ${chainId}: provider ` +
          (existing ? 'updated' : 'added')
      );
    } catch (e: any) {
      console.warn(`[configureWalletRpc] chain ${chainId} failed:`, formatError(e));
    }
  }

  return { wroteProviders };
}
