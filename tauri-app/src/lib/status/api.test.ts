import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './api';
import * as http from './http';
import { invoke } from '@tauri-apps/api/core';

// Мокаем внешние зависимости
vi.mock('@tauri-apps/api/core');
vi.mock('./http');

describe('Status API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startBackend', () => {
    it('должен вызывать invoke с правильными аргументами для sepolia', async () => {
      const mockResponse = {
        port: 1234, dataDir: '/tmp/sepolia', networkName: 'sepolia',
        chainId: 11155111, rpcUrl: 'https://rpc.sepolia.org', wakuFleet: 'status.test', isTestnet: true
      };
      vi.mocked(invoke).mockResolvedValue(mockResponse);

      const result = await api.startBackend('sepolia');

      expect(invoke).toHaveBeenCalledWith('start_backend', { network: 'sepolia' });
      expect(result).toEqual(mockResponse);
    });

    it('должен вызывать invoke без network по умолчанию', async () => {
      vi.mocked(invoke).mockResolvedValue({ port: 1234, dataDir: '/tmp', networkName: 'mainnet', chainId: 1, rpcUrl: '', wakuFleet: '', isTestnet: false });

      await api.startBackend();

      expect(invoke).toHaveBeenCalledWith('start_backend', { network: undefined });
    });
  });

  describe('initializeApplication', () => {
    it('должен вызывать statusFetch с правильным payload', async () => {
      const mockResponse = { accounts: [{ 'key-uid': 'test-123' }] };
      vi.mocked(http.statusFetch).mockResolvedValue(mockResponse);

      const result = await api.initializeApplication(8080, '/tmp/data', 11155111);

      expect(http.statusFetch).toHaveBeenCalledWith(8080, 'InitializeApplication', {
        dataDir: '/tmp/data',
        NetworkID: 11155111,
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createAccountAndLogin', () => {
    it('должен формировать корректный запрос на создание аккаунта', async () => {
      vi.mocked(http.statusFetch).mockResolvedValue({ error: '' });

      await api.createAccountAndLogin(8080, '/tmp/data', 'supersecret');

      expect(http.statusFetch).toHaveBeenCalledWith(8080, 'CreateAccountAndLogin', {
        rootDataDir: '/tmp/data',
        displayName: 'Stauri User',
        password: 'supersecret',
        customizationColor: 'primary'
      });
    });
  });

  describe('loginAccount', () => {
    it('должен вызывать LoginAccount с keyUid и паролем', async () => {
      vi.mocked(http.statusFetch).mockResolvedValue({ 'key-uid': 'test-123' });

      await api.loginAccount(8080, 'supersecret', 'test-123');

      expect(http.statusFetch).toHaveBeenCalledWith(8080, 'LoginAccount', {
        password: 'supersecret',
        keyUid: 'test-123'
      });
    });
  });

  describe('getAccountsList', () => {
    it('должен делегировать вызов initializeApplication и возвращать массив accounts', async () => {
      const mockInitData = { accounts: [{ 'key-uid': 'acc-1' }, { 'key-uid': 'acc-2' }] };
      vi.mocked(http.statusFetch).mockResolvedValue(mockInitData);

      const accounts = await api.getAccountsList(8080, '/tmp/data', 1);

      expect(http.statusFetch).toHaveBeenCalledWith(8080, 'InitializeApplication', {
        dataDir: '/tmp/data',
        NetworkID: 1
      });
      expect(accounts).toHaveLength(2);
      expect(accounts[0]['key-uid']).toBe('acc-1');
    });

    it('должен возвращать пустой массив, если accounts undefined', async () => {
      vi.mocked(http.statusFetch).mockResolvedValue({}); // Нет поля accounts

      const accounts = await api.getAccountsList(8080, '/tmp/data', 1);
      expect(accounts).toEqual([]);
    });
  });

  describe('Обработка ошибок', () => {
    it('должен пробрасывать ошибку от statusFetch', async () => {
      const error = new Error('Network error');
      vi.mocked(http.statusFetch).mockRejectedValue(error);

      await expect(api.startMessenger(8080)).rejects.toThrow('Network error');
    });
  });
});
