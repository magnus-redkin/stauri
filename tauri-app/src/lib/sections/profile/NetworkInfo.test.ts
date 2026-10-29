import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import NetworkInfo from './NetworkInfo.svelte';
import { statusState, resetState, setNetworkInfo } from '$lib/stores/statusStore.svelte';

describe('NetworkInfo Component', () => {
  beforeEach(() => {
    // Гарантируем чистое состояние перед каждым тестом
    resetState();
  });

  it('должен корректно отображать информацию о Mainnet', () => {
    setNetworkInfo('mainnet', 'https://ethereum-rpc.publicnode.com', 'status.prod', false, 1);

    render(NetworkInfo);

    // Проверяем тексты
    expect(screen.getByText('Ethereum Mainnet')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // Chain ID
    expect(screen.getByText('https://ethereum-rpc.publicnode.com')).toBeInTheDocument();
    expect(screen.getByText('status.prod')).toBeInTheDocument();

    // Проверяем наличие бейджа Mainnet и отсутствие Testnet
    expect(screen.getByText('Mainnet')).toBeInTheDocument();
    expect(screen.queryByText('Testnet')).not.toBeInTheDocument();
  });

  it('должен корректно отображать информацию о Sepolia Testnet', () => {
    setNetworkInfo('sepolia', 'https://rpc.sepolia.org', 'status.test', true, 11155111);

    render(NetworkInfo);

    expect(screen.getByText('SEPOLIA')).toBeInTheDocument();
    expect(screen.getByText('11155111')).toBeInTheDocument();
    expect(screen.getByText('https://rpc.sepolia.org')).toBeInTheDocument();
    expect(screen.getByText('status.test')).toBeInTheDocument();

    // Проверяем наличие бейджа Testnet и отсутствие Mainnet
    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(screen.queryByText('Mainnet')).not.toBeInTheDocument();
  });

  it('должен корректно отображать информацию о Holesky Testnet', () => {
    setNetworkInfo('holesky', 'https://ethereum-holesky-rpc.publicnode.com', 'status.test', true, 17000);

    render(NetworkInfo);

    expect(screen.getByText('HOLESKY')).toBeInTheDocument();
    expect(screen.getByText('17000')).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
  });

  it('должен отображать "unknown" для нераспознанной сети', () => {
    // Симулируем кастомную сеть, которую нет в getChainId()
    statusState.networkName = 'custom-network';
    statusState.isTestnet = true;
    statusState.rpcUrl = 'https://custom.rpc';
    statusState.wakuFleet = 'custom.fleet';

    render(NetworkInfo);

    expect(screen.getByText('CUSTOM-NETWORK')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
