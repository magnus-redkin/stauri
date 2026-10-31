// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ChatLeft from './ChatLeft.svelte';
import { chatsState } from '$lib/stores/chatsStore.svelte';

// Мокаем стор, чтобы не вызывать loadChats
vi.mock('$lib/stores/chatsStore.svelte', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadChats: vi.fn(),
  };
});

describe('ChatLeft', () => {
  beforeEach(() => {
    chatsState.items = [
      { id: '0x123', name: 'Alice Chat', lastMessage: 'Hello', type: 'status' },
      { id: '0x456', name: 'Bob Chat', lastMessage: 'World', type: 'status', isPendingRequest: true },
    ];
    chatsState.isLoading = false;
  });

  it('должен отображать список чатов', () => {
    render(ChatLeft, { props: {} });
    expect(screen.getByText('Alice Chat')).toBeInTheDocument();
    expect(screen.getByText('Bob Chat')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('должен фильтровать чаты по поиску', async () => {
    render(ChatLeft, { props: {} });
    const searchInput = screen.getByPlaceholderText(/Search chats/i);

    await fireEvent.input(searchInput, { target: { value: 'Alice' } });

    expect(screen.getByText('Alice Chat')).toBeInTheDocument();
    expect(screen.queryByText('Bob Chat')).not.toBeInTheDocument();
  });

  it('должен отображать иконку pending-запроса', () => {
    render(ChatLeft, { props: {} });
    // Для Bob Chat isPendingRequest = true, значит, должен быть значок "!"
    expect(screen.getByText('!')).toBeInTheDocument();
  });
});
