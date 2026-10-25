// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MainEntryScreen from './MainEntryScreen.svelte';
import { resetState, setAccounts } from '$lib/stores/statusStore.svelte';

describe('MainEntryScreen Component', () => {
  const mockOnLogin = vi.fn();
  const mockOnCreate = vi.fn();
  const mockOnRecovery = vi.fn();
  const mockOnNetworkChange = vi.fn();

  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('должен показывать только CreateProfileBlock, если профилей нет', () => {
    setAccounts([]);

    render(MainEntryScreen, {
      props: {
        hasProfiles: false,
        selectedAccountKeyUid: '',
        selectedNetwork: 'mainnet',
        onLogin: mockOnLogin,
        onCreate: mockOnCreate,
        onRecovery: mockOnRecovery,
        onNetworkChange: mockOnNetworkChange
      }
    });

    // ProfileLoginBlock (с кнопкой Log In) не должен отрендериться
    expect(screen.queryByText('Log In')).not.toBeInTheDocument();

    // CreateProfileBlock (с заголовком Create new profile) должен быть
    expect(screen.getByText('Create new profile')).toBeInTheDocument();

    // Кнопка "+ Create new profile" не должна быть видна
    expect(screen.queryByText(/\+ Create new profile/i)).not.toBeInTheDocument();
  });

  it('должен показывать ProfileLoginBlock и кнопку "+ Create", если профили есть', () => {
    setAccounts([{ 'key-uid': 'uid-1' }]);

    render(MainEntryScreen, {
      props: {
        hasProfiles: true,
        selectedAccountKeyUid: 'uid-1',
        selectedNetwork: 'mainnet',
        onLogin: mockOnLogin,
        onCreate: mockOnCreate,
        onRecovery: mockOnRecovery,
        onNetworkChange: mockOnNetworkChange
      }
    });

    // ProfileLoginBlock рендерит кнопку "Log In"
    expect(screen.getByText('Log In')).toBeInTheDocument();

    // Кнопка "+ Create new profile" должна быть
    expect(screen.getByText(/\+ Create new profile/i)).toBeInTheDocument();

    // CreateProfileBlock (с заголовком "Create new profile" как h3) не должен быть виден
    expect(screen.queryByText('Create new profile')).not.toBeInTheDocument();
  });

  it('должен показывать CreateProfileBlock при клике на "+ Create new profile"', async () => {
    setAccounts([{ 'key-uid': 'uid-1' }]);

    render(MainEntryScreen, {
      props: {
        hasProfiles: true,
        selectedAccountKeyUid: 'uid-1',
        selectedNetwork: 'mainnet',
        onLogin: mockOnLogin,
        onCreate: mockOnCreate,
        onRecovery: mockOnRecovery,
        onNetworkChange: mockOnNetworkChange
      }
    });

    // Изначально CreateProfileBlock нет
    expect(screen.queryByText('Create new profile')).not.toBeInTheDocument();

    // Кликаем на "+ Create new profile"
    const createButton = screen.getByText(/\+ Create new profile/i);
    await fireEvent.click(createButton);

    // Теперь CreateProfileBlock должен появиться
    expect(screen.getByText('Create new profile')).toBeInTheDocument();

    // ProfileLoginBlock не исчезает
    expect(screen.getByText('Log In')).toBeInTheDocument();
  });

  it('должен вызывать onRecovery при клике на "Log in by recovery phrase"', async () => {
    render(MainEntryScreen, {
      props: {
        hasProfiles: false,
        selectedAccountKeyUid: '',
        selectedNetwork: 'mainnet',
        onLogin: mockOnLogin,
        onCreate: mockOnCreate,
        onRecovery: mockOnRecovery,
        onNetworkChange: mockOnNetworkChange
      }
    });

    const recoveryButton = screen.getByText(/Log in by recovery phrase/i);
    await fireEvent.click(recoveryButton);

    expect(mockOnRecovery).toHaveBeenCalledTimes(1);
  });
});
