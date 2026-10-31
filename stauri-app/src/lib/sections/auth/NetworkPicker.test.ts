// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import NetworkPicker from './NetworkPicker.svelte';

describe('NetworkPicker', () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('должен показывать Mainnet как выбранный по умолчанию', () => {
    render(NetworkPicker, {
      props: {
        selectedNetwork: 'mainnet',
        onSelect: mockOnSelect,
      },
    });

    // Mainnet должен быть подсвечен (bg-green-50 или border-green-500)
    const mainnetButton = screen.getByText('Mainnet').closest('button');
    expect(mainnetButton).toHaveClass('border-green-500');
  });

  it('должен раскрывать список тестнетов при клике на Testnet', async () => {
    render(NetworkPicker, {
      props: {
        selectedNetwork: 'mainnet',
        onSelect: mockOnSelect,
      },
    });

    // Изначально Sepolia и Holesky не видны
    expect(screen.queryByText('Sepolia')).not.toBeInTheDocument();
    expect(screen.queryByText('Holesky')).not.toBeInTheDocument();

    // Кликаем на Testnet
    await fireEvent.click(screen.getByText('Testnet'));

    // Теперь они должны быть видны
    expect(screen.getByText('Sepolia')).toBeInTheDocument();
    expect(screen.getByText('Holesky')).toBeInTheDocument();
  });

  it('должен вызывать onSelect при выборе Sepolia', async () => {
    render(NetworkPicker, {
      props: {
        selectedNetwork: 'mainnet',
        onSelect: mockOnSelect,
      },
    });

    // Раскрываем список
    await fireEvent.click(screen.getByText('Testnet'));

    // Кликаем на Sepolia
    await fireEvent.click(screen.getByText('Sepolia'));

    expect(mockOnSelect).toHaveBeenCalledWith('sepolia');
  });

  it('должен вызывать onSelect при выборе Mainnet', async () => {
    render(NetworkPicker, {
      props: {
        selectedNetwork: 'sepolia',
        onSelect: mockOnSelect,
      },
    });

    // Кликаем на Mainnet
    await fireEvent.click(screen.getByText('Mainnet'));

    expect(mockOnSelect).toHaveBeenCalledWith('mainnet');
  });

  it('должен подсвечивать выбранный тестнет', () => {
    render(NetworkPicker, {
      props: {
        selectedNetwork: 'sepolia',
        onSelect: mockOnSelect,
      },
    });

    // Testnet должен быть подсвечен (bg-orange-50 или border-orange-500)
    const testnetButton = screen.getByText('Testnet').closest('button');
    expect(testnetButton).toHaveClass('border-orange-500');
  });
});
