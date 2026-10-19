import type { StatusEvent, NodeLoginEvent } from '$lib/status/types';

export const statusState = $state({
  isConnected: false,
  isLoggedIn: false,
  accountKeyUid: '',
  backendPort: null as number | null,
  backendDataDir: '',
  events: [] as StatusEvent[],
  errorMsg: '',
});

export function processSignal(rawJson: string) {
  try {
    const parsed = JSON.parse(rawJson) as StatusEvent;

    // Добавляем событие в массив (используем push для $state)
    statusState.events.push(parsed);

    if (parsed.type === 'node.login') {
      const loginEvent = parsed as NodeLoginEvent;

      if (loginEvent.event?.error) {
        statusState.errorMsg = `Login failed: ${loginEvent.event.error}`;
        return;
      }

      statusState.accountKeyUid = loginEvent.event?.settings?.['key-uid'] || statusState.accountKeyUid;
      statusState.isLoggedIn = true;
    }
  } catch (e) {
    console.warn("Failed to parse signal:", rawJson);
  }
}

export function resetState() {
  statusState.isConnected = false;
  statusState.isLoggedIn = false;
  statusState.accountKeyUid = '';
  statusState.events = [];
  statusState.backendPort = null;
  statusState.backendDataDir = '';
  statusState.errorMsg = '';
}
