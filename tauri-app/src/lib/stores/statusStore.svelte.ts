import type { StatusEvent, NodeLoginEvent } from '$lib/status/types';
import { startMessenger, logout as apiLogout } from '$lib/status/api';

export const statusState = $state({
  isConnected: false,
  isConnecting: false,
  isLoggedIn: false,
  accountKeyUid: '',
  publicKey: '',
  alias: '', // Трёхсловное имя (генерируется автоматически)
  chainId: 1,
  backendPort: null as number | null,
  backendDataDir: '',
  events: [] as StatusEvent[],
  errorMsg: '',
  accounts: [] as any[],
  networkName: 'mainnet',
  rpcUrl: '',
  wakuFleet: 'status.prod',
  isTestnet: false,
  pendingRequestsCount: 0,
  lastMessageSignal: 0,
  isSeedSaved: false,
});

// Механизм ожидания логина (Promise)
let loginResolver: (() => void) | null = null;
let loginTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function setSeedSaved(saved: boolean) {
  statusState.isSeedSaved = saved;
  // Сохраняем в localStorage, чтобы флаг не сбрасывался при перезапуске
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('stauri_seed_saved', saved ? 'true' : 'false');
  }
}


export function processSignal(rawJson: string) {
  if (!rawJson) return;

  try {
    const parsed = JSON.parse(rawJson) as StatusEvent;

    // Ограничиваем массив событий, чтобы не забивать память (храним последние 100)
    statusState.events.push(parsed);
    if (statusState.events.length > 100) {
      statusState.events.shift();
    }

    if (parsed.type === 'node.login') {
      const loginEvent = parsed as NodeLoginEvent;

      if (loginEvent.event?.error) {
        statusState.errorMsg = `Login failed: ${loginEvent.event.error}`;
        if (loginResolver) {
          // Если логин упал, промис отклоняется (но проще просто дать таймауту сработать или добавить reject)
          // Для простоты просто не разрешаем его здесь.
        }
        return;
      }

      statusState.accountKeyUid = loginEvent.event?.settings?.['key-uid'] || statusState.accountKeyUid;
      statusState.publicKey = loginEvent.event?.settings?.['public-key'] || statusState.publicKey;
      statusState.alias = loginEvent.event?.settings?.['alias'] || statusState.alias;
      statusState.isLoggedIn = true;
      statusState.errorMsg = ''; // Очищаем ошибки при успешном входе

      // Разрешаем ожидание логина
      if (loginResolver) {
        if (loginTimeoutId) clearTimeout(loginTimeoutId);
        loginResolver();
        loginResolver = null;
        loginTimeoutId = null;
      }

      if (statusState.backendPort) {
        startMessenger(statusState.backendPort).catch((e) => {
          statusState.errorMsg = `Messenger start failed: ${e.message || e}`;
        });
      }
    }

    if (parsed.type === 'messages.new') {
      statusState.lastMessageSignal++; // Триггер для обновления UI
    }
  } catch (e) {
    console.warn("Failed to parse signal:", rawJson, { cause: e });
  }
}

/**
 * Ожидает сигнал node.login.
 * @param timeoutMs - Таймаут в миллисекундах (по умолчанию 30 секунд)
 */
export function waitForLogin(timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (statusState.isLoggedIn) return resolve();

    loginResolver = resolve;

    loginTimeoutId = setTimeout(() => {
      if (loginResolver === resolve) {
        loginResolver = null;
        loginTimeoutId = null;
        reject(new Error("Login timeout: no response from backend"));
      }
    }, timeoutMs);
  });
}

export function setAccounts(accounts: any[]) {
  statusState.accounts = accounts;
}

export function setNetworkInfo(
  networkName: string,
  rpcUrl: string,
  wakuFleet: string,
  isTestnet: boolean,
  chainId: number
) {
  statusState.networkName = networkName;
  statusState.rpcUrl = rpcUrl;
  statusState.wakuFleet = wakuFleet;
  statusState.isTestnet = isTestnet;
  statusState.chainId = chainId;
}

export function setPendingRequestsCount(count: number) {
  statusState.pendingRequestsCount = count;
}

export async function logout() {
  if (!statusState.backendPort) return;

  try {
    await apiLogout(statusState.backendPort);
  } catch (e: any) {
    console.warn("Logout API call failed:", e);
  }

  // Сбрасываем сессию, но оставляем настройки сети и список аккаунтов
  statusState.isLoggedIn = false;
  statusState.accountKeyUid = '';
  statusState.publicKey = '';
  statusState.alias = '';
  statusState.events = [];
  statusState.errorMsg = '';
  statusState.pendingRequestsCount = 0;
  statusState.lastMessageSignal = 0;
}

export function resetState() {
  statusState.isConnected = false;
  statusState.isConnecting = false;
  statusState.isLoggedIn = false;
  statusState.accountKeyUid = '';
  statusState.publicKey = '';
  statusState.alias = '';
  statusState.events = [];
  statusState.backendPort = null;
  statusState.backendDataDir = '';
  statusState.errorMsg = '';
  statusState.accounts = [];
  statusState.networkName = 'mainnet';
  statusState.rpcUrl = '';
  statusState.wakuFleet = 'status.prod';
  statusState.isTestnet = false;
  statusState.chainId = 1;
  statusState.pendingRequestsCount = 0;
  statusState.lastMessageSignal = 0;
}
