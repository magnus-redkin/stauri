import type { StatusEvent, NodeLoginEvent } from '$lib/status/types';
import { startMessenger, logout as apiLogout } from '$lib/status/api';

export const statusState = $state({
  isConnected: false,
  isConnecting: false,
  isLoggedIn: false,
  accountKeyUid: '',
  publicKey: '',
  backendPort: null as number | null,
  backendDataDir: '',
  events: [] as StatusEvent[],
  errorMsg: '',
  accounts: [] as any[],

  pendingRequestsCount: 0,
  lastMessageSignal: 0, // <-- Счётчик для триггера обновления

  // Сетевая информация
  networkName: 'mainnet',
  rpcUrl: '',
  wakuFleet: 'status.prod',
  isTestnet: false,
});

export function setNetworkInfo(networkName: string, rpcUrl: string, wakuFleet: string, isTestnet: boolean) {
  statusState.networkName = networkName;
  statusState.rpcUrl = rpcUrl;
  statusState.wakuFleet = wakuFleet;
  statusState.isTestnet = isTestnet;
}

export function setAccounts(accounts: any[]) {
  statusState.accounts = accounts;
}

export function processSignal(rawJson: string) {
  if (!rawJson) return;

  try {
    const parsed = JSON.parse(rawJson) as StatusEvent;

    // Добавляем событие в массив (для отладки)
    statusState.events.push(parsed);

    // Обработка node.login
    if (parsed.type === 'node.login') {
      const loginEvent = parsed as NodeLoginEvent;

      if (loginEvent.event?.error) {
        statusState.errorMsg = `Login failed: ${loginEvent.event.error}`;
        return;
      }

      statusState.accountKeyUid = loginEvent.event?.settings?.['key-uid'] || statusState.accountKeyUid;
      statusState.publicKey = loginEvent.event?.settings?.['public-key'] || statusState.publicKey;
      statusState.isLoggedIn = true;

      if (statusState.backendPort) {
        startMessenger(statusState.backendPort).catch((e) => {
          statusState.errorMsg = `Messenger start failed: ${e.message || e}`;
          console.error("Failed to start messenger:", e);
        });
      }
    }

    // Обработка новых сообщений (для обновления UI)
    if (parsed.type === 'messages.new') {
      statusState.lastMessageSignal++; // <-- Триггер для перезагрузки chats/messages
    }

    // Обработка изменений в контактах (например, запрос принят)
    if (parsed.type === 'messages.new' || parsed.type === 'contact.request.accepted') {
      // Можно добавить дополнительную логику, если нужно
    }
  } catch (e) {
    console.warn("Failed to parse signal:", rawJson);
  }
}
export async function logout() {
  if (!statusState.backendPort) return;

  try {
    await apiLogout(statusState.backendPort);
  } catch (e: any) {
    console.warn("Logout API call failed:", e);
  }

  statusState.isLoggedIn = false;
  statusState.accountKeyUid = '';
  statusState.events = [];
  statusState.errorMsg = '';
}

export function resetState() {
  statusState.isConnected = false;
  statusState.isConnecting = false;
  statusState.isLoggedIn = false;
  statusState.accountKeyUid = '';
  statusState.events = [];
  statusState.backendPort = null;
  statusState.publicKey = '';
  statusState.backendDataDir = '';
  statusState.errorMsg = '';
  statusState.accounts = [];
  statusState.networkName = 'mainnet';
  statusState.rpcUrl = '';
  statusState.wakuFleet = 'status.prod';
  statusState.isTestnet = false;
}

export function setPublicKey(key: string) {
  statusState.publicKey = key;
}

export function setPendingRequestsCount(count: number) {
  statusState.pendingRequestsCount = count;
}
