import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureWalletRpc, login, createAccount } from './connectionStore.svelte';
import { statusState, waitForNodeStopped, waitForLogin } from './statusStore.svelte';
import WebSocket from '@tauri-apps/plugin-websocket';
import {
  getFlatEthereumChains,
  setChainUserRpcProvider,
  startRpcProxy,
  setRpcUpstreams,
  loginAccount,
  logout,
  startMessenger,
  createAccountAndLogin,
} from '$lib/status/api';

vi.mock('$lib/status/api', () => ({
  startBackend: vi.fn(),
  stopBackend: vi.fn(),
  initializeApplication: vi.fn(),
  loginAccount: vi.fn(),
  createAccountAndLogin: vi.fn(),
  getFlatEthereumChains: vi.fn(),
  setChainUserRpcProvider: vi.fn(),
  startRpcProxy: vi.fn(),
  setRpcUpstreams: vi.fn(),
  startMessenger: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-websocket', () => ({ default: { connect: vi.fn() } }));

vi.mock('./statusStore.svelte', () => ({
  statusState: { backendPort: 12345, isLoggedIn: false, accountKeyUid: 'key-uid-1' },
  setAccounts: vi.fn(),
  setNetworkInfo: vi.fn(),
  processSignal: vi.fn(),
  waitForLogin: vi.fn(),
  waitForNodeStopped: vi.fn(),
}));

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

/**
 * Сеть в том виде, в каком её отдаёт networks_getFlatEthereumChains.
 * Поля называются enabled и isActive — именно так они записаны в params.Network.
 */
function network(chainId: number, name: string, overrides: Record<string, unknown> = {}) {
  return { chainId, chainName: name, enabled: true, isActive: true, rpcProviders: [], ...overrides };
}

const PROXY_PORT = 43057;

describe('configureWalletRpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (startRpcProxy as any).mockResolvedValue(PROXY_PORT);
    (setRpcUpstreams as any).mockResolvedValue(undefined);
    (setChainUserRpcProvider as any).mockResolvedValue({ result: null });
  });

  it('прописывает user-провайдера каждой активной сети на локальный форвардер', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([
      network(1, 'Ethereum'),
      network(42161, 'Arbitrum'),
    ]);

    await configureWalletRpc(12345);

    expect(setChainUserRpcProvider).toHaveBeenCalledTimes(2);
    expect(setChainUserRpcProvider).toHaveBeenCalledWith(
      12345, 1, 'stauri-rpc', `http://127.0.0.1:${PROXY_PORT}/1`
    );
    expect(setChainUserRpcProvider).toHaveBeenCalledWith(
      12345, 42161, 'stauri-rpc', `http://127.0.0.1:${PROXY_PORT}/42161`
    );
  });

  it('пропускает сети без isActive — регрессия на поле "active"', async () => {
    // Сети с полем active вместо isActive: фильтр по несуществующему полю
    // отбирал 0 сетей, и провайдеры не прописывались вовсе.
    (getFlatEthereumChains as any).mockResolvedValue([
      network(1, 'Ethereum'),
      { chainId: 10, chainName: 'Optimism', enabled: true, active: true },
      network(8453, 'Base', { isActive: false }),
      network(56, 'Binance', { enabled: false }),
    ]);

    await configureWalletRpc(12345);

    expect(setChainUserRpcProvider).toHaveBeenCalledTimes(1);
    expect(setChainUserRpcProvider).toHaveBeenCalledWith(
      12345, 1, 'stauri-rpc', `http://127.0.0.1:${PROXY_PORT}/1`
    );
  });

  it('передаёт таблицу upstream форвардеру при запуске', async () => {
    (getFlatEthereumChains as any).mockRejectedValue(new Error('API not ready'));

    await configureWalletRpc(12345);

    // До старта ноды сервис networks_* недоступен, но форвардер уже должен
    // знать URL: провайдер с прошлого запуска указывает на этот порт.
    expect(startRpcProxy).toHaveBeenCalledWith(
      expect.objectContaining({ 1: expect.stringContaining('publicnode') })
    );
    expect(setChainUserRpcProvider).not.toHaveBeenCalled();
  });

  it('не трогает сеть, если провайдер уже указывает на тот же URL', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([
      network(1, 'Ethereum', {
        rpcProviders: [{
          type: 'user', name: 'stauri-rpc', enabled: true,
          url: `http://127.0.0.1:${PROXY_PORT}/1`,
        }],
      }),
    ]);

    await configureWalletRpc(12345);

    expect(setChainUserRpcProvider).not.toHaveBeenCalled();
  });

  it('перезаписывает провайдера, если URL устарел', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([
      network(1, 'Ethereum', {
        rpcProviders: [{
          type: 'user', name: 'stauri-rpc', enabled: true,
          url: 'http://127.0.0.1:9999/1',
        }],
      }),
    ]);

    await configureWalletRpc(12345);

    expect(setChainUserRpcProvider).toHaveBeenCalledWith(
      12345, 1, 'stauri-rpc', `http://127.0.0.1:${PROXY_PORT}/1`
    );
  });

  it('пропускает сети, для которых нет известного RPC', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([
      network(999999, 'Unknown chain'),
    ]);

    await configureWalletRpc(12345);

    expect(setChainUserRpcProvider).not.toHaveBeenCalled();
  });

  it('сообщает, что провайдеров пришлось записывать (чистый профиль)', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([network(1, 'Ethereum')]);

    const result = await configureWalletRpc(12345);

    expect(result.wroteProviders).toBe(true);
  });

  it('сообщает, что записывать было нечего (повторный запуск)', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([
      network(1, 'Ethereum', {
        rpcProviders: [{
          type: 'user', name: 'stauri-rpc', enabled: true,
          url: `http://127.0.0.1:${PROXY_PORT}/1`,
        }],
      }),
    ]);

    const result = await configureWalletRpc(12345);

    expect(result.wroteProviders).toBe(false);
  });
});

