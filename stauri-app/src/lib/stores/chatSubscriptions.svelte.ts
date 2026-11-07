/**
 * Каналы, которые пользователь сознательно добавил в список чатов.
 *
 * ## Зачем это нужно
 *
 * Раньше левая панель показывала всё, что status-go знал о сообществах: при
 * просмотре сообщества (`spectateCommunity`) бэкенд создаёт записи `Chat` для
 * всех его каналов сразу, и они попадали в список целиком. В результате
 * панель выглядела списком сообществ, а не чатов: десять каналов одного
 * сообщества вытесняли личную переписку.
 *
 * Теперь в списке только то, что пользователь выбрал сам:
 *   * личные чаты (1-1) — всегда;
 *   * внешние ленты — они и так добавляются вручную;
 *   * каналы сообществ — только открытые из каталога в разделе dApp.
 *
 * ## Почему localStorage
 *
 * Отметка «этот канал я добавил» — наше состояние, а не серверное: в
 * status-go нет поля «канал показан в списке», есть только `active` у самого
 * чата, и трогать его значило бы менять поведение мессенджера. Настройки
 * приложения уже живут в `localStorage`, и это тот же класс данных.
 *
 * Ограничение известно: привязка к webview, а не к профилю. Когда появится
 * своё хранилище настроек (после перехода на Logos), переедет туда.
 */

import { SvelteSet } from 'svelte/reactivity';
import { debug, info, warn } from '$lib/utils/log';

const STORAGE_KEY = 'stauri:chat-channels';

/**
 * id добавленных каналов.
 *
 * `SvelteSet` реактивен сам, поэтому не оборачивается в `$state` и не
 * переприсваивается: шаблон списка читает его напрямую.
 */
export const subscribedChannels = new SvelteSet<string>();

let loaded = false;

/** Читает отметки с диска. Ошибка чтения не должна ломать список. */
export function loadChannelSubscriptions(): void {
  if (loaded) return;
  loaded = true;

  if (typeof localStorage === 'undefined') return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;

    for (const id of parsed) {
      if (typeof id === 'string' && id) subscribedChannels.add(id);
    }
    info(`[channels] loaded ${subscribedChannels.size} channel(s)`);
  } catch (e) {
    warn('[channels] failed to read subscriptions, starting empty:', e);
  }
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...subscribedChannels]));
  } catch (e) {
    warn('[channels] failed to persist subscriptions:', e);
  }
}

/** Отмечает канал как добавленный в список чатов. */
export function subscribeChannel(chatId: string): void {
  if (!chatId || subscribedChannels.has(chatId)) return;
  subscribedChannels.add(chatId);
  persist();
  debug(`[channels] added ${chatId}`);
}

/** Убирает отметку: канал перестаёт появляться в списке. */
export function unsubscribeChannel(chatId: string): void {
  if (!subscribedChannels.delete(chatId)) return;
  persist();
  debug(`[channels] removed ${chatId}`);
}

export function isSubscribedChannel(chatId: string): boolean {
  return subscribedChannels.has(chatId);
}

/** Только для тестов: сбрасывает состояние перед каждым кейсом. */
export function resetChannelSubscriptions(): void {
  subscribedChannels.clear();
  loaded = false;
}
