import { statusState } from './statusStore.svelte';
import { getChats as apiGetChats, getContacts } from '$lib/status/api';
import { getDisplayName } from '$lib/utils/user';
import type { ChatItem } from '$lib/sections/chat/ChatLeft.svelte';

export const chatsState = $state({
  items: [] as ChatItem[],
  contacts: [] as any[],
  selected: null as ChatItem | null,
  loaded: false,
  isLoading: false,
});

/**
 * Загружает чаты и контакты (для имён).
 * @param force - если true, игнорирует флаг loaded.
 */
export async function loadChats(force = false) {
  if (!statusState.backendPort) return;
  if (chatsState.loaded && !force) return;

  chatsState.isLoading = true;
  try {
    const chatsRes = await apiGetChats(statusState.backendPort);
    const rawChats = chatsRes.result || [];

    const contactsRes = await getContacts(statusState.backendPort);
    chatsState.contacts = contactsRes.result || [];

    chatsState.items = rawChats.map((c: any) => {
      const contact = chatsState.contacts.find((ct: any) => ct.id === c.id);
      const name = contact ? getDisplayName(contact) : getDisplayName(c);
      return {
        id: c.id,
        name,
        lastMessage: c.lastMessage?.text || '',
        type: 'status' as const,
        isPendingRequest: c.active === false && c.lastMessage?.contactRequestState === 1,
      };
    });

    chatsState.loaded = true;
  } catch (e) {
    console.warn("Failed to load chats:", e);
  } finally {
    chatsState.isLoading = false;
  }
}

/**
 * Выбирает чат по id (если он есть в списке).
 */
export function selectChat(chatId: string) {
  const chat = chatsState.items.find(c => c.id === chatId) || null;
  chatsState.selected = chat;
}

/**
 * Выбирает объект чата напрямую.
 */
export function setSelectedChat(chat: ChatItem | null) {
  chatsState.selected = chat;
}

export function resetChats() {
  chatsState.items = [];
  chatsState.contacts = [];
  chatsState.selected = null;
  chatsState.loaded = false;
  chatsState.isLoading = false;
}
