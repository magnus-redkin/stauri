import { invoke } from "@tauri-apps/api/core";
import { statusFetch } from "./http";
import type { StartBackendResponse, InitializeResponse } from "./types";

/**
 * Запускает локальный бэкенд и возвращает порт и путь к данным
 */
export async function startBackend(): Promise<StartBackendResponse> {
  return await invoke<StartBackendResponse>('start_backend');
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
export async function initializeApplication(port: number, dataDir: string): Promise<InitializeResponse> {
  return await statusFetch<InitializeResponse>(port, "InitializeApplication", {
    dataDir
  });
}

/**
 * Создает аккаунт и логинит в него
 */
export async function createAccountAndLogin(port: number, dataDir: string, password: string): Promise<any> {
  return await statusFetch(port, "CreateAccountAndLogin", {
    rootDataDir: dataDir,
    displayName: "Tauri User",
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


export async function loginAccount(port: number, password: string, keyUid: string): Promise<any> {
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
 * В status-go для этого используется wallet_getBalances (или fetchOrGetCachedWalletBalances).
 * Параметры: массив адресов и опционально chainIds.
 */

export async function getBalances(port: number, addresses: string[]): Promise<any> {
  return await statusFetch(port, "CallRPC", {
    jsonrpc: "2.0",
    id: 2,
    method: "wallet_fetchOrGetCachedWalletBalances", // <-- правильное имя
    params: [addresses, false] // [адреса, forceRefresh=false]
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
 * Выход из текущего аккаунта (сбрасывает состояние, но не убивает процесс)
 */
export async function logout(port: number): Promise<any> {
  return await statusFetch(port, "Logout", {});
}

/**
 * Получает обновленный список аккаунтов из бэкенда
 */
export async function getAccountsList(port: number, dataDir: string): Promise<any[]> {
  const data = await initializeApplication(port, dataDir);
  return data.accounts || [];
}
