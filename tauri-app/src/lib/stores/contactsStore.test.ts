import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contactsState, loadContacts, selectContact, acceptRequest, resetContacts } from './contactsStore.svelte';
import { statusState } from './statusStore.svelte';
import { getContacts, acceptContactRequest } from '$lib/status/api';

// Мокаем API
vi.mock('$lib/status/api', () => ({
  getContacts: vi.fn(),
  acceptContactRequest: vi.fn(),
  setPendingRequestsCount: vi.fn(),
}));

// Мокаем стор (setPendingRequestsCount)
vi.mock('./statusStore.svelte', () => ({
  statusState: { backendPort: 12345 },
  setPendingRequestsCount: vi.fn(),
}));

describe('contactsStore', () => {
  beforeEach(() => {
    resetContacts();
    vi.clearAllMocks();
  });

  it('должен загружать контакты и обновлять состояние', async () => {
    const mockContacts = [
      { id: '0x123', contactRequestState: 1, mutual: true },
      { id: '0x456', contactRequestState: 3, mutual: false },
    ];
    (getContacts as any).mockResolvedValue({ result: mockContacts });

    await loadContacts();

    expect(contactsState.items).toHaveLength(2);
    expect(contactsState.loaded).toBe(true);
    expect(contactsState.isLoading).toBe(false);
  });

  it('должен выбирать контакт', () => {
    const contact = { id: '0x123', mutual: true };
    selectContact(contact);
    expect(contactsState.selected).toEqual(contact);

    selectContact(null);
    expect(contactsState.selected).toBeNull();
  });

  it('должен принимать запрос и перезагружать контакты', async () => {
    const mockContacts = [{ id: '0x123', contactRequestState: 3 }];
    (getContacts as any).mockResolvedValue({ result: mockContacts });
    (acceptContactRequest as any).mockResolvedValue({});

    await acceptRequest('0x123');

    expect(acceptContactRequest).toHaveBeenCalledWith(12345, '0x123');
    expect(getContacts).toHaveBeenCalled(); // Перезагрузка после принятия
  });

  it('не должен загружать контакты, если loaded=true и force=false', async () => {
    contactsState.loaded = true;
    await loadContacts();
    expect(getContacts).not.toHaveBeenCalled();
  });

  it('должен сбрасывать состояние', () => {
    contactsState.items = [{ id: '0x123' }];
    contactsState.selected = { id: '0x123' };
    contactsState.loaded = true;

    resetContacts();

    expect(contactsState.items).toHaveLength(0);
    expect(contactsState.selected).toBeNull();
    expect(contactsState.loaded).toBe(false);
  });
});
