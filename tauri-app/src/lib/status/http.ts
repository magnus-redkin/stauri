import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export async function statusFetch<T>(port: number, endpoint: string, body: any): Promise<T> {
  const url = `http://127.0.0.1:${port}/statusgo/${endpoint}`;

  const response = await tauriFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // 1. Проверка HTTP-статуса
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const text = await response.text();

  // 2. Пустой ответ (например, LoginAccount) — это нормально
  if (!text || text.trim() === '') {
    return {} as T;
  }

  // 3. Парсинг JSON
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON response from ${endpoint}: ${text.substring(0, 100)}...`);
  }

  // 4. Обработка ошибок (единый блок для JSON-RPC и обычного API)
  if (data && data.error) {
    let errorMessage: string;

    if (typeof data.error === 'string') {
      // Обычная строка ошибки (например, { "error": "incorrect password" })
      errorMessage = data.error;
    } else if (typeof data.error === 'object' && data.error.message) {
      // JSON-RPC ошибка (например, { "error": { "code": -32601, "message": "..." } })
      errorMessage = data.error.message;
    } else {
      // Неизвестная структура — выводим как JSON, чтобы было видно детали
      errorMessage = JSON.stringify(data.error);
    }

    throw new Error(errorMessage);
  }

  return data as T;
}
