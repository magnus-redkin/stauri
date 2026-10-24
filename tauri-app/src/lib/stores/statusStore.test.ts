import { describe, it, expect, beforeEach } from 'vitest';
import { statusState, setNetworkInfo, setAccounts, resetState, processSignal } from './statusStore.svelte';

describe('statusStore', () => {
  beforeEach(() => {
    // Сбрасываем состояние перед каждым тестом
    resetState();
  });

  describe('initial state', () => {
    it('должен иметь дефолтные значения mainnet', () => {
      expect(statusState.networkName).toBe('mainnet');
      expect(statusState.isTestnet).toBe(false);
      expect(statusState.wakuFleet).toBe('status.prod');
      expect(statusState.rpcUrl).toBe('');
      expect(statusState.isConnected).toBe(false);
      expect(statusState.isLoggedIn).toBe(false);
    });
  });

  describe('setNetworkInfo', () => {
    it('должен обновлять сетевую информацию', () => {
      setNetworkInfo('sepolia', 'https://rpc.sepolia.org', 'status.test', true);

      expect(statusState.networkName).toBe('sepolia');
      expect(statusState.rpcUrl).toBe('https://rpc.sepolia.org');
      expect(statusState.wakuFleet).toBe('status.test');
      expect(statusState.isTestnet).toBe(true);
    });

    it('должен устанавливать mainnet', () => {
      setNetworkInfo('mainnet', 'https://ethereum-rpc.publicnode.com', 'status.prod', false);

      expect(statusState.networkName).toBe('mainnet');
      expect(statusState.isTestnet).toBe(false);
    });
  });

  describe('setAccounts', () => {
    it('должен устанавливать список аккаунтов', () => {
      const mockAccounts = [
        { 'key-uid': 'uid-1', displayName: 'Account 1' },
        { 'key-uid': 'uid-2', displayName: 'Account 2' }
      ];

      setAccounts(mockAccounts);

      expect(statusState.accounts).toHaveLength(2);
      expect(statusState.accounts[0]['key-uid']).toBe('uid-1');
    });

    it('должен очищать аккаунты при передаче пустого массива', () => {
      setAccounts([{ 'key-uid': 'uid-1' }]);
      setAccounts([]);

      expect(statusState.accounts).toHaveLength(0);
    });
  });

  describe('resetState', () => {
    it('должен сбрасывать все поля к дефолтным значениям', () => {
      // Устанавливаем кастомные значения
      setNetworkInfo('sepolia', 'https://rpc.sepolia.org', 'status.test', true);
      setAccounts([{ 'key-uid': 'uid-1' }]);
      statusState.isConnected = true;
      statusState.isLoggedIn = true;
      statusState.backendPort = 12345;
      statusState.backendDataDir = '/tmp/test';
      statusState.accountKeyUid = 'uid-1';
      statusState.errorMsg = 'Some error';

      // Сбрасываем
      resetState();

      // Проверяем сброс
      expect(statusState.networkName).toBe('mainnet');
      expect(statusState.isTestnet).toBe(false);
      expect(statusState.accounts).toHaveLength(0);
      expect(statusState.isConnected).toBe(false);
      expect(statusState.isLoggedIn).toBe(false);
      expect(statusState.backendPort).toBeNull();
      expect(statusState.backendDataDir).toBe('');
      expect(statusState.accountKeyUid).toBe('');
      expect(statusState.errorMsg).toBe('');
    });
  });

  describe('processSignal', () => {
    it('должен обрабатывать сигнал node.login', () => {
      const loginSignal = JSON.stringify({
        type: 'node.login',
        event: {
          settings: {
            'key-uid': 'test-uid-123'
          }
        }
      });

      processSignal(loginSignal);

      expect(statusState.isLoggedIn).toBe(true);
      expect(statusState.accountKeyUid).toBe('test-uid-123');
    });

    it('должен обрабатывать ошибку входа', () => {
      const errorSignal = JSON.stringify({
        type: 'node.login',
        event: {
          error: 'Invalid password'
        }
      });

      processSignal(errorSignal);

      expect(statusState.errorMsg).toBe('Login failed: Invalid password');
      expect(statusState.isLoggedIn).toBe(false);
    });

    it('должен игнорировать невалидный JSON', () => {
      const invalidJson = 'not a json';

      // Не должно выбросить исключение
      expect(() => processSignal(invalidJson)).not.toThrow();
    });

    it('должен игнорировать пустую строку', () => {
      expect(() => processSignal('')).not.toThrow();
    });
  });
});
