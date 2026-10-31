import { statusState } from './statusStore.svelte';
import { getContacts, sendContactRequest, acceptContactRequest } from '$lib/status/api';
import { setPendingRequestsCount } from './statusStore.svelte';

export const contactsState = $state({
  items: [] as any[],
  selected: null as any | null,
  isLoading: false,
  loaded: false,
  error: '',
});

export async function loadContacts(force = false) {
  if (!statusState.backendPort) return;
  if (contactsState.loaded && !force) return;

  contactsState.isLoading = true;
  try {
    const res = await getContacts(statusState.backendPort);
    contactsState.items = res.result || [];
    const pendingCount = contactsState.items.filter((c: any) => c.contactRequestState === 3).length;
    setPendingRequestsCount(pendingCount);
    contactsState.loaded = true;
  } catch (e: any) {
    contactsState.error = e.message;
  } finally {
    contactsState.isLoading = false;
  }
}

export function selectContact(contact: any | null) {
  contactsState.selected = contact;
}

export async function acceptRequest(contactId: string) {
  if (!statusState.backendPort) return;
  try {
    await acceptContactRequest(statusState.backendPort, contactId);
    await loadContacts(true);
  } catch (e) {
    console.warn("Failed to accept:", e);
  }
}

export function resetContacts() {
  contactsState.items = [];
  contactsState.selected = null;
  contactsState.loaded = false;
}
