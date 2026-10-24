import { invoke } from "@tauri-apps/api/core";
import { statusFetch } from "./http";
import type { StartBackendResponse, InitializeResponse } from "./types";

/**
 * Запускает локальный бэкенд и возвращает порт и путь к данным
 */
export async function startBackend(network?: string): Promise<StartBackendResponse> {
  return await invoke<StartBackendResponse>('start_backend', { network });
}

/**
 * Останавливает бэкенд
 */
export async function stopBackend(): Promise<void> {
  await invoke('stop_backend');
}

/**
 * Инициализирует приложение в указанной директории
 */
export async function initializeApplication(port: number, dataDir: string, networkId: number): Promise<any> {
  return await statusFetch(port, "InitializeApplication", {
    dataDir: dataDir,
    NetworkID: networkId,
  });
}

/**
 * Создает аккаунт и логинит в него
 */
export async function createAccountAndLogin(port: number, dataDir: string, password: string): Promise<any> {
  console.log("API: Вызов CreateAccountAndLogin с dataDir:", dataDir);
  return await statusFetch(port, "CreateAccountAndLogin", {
    rootDataDir: dataDir,
    displayName: "Stauri User",
    password: password,
    customizationColor: "primary"
  });
}

/**
 * Запускает мессенджер (необходим для получения сообщений)
 */
export async function startMessenger(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 1,
    method: "wakuext_startMessenger",
    params: []
  });
}

/**
 * Вход в существующий аккаунт
 */

export async function loginAccount(port: number, password: string, keyUid: string): Promise<any> {
  console.log("API loginAccount:", { port, password, keyUid });
  return await statusFetch(port, "LoginAccount", {
    password: password,
    keyUid: keyUid
  });
}

/**
 * Запускает сервис кошелька
 */
export async function startWallet(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 1,
    method: "wallet_startWallet",
    params: []
  });
}

/**
 * Получает балансы для указанных адресов.
 */
export async function getBalances(port: number, addresses: string[]): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 2,
    method: "wallet_fetchOrGetCachedWalletBalances",
    params: [addresses, false]
  });
}

/**
 * Получает настройки (в них есть wallet-root-address)
 */
export async function getSettings(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 3,
    method: "settings_getSettings",
    params: []
  });
}

/**
 * Выход из текущего аккаунта
 */
export async function logout(port: number): Promise<any> {
  // Пробуем через CallRPC, так как прямой эндпоинт Logout может быть недоступен
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 1,
    method: "wakuext_logout",
    params: []
  });
}

/**
 * Получает обновленный список аккаунтов (через InitializeApplication, так как это надежнее)
 */
export async function getAccountsList(port: number, dataDir: string, networkId: number): Promise<any[]> {
  const data = await initializeApplication(port, dataDir, networkId);
  return data.accounts || [];
}

/**
 * Получает список чатов
 */
export async function getChats(port: number): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 1,
    method: "wakuext_chats",
    params: []
  });
}

/**
 * Получает историю сообщений для чата
 */
export async function getChatMessages(port: number, chatId: string, limit: number = 20): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 2,
    method: "wakuext_chatMessages",
    params: [chatId, "", limit] // [chatId, cursor, limit]
  });
}

/**
 * Отправляет сообщение в чат
 */
export async function sendChatMessage(port: number, chatId: string, text: string): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 3,
    method: "wakuext_sendChatMessage",
    params: [{
      chatId: chatId,
      text: text,
      contentType: 1
    }]
  });
}
