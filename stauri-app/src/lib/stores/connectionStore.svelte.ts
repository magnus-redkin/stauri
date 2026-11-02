/**
 * Фасад над модулями соединения с бэкендом.
 *
 * История. Файл вырос до 364 строк, в которых перемешались три разные
 * обязанности: настройка RPC-провайдеров, WebSocket и сценарии входа.
 * Читать и тестировать его целиком было тяжело, поэтому логика разнесена:
 *
 *   - `rpcConfig.ts`    — `configureWalletRpc` и `ConfigureResult`;
 *   - `ws.ts`           — открытие/закрытие сокета `/signals`;
 *   - `connection.svelte.ts` — `connectionState`, `connect`, `changeNetwork`,
 *                        `login`, `createAccount`, `disconnect`.
 *
 * Этот файл оставлен, чтобы внешний код не пришлось править: импорт
 * из `connectionStore.svelte` продолжает работать. Новому коду лучше
 * обращаться к конкретному модулю напрямую.
 */

export { configureWalletRpc } from './rpcConfig';
export type { ConfigureResult } from './rpcConfig';

export { isWsOpen, openWs, closeWs } from './ws';

export {
  connectionState,
  connect,
  changeNetwork,
  login,
  createAccount,
  disconnect,
} from './connection.svelte';
