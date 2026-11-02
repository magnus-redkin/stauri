/**
 * Проверка и установка обновлений.
 *
 * ## Почему проверка идёт в Rust, а не в JS
 *
 * JS-API `@tauri-apps/plugin-updater` (`check()`) делает всё в webview и
 * требует permission `updater:default`, то есть доступ из страницы. Здесь
 * используются только команды приложения: permission в capabilities не
 * выдаётся, а адрес сервера и порядок установки живут в Rust. Причина та же,
 * что у `auth_proxy` и `seed`: webview — самое уязвимое место, и чем меньше
 * прав у него есть, тем меньше последствия XSS.
 *
 * ## Почему обновление ставится отдельной кнопкой
 *
 * Подмена самого приложения — самый ценный сценарий атаки. Подпись закрывает
 * подмену файла, но не подмену «когда»: установка по нажатию пользователя
 * оставляет ему решение, а молчаливая автозамена ломает доверие к программе,
 * которая держит ключи.
 */

import { invoke } from '@tauri-apps/api/core';
import { debug } from '$lib/utils/log';

export interface UpdateInfo {
  /** Версия, которую предлагает сервер. */
  version: string;
  /** Текущая версия приложения. */
  currentVersion: string;
  /** Заметки к релизу (Markdown), если сервер их отдал. */
  notes: string | null;
  /** Дата публикации, ISO 8601. */
  date: string | null;
}

export interface UpdateCheckResult {
  /** `null` — обновлений нет. */
  update: UpdateInfo | null;
  /**
   * Почему проверка не дала ответа. Отдельно от `update: null`: «сервер
   * недоступен» и «обновлений нет» для пользователя разные вещи, и только
   * первое заслуживает упоминания в интерфейсе.
   */
  error: string | null;
}

/**
 * Спрашивает сервер, есть ли новая версия.
 *
 * Никогда не бросает: обновление — не критическая операция, и упавшая
 * проверка не должна влиять на запуск приложения.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await invoke<UpdateInfo | null>('check_for_update');
    debug('[updater] check result:', update?.version ?? 'none');
    return { update, error: null };
  } catch (e) {
    return { update: null, error: String(e) };
  }
}

/**
 * Скачивает и устанавливает обновление.
 *
 * На Linux заголовок исполняемого файла подменяется на месте, поэтому
 * запущенный процесс продолжает работать со старым кодом до перезапуска.
 * Возвращает `true`, если применено и нужен перезапуск.
 */
export async function installUpdate(): Promise<void> {
  await invoke('install_update');
}

/**
 * Перезапускает приложение.
 *
 * На Linux после установки подменяется файл на диске, а запущенный процесс
 * продолжает работать со старым кодом. Перезапуск идёт через Rust: он
 * проводит `RunEvent::Exit`, где останавливаются sidecar и оба прокси.
 * Из webview это не сделать — `location.reload()` перезагрузил бы только
 * страницу, а не процесс.
 *
 * Управление не возвращается: процесс завершается. Ошибку не ловим и не
 * показываем — если перезапуск не удался, окно просто останется открытым.
 */
export async function restartApp(): Promise<void> {
  await invoke('restart_app');
}
