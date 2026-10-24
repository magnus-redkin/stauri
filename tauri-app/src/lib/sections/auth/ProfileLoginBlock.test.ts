// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ProfileLoginBlock from './ProfileLoginBlock.svelte';
import { statusState, resetState, setAccounts } from '$lib/stores/statusStore.svelte';

describe('ProfileLoginBlock Component', () => {
  const mockOnLogin = vi.fn();

  beforeEach(() => {
    resetState();
    vi.clearAllMocks();

    // Подготавливаем тестовые данные аккаунтов
    setAccounts([
      { 'key-uid': '0x1234567890abcdef1234567890abcdef', displayName: 'Account 1' },
      { 'key-uid': '0xabcdef1234567890abcdef1234567890', displayName: 'Account 2' }
    ]);
  });

  it('должен корректно отображать список аккаунтов в select', () => {
    render(ProfileLoginBlock, {
      props: {
        selectedAccountKeyUid: '0x1234567890abcdef1234567890abcdef',
        password: '',
        onLogin: mockOnLogin
      }
    });

    // Проверяем, что select существует
    const selectElement = screen.getByRole('combobox');
    expect(selectElement).toBeInTheDocument();

    // Проверяем, что опции отрендерились (обрезаем до 16 символов, как в коде)
    expect(screen.getByText('0x1234567890abcd...')).toBeInTheDocument();
    expect(screen.getByText('0xabcdef12345678...')).toBeInTheDocument();
  });

  it('должен вызывать onLogin при клике на кнопку входа', async () => {
    render(ProfileLoginBlock, {
      props: {
        selectedAccountKeyUid: '0x1234567890abcdef1234567890abcdef',
        password: 'mysecretpassword',
        onLogin: mockOnLogin
      }
    });

    // Находим кнопку по тексту (учитывая i18n, предполагаем, что i18n.t('Log In') возвращает 'Log In' или аналогичное.
    // Если i18n возвращает ключ, используйте screen.getByText('Log In') или соответствующий ключ)
    const loginButton = screen.getByRole('button', { name: /log in|войти/i });

    // Симулируем клик
    await fireEvent.click(loginButton);

    // Проверяем, что колбэк был вызван
    expect(mockOnLogin).toHaveBeenCalledTimes(1);
  });

  it('должен корректно работать с пустым списком аккаунтов', () => {
    setAccounts([]); // Очищаем аккаунты

    render(ProfileLoginBlock, {
      props: {
        selectedAccountKeyUid: '',
        password: '',
        onLogin: mockOnLogin
      }
    });

    const selectElement = screen.getByRole('combobox');
    expect(selectElement).toBeInTheDocument();
    // Опций быть не должно
    expect(selectElement.children.length).toBe(0);
  });
});
