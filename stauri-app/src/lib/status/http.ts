import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { debug } from '$lib/utils/log';

/**
 * Клиент status-go RPC.
 *
 * Тела запросов и ответов НЕ логируются. Раньше здесь печатались первые
 * 200 символов ответа — а `settings_getSettings` возвращает seed-фразу
 * в поле `mnemonic`, то есть фраза уходила в консоль webview при каждом
 * открытии экрана с ней.
 *
 * Осталось логирование только имён методов и, при ошибке, кода статуса.
 *
 * `port` — порт АУТЕНТИФИЦИРУЮЩЕГО ПРОКСИ, а не бэкенда. Прокси требует
 * заголовок с токеном и только после проверки пересылает запрос дальше.
 */

/** Токен прокси. Кэш на время жизни страницы. */
let authToken: string | null = null;

async function token(): Promise<string> {
  if (authToken) return authToken;
  authToken = await invoke<string>('auth_proxy_token');
  return authToken;
}

export async function statusFetch<T>(port: number, endpoint: string, body: any): Promise<T> {
  const url = `http://127.0.0.1:${port}/statusgo/${endpoint}`;

  debug(`[statusFetch] → ${endpoint} keys=${Object.keys(body || {}).join(',')}`);

  const response = await tauriFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Stauri-Token': await token(),
    },
    body: JSON.stringify(body)
  });

  // 1. Проверка HTTP-статуса.
  //    Тело ответа не печатаем и не вкладываем в текст ошибки: оно может
  //    содержать данные профиля. Оставляем только статус и длину.
  if (!response.ok) {
    const errorText = await response.text();
    debug(`[statusFetch] ← ${endpoint} HTTP ${response.status} len=${errorText.length}`);
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  debug(`[statusFetch] ← ${endpoint} status=${response.status} len=${text.length}`);

  // 2. Пустой ответ (например, LoginAccount) — это нормально
  if (!text || text.trim() === '') {
    return {} as T;
  }

  // 3. Парсинг JSON
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON response from ${endpoint}`, { cause: e });
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

    debug(`[statusFetch] ← ${endpoint} error`);
    throw new Error(errorMessage);
  }

  return data as T;
}
