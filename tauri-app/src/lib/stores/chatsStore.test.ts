import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatsState, loadChats, selectChat, setSelectedChat, resetChats } from './chatsStore.svelte';
import { statusState } from './statusStore.svelte';
import { getChats, getContacts } from '$lib/status/api';
import { getDisplayName } from '$lib/utils/user';

// Мокаем API
vi.mock('$lib/status/api', () => ({
  getChats: vi.fn(),
  getContacts: vi.fn(),
}));

// Мокаем statusState
vi.mock('./statusStore.svelte', () => ({
  statusState: { backendPort: 12345 },
}));

// Мокаем getDisplayName
vi.mock('$lib/utils/user', () => ({
  getDisplayName: (entity: any) => entity.displayName || entity.alias || entity.name || entity.id.slice(0, 8),
}));

describe('chatsStore', () => {
  beforeEach(() => {
    resetChats();
    vi.clearAllMocks();
  });

  it('должен загружать чаты и контакты', async () => {
    const mockChats = [
      { id: '0x123', name: 'Chat 1', lastMessage: { text: 'Hello' }, active: true },
      { id: '0x456', name: 'Chat 2', lastMessage: { text: 'World' }, active: false, lastMessageContactRequestState: 1 },
    ];
    const mockContacts = [
      { id: '0x123', alias: 'Alice' },
    ];

    (getChats as any).mockResolvedValue({ result: mockChats });
    (getContacts as any).mockResolvedValue({ result: mockContacts });

    await loadChats();

    expect(chatsState.items).toHaveLength(2);
    expect(chatsState.contacts).toHaveLength(1);
    expect(chatsState.loaded).toBe(true);
    expect(chatsState.items[0].name).toBe('Alice'); // Из контакта
    expect(chatsState.items[1].name).toBe('Chat 2'); // Из чата
  });

  it('должен выбирать чат по id', () => {
    chatsState.items = [
      { id: '0x123', name: 'Chat 1' } as any,
      { id: '0x456', name: 'Chat 2' } as any,
    ];

    selectChat('0x456');

    expect(chatsState.selected?.id).toBe('0x456');
    expect(chatsState.selected?.name).toBe('Chat 2');
  });

  it('должен выбирать объект чата напрямую', () => {
    const chat = { id: '0x789', name: 'Chat 3' } as any;
    setSelectedChat(chat);
    expect(chatsState.selected).toEqual(chat);
  });

  it('не должен загружать чаты, если loaded=true и force=false', async () => {
    chatsState.loaded = true;
    await loadChats();
    expect(getChats).not.toHaveBeenCalled();
  });

  it('должен сбрасывать состояние', () => {
    chatsState.items = [{ id: '0x123' } as any];
    chatsState.selected = { id: '0x123' } as any;
    chatsState.loaded = true;

    resetChats();

    expect(chatsState.items).toHaveLength(0);
    expect(chatsState.selected).toBeNull();
    expect(chatsState.loaded).toBe(false);
  });
});
