import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export async function statusFetch<T>(port: number, endpoint: string, body: any): Promise<T> {
  const url = `http://127.0.0.1:${port}/statusgo/${endpoint}`;

  const response = await tauriFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!text || text.trim() === '') {
    // Пустой ответ — считаем успехом (для LoginAccount это нормально)
    return {} as T;
  }

  try {
    const data = JSON.parse(text);
    if (data && data.error) {
      throw new Error(data.error);
    }
    return data as T;
  } catch (e) {
    // Если это не JSON, но и не ошибка — возвращаем как есть
    console.warn(`Non-JSON response from ${endpoint}:`, text);
    return {} as T;
  }
}
