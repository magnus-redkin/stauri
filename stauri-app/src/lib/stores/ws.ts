/**
 * WebSocket к `/signals` бэкенда.
 *
 * Вынесено из `connectionStore`: соединение не связано с реактивным
 * состоянием приложения — это ресурс, который нужно открыть, переиспользовать
 * и закрыть. Само состояние сокета наружу не отдаётся, только операции.
 */

import { processSignal } from './statusStore.svelte';
import { getAuthToken } from '$lib/status/api';
import WebSocket from '@tauri-apps/plugin-websocket';

let ws: WebSocket | null = null;

/** Открыт ли сокет в данный момент. */
export function isWsOpen(): boolean {
  return ws !== null;
}

/**
 * Подключает WebSocket (закрывая предыдущий, если он есть).
 *
 * Токен передаётся заголовком: обычный браузерный WebSocket заголовки
 * задать не позволяет, но плагин Tauri принимает ConnectionConfig.headers.
 * Прокси проверяет его до upgrade.
 *
 * `port` — порт аутентифицирующего прокси, а не бэкенда.
 */
export async function openWs(port: number): Promise<void> {
  await closeWs();

  const socket = await WebSocket.connect(`ws://127.0.0.1:${port}/signals`, {
    headers: { 'X-Stauri-Token': await getAuthToken() },
  });
  socket.addListener((msg) => {
    // msg.data приходит как string | number[] | CloseFrame | null
    if (typeof msg.data === 'string') processSignal(msg.data);
  });
  ws = socket;
}

/** Закрывает сокет, если он открыт. Повторный вызов безопасен. */
export async function closeWs(): Promise<void> {
  if (!ws) return;
  try {
    await ws.disconnect();
  } catch {
    /* закрытие сокета не критично: следующий connect создаст новый */
  }
  ws = null;
}
