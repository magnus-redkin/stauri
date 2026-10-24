import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statusFetch } from './http';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

// Мокаем модуль @tauri-apps/plugin-http
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

describe('statusFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('должен успешно отправлять запрос и возвращать распарсенные данные', async () => {
    const mockResponse = {
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ result: 'success', data: 123 })),
    };
    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    const result = await statusFetch(8080, 'TestEndpoint', { foo: 'bar' });

    expect(tauriFetch).toHaveBeenCalledWith('http://127.0.0.1:8080/statusgo/TestEndpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });
    expect(result).toEqual({ result: 'success', data: 123 });
  });

  it('должен возвращать пустой объект при пустом ответе', async () => {
    const mockResponse = {
      ok: true,
      text: vi.fn().mockResolvedValue(''),
    };
    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    const result = await statusFetch(8080, 'LoginAccount', { password: '123' });
    expect(result).toEqual({});
  });

  it('должен выбрасывать ошибку при HTTP-статусе не 2xx', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error details...'),
    };
    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    await expect(statusFetch(8080, 'Fail', {})).rejects.toThrow('HTTP 500: Internal Server Error details...');
  });

  it('должен выбрасывать ошибку при невалидном JSON', async () => {
    const mockResponse = {
      ok: true,
      text: vi.fn().mockResolvedValue('not a valid json string'),
    };
    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    await expect(statusFetch(8080, 'BadJson', {})).rejects.toThrow('Invalid JSON response from BadJson: not a valid json string...');
  });

  it('должен выбрасывать ошибку, если data.error является строкой', async () => {
    const mockResponse = {
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'incorrect password' })),
    };
    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    await expect(statusFetch(8080, 'Login', {})).rejects.toThrow('incorrect password');
  });

  it('должен выбрасывать ошибку, если data.error является объектом (JSON-RPC стиль)', async () => {
    const mockResponse = {
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        error: { code: -32000, message: 'method not found' }
      })),
    };
    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    await expect(statusFetch(8080, 'RPC', {})).rejects.toThrow('method not found');
  });
});
