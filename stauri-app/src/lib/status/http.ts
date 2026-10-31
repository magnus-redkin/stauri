import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export async function statusFetch<T>(port: number, endpoint: string, body: any): Promise<T> {
  const url = `http://127.0.0.1:${port}/statusgo/${endpoint}`;

  // Лог: что отправляем (без секретов)
  const safeBody = { ...body };
  if (safeBody.password) safeBody.password = '***';
  console.log(`[statusFetch] → POST ${endpoint}`, 'keys:', Object.keys(body || {}), 'body:', JSON.stringify(safeBody).slice(0, 300));

  const response = await tauriFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // 1. Проверка HTTP-статуса
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[statusFetch] ← ${endpoint} HTTP ${response.status}`, errorText.substring(0, 300));
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const text = await response.text();
  console.log(`[statusFetch] ← ${endpoint} status=${response.status} len=${text.length}`, text.slice(0, 200));

  // 2. Пустой ответ (например, LoginAccount) — это нормально
  if (!text || text.trim() === '') {
    return {} as T;
  }

  // 3. Парсинг JSON
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON response from ${endpoint}: ${text.substring(0, 100)}...`, { cause: e });
  }

  // 4. Обработка ошибок (единый блок для JSON-RPC и обычного API)
  if (data && data.error) {
    let errorMessage: string;

    if (typeof data.error === 'string') {
      errorMessage = data.error;
    } else if (typeof data.error === 'object' && data.error.message) {
      errorMessage = data.error.message;
    } else {
      errorMessage = JSON.stringify(data.error);
    }

    console.error(`[statusFetch] ← ${endpoint} error:`, errorMessage);
    throw new Error(errorMessage);
  }

  return data as T;
}
