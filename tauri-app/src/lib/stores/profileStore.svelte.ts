import { statusState, setSeedSaved } from './statusStore.svelte';

/**
 * Возвращает отображаемое имя (alias или displayName).
 */
export function getAlias(): string {
  return statusState.alias || 'User';
}

/**
 * Проверяет, сохранена ли seed-фраза.
 */
export function isSeedSaved(): boolean {
  return statusState.isSeedSaved;
}

/**
 * Сохраняет флаг seed-фразы (и в localStorage).
 */
export function saveSeedStatus(saved: boolean) {
  setSeedSaved(saved);
}

/**
 * Возвращает публичный ключ профиля.
 */
export function getPublicKey(): string {
  return statusState.publicKey || '';
}

/**
 * Возвращает Profile ID (key-uid).
 */
export function getProfileId(): string {
  return statusState.accountKeyUid || '';
}

/**
 * Возвращает список аккаунтов.
 */
export function getAccounts(): any[] {
  return statusState.accounts || [];
}
