import type { StatusEvent, NodeLoginEvent } from '$lib/status/types';
import { startMessenger, logout as apiLogout } from '$lib/status/api';

export const statusState = $state({
  isConnected: false,
  isConnecting: false,
  isLoggedIn: false,
  accountKeyUid: '',
  backendPort: null as number | null,
  backendDataDir: '',
  events: [] as StatusEvent[],
  errorMsg: '',
  accounts: [] as any[],

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

    statusState.events.push(parsed);

    if (parsed.type === 'node.login') {
      const loginEvent = parsed as NodeLoginEvent;

      if (loginEvent.event?.error) {
        statusState.errorMsg = `Login failed: ${loginEvent.event.error}`;
        return;
      }

      statusState.accountKeyUid = loginEvent.event?.settings?.['key-uid'] || statusState.accountKeyUid;
      statusState.isLoggedIn = true;

      if (statusState.backendPort) {
        startMessenger(statusState.backendPort).catch((e) => {
          statusState.errorMsg = `Messenger start failed: ${e.message || e}`;
          console.error("Failed to start messenger:", e);
        });
      }
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
  statusState.isLoggedIn = false;
  statusState.accountKeyUid = '';
  statusState.events = [];
  statusState.backendPort = null;
  statusState.backendDataDir = '';
  statusState.errorMsg = '';
  statusState.accounts = [];
  statusState.networkName = 'mainnet';
  statusState.rpcUrl = '';
  statusState.wakuFleet = 'status.prod';
  statusState.isTestnet = false;
}
