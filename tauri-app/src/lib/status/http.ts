import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export async function statusFetch<T>(port: number, endpoint: string, body: any): Promise<T> {
  const url = `http://127.0.0.1:${port}/statusgo/${endpoint}`;

  const response = await tauriFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // Если HTTP-статус не 2xx, выбрасываем ошибку
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const text = await response.text();

  // Если ответ пустой — возвращаем пустой объект (для методов вроде LoginAccount)
  if (!text || text.trim() === '') {
    return {} as T;
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // Если это не JSON, значит бэкенд вернул что-то странное (например, HTML ошибки)
    throw new Error(`Invalid JSON response from ${endpoint}: ${text.substring(0, 100)}...`);
  }

  // Обработка ошибок в формате JSON-RPC (CallRPC)
  if (data.error) {
    throw new Error(data.error.message || data.error);
  }

  // Обработка ошибок в формате обычного API (mobile/status.go)
  if (data.error && typeof data.error === 'string') {
    throw new Error(data.error);
  }

  return data as T;
}
