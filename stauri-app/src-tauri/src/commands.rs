//! Tauri-команды, доступные фронтенду.

use std::collections::HashMap;

use tauri::Manager;

use crate::auth_proxy;
use crate::error::AppResult;
use crate::rpc_proxy;
use crate::sidecar;
use crate::updater;

#[tauri::command]
pub async fn start_backend(
    app: tauri::AppHandle,
    network: Option<String>,
) -> AppResult<sidecar::StartBackendResponse> {
    sidecar::start(app, network).await
}

#[tauri::command]
pub fn stop_backend(app: tauri::AppHandle) -> AppResult<String> {
    sidecar::stop(app)
}

/// Отдаёт токен для заголовка `X-Stauri-Token`.
///
/// Фронтенд добавляет его к каждому запросу к аутентифицирующему прокси.
/// Без токена прокси отвечает 403, поэтому сторонний локальный процесс не
/// может вызвать методы status-backend напрямую.
///
/// Токен читаем из webview, поэтому при XSS он доступен атакующему — это
/// осознанный компромисс, см. шапку src/auth_proxy.rs.
#[tauri::command]
pub fn auth_proxy_token() -> AppResult<String> {
    auth_proxy::token()
}

/// Запускает форвардер и возвращает порт.
///
/// `upstreams` передаётся сразу при старте, а не отдельной командой: провайдер
/// с прошлого запуска уже лежит в БД status-go и указывает на наш порт, поэтому
/// первый же запрос приходит раньше, чем успела бы выполниться вторая команда.
/// Форвардер без таблицы отвечает 503 — именно это и наблюдалось на старте.
#[tauri::command]
pub async fn start_rpc_proxy(
    app: tauri::AppHandle,
    upstreams: HashMap<u64, String>,
) -> AppResult<u16> {
    let state = app.state::<rpc_proxy::RpcProxyState>();
    rpc_proxy::start(&state, upstreams).await
}

/// Задаёт, куда проксировать запросы для каждой сети.
/// `upstreams` — map chainId -> URL провайдера.
#[tauri::command]
pub fn set_rpc_upstreams(app: tauri::AppHandle, upstreams: HashMap<u64, String>) -> AppResult<()> {
    let state = app.state::<rpc_proxy::RpcProxyState>();
    rpc_proxy::set_upstreams(&state, upstreams);
    Ok(())
}

#[tauri::command]
pub fn stop_rpc_proxy(app: tauri::AppHandle) -> AppResult<()> {
    let state = app.state::<rpc_proxy::RpcProxyState>();
    rpc_proxy::stop(&state);
    Ok(())
}

/// Спрашивает сервер обновлений, есть ли новая версия.
///
/// `Ok(None)` — обновлений нет либо автообновление не настроено. Ошибка
/// означает, что сервер не ответил или ответил некорректно.
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> AppResult<Option<updater::UpdateInfo>> {
    updater::check(&app).await
}

/// Скачивает и устанавливает обновление. Нужен перезапуск приложения.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> AppResult<()> {
    updater::install(&app).await
}

/// Перезапускает приложение.
///
/// Используется после установки обновления: на Linux файл подменяется на
/// месте, и текущий процесс продолжает работать со старым кодом.
///
/// Именно `request_restart`, а не `restart`: первый гарантированно проводит
/// событие `RunEvent::Exit`, где мы останавливаем sidecar, оба прокси и
/// досбрасываем очередь лога. `restart` при вызове из главного потока
/// перезапускается в обход этих обработчиков — дочерний `status-backend`
/// остался бы висеть со старым образом, а хвост лога потерялся бы.
///
/// Вызывать до `request_restart` что-то ещё не нужно: обработчик выхода уже
/// делает всё необходимое.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    tracing::info!("restart requested by user");
    app.request_restart();
}