/**
 * Перезапуск ноды на чистом профиле.
 *
 * Нода стартует внутри loginAccount и сразу собирает RPC-клиентов из встроенных
 * провайдеров; кэш не инвалидируется до её остановки. Поэтому если провайдеры
 * пришлось записывать, вход нужно повторить, иначе балансы останутся с ошибкой.
 */
describe('перезапуск ноды после записи провайдеров', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusState.backendPort = 12345;
    statusState.accountKeyUid = 'key-uid-1';
    (startRpcProxy as any).mockResolvedValue(PROXY_PORT);
    (setRpcUpstreams as any).mockResolvedValue(undefined);
    (setChainUserRpcProvider as any).mockResolvedValue({ result: null });
    (loginAccount as any).mockResolvedValue({});
    (logout as any).mockResolvedValue({});
    (startMessenger as any).mockResolvedValue({});
    (waitForLogin as any).mockResolvedValue(undefined);
    (waitForNodeStopped as any).mockResolvedValue(undefined);
    (WebSocket.connect as any).mockResolvedValue({
      addListener: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  it('перезапускает ноду, когда вход идёт на чистом профиле', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([network(1, 'Ethereum')]);

    await login('pass', 'key-uid-1');

    // Выход и повторный вход произошли ровно один раз.
    expect(logout).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledWith(12345);
    expect(waitForNodeStopped).toHaveBeenCalledTimes(1);
    expect(loginAccount).toHaveBeenCalledTimes(2);
    expect(loginAccount).toHaveBeenNthCalledWith(1, 12345, 'pass', 'key-uid-1');
    expect(loginAccount).toHaveBeenNthCalledWith(2, 12345, 'pass', 'key-uid-1');
    // messenger стартует только после перезапуска — один раз.
    expect(startMessenger).toHaveBeenCalledTimes(1);
  });

  it('ждёт остановки ноды ДО повторного входа', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([network(1, 'Ethereum')]);

    const order: string[] = [];
    // Модель настоящего сигнала: ожидание регистрируется заранее, а
    // разрешается только после того, как нода действительно встала.
    let resolveStopped: () => void = () => {};
    (waitForNodeStopped as any).mockImplementation(
      () => new Promise<void>((resolve) => {
        order.push('wait-registered');
        resolveStopped = () => { order.push('stopped'); resolve(); };
      })
    );
    (logout as any).mockImplementation(async () => {
      order.push('logout');
      resolveStopped();
    });
    (loginAccount as any).mockImplementation(async () => { order.push('login'); });

    await login('pass', 'key-uid-1');

    // Регистрация ожидания — до logout (иначе сигнал можно проспать),
    // но повторный вход наступает строго после остановки.
    expect(order).toEqual(['login', 'wait-registered', 'logout', 'stopped', 'login']);
  });

  it('не перезапускает ноду, если провайдер уже на месте', async () => {
    (getFlatEthereumChains as any).mockResolvedValue([
      network(1, 'Ethereum', {
        rpcProviders: [{
          type: 'user', name: 'stauri-rpc', enabled: true,
          url: `http://127.0.0.1:${PROXY_PORT}/1`,
        }],
      }),
    ]);

    await login('pass', 'key-uid-1');

    expect(logout).not.toHaveBeenCalled();
    expect(waitForNodeStopped).not.toHaveBeenCalled();
    expect(loginAccount).toHaveBeenCalledTimes(1);
    expect(startMessenger).toHaveBeenCalledTimes(1);
  });

  it('пропускает перезапуск при создании аккаунта без keyUid', async () => {
    // createAccountAndLogin мог не отдать key-uid: повторный вход без него
    // невозможен, поэтому остаётся прежний путь — провайдеры и messenger.
    statusState.accountKeyUid = '';
    (getFlatEthereumChains as any).mockResolvedValue([network(1, 'Ethereum')]);
    (createAccountAndLogin as any).mockResolvedValue({});

    await createAccount('pass');

    expect(logout).not.toHaveBeenCalled();
    expect(setChainUserRpcProvider).toHaveBeenCalled();
    expect(startMessenger).toHaveBeenCalledTimes(1);
  });

  it('перезапускает ноду при создании аккаунта, когда keyUid известен', async () => {
    statusState.accountKeyUid = 'key-uid-1';
    (getFlatEthereumChains as any).mockResolvedValue([network(1, 'Ethereum')]);
    (createAccountAndLogin as any).mockResolvedValue({});

    await createAccount('pass');

    expect(createAccountAndLogin).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(loginAccount).toHaveBeenCalledTimes(1);
    expect(startMessenger).toHaveBeenCalledTimes(1);
  });
});
