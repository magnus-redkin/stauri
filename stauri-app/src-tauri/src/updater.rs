//! Проверка и установка обновлений.
//!
//! ## Почему команды, а не JS-плагин
//!
//! `@tauri-apps/plugin-updater` умеет всё сам, но работает из webview и
//! требует permission `updater:default`. Мы намеренно сужаем права webview
//! (см. `capabilities/default.json` и `auth_proxy.rs`), поэтому здесь только
//! две тонкие команды: проверка отдаёт версию и заметки, установка идёт
//! целиком в Rust.
//!
//! ## Почему адрес сервера и ключ берутся из `tauri.conf.json`
//!
//! `plugins.updater.endpoints` и `plugins.updater.pubkey` — штатное место
//! для этого, их читает сам плагин. Пока ключ пуст, `check_for_update`
//! возвращает `None`, а не ошибку: сборка без ключа подписи должна
//! запускаться нормально, просто без обновлений.
//!
//! ## Подпись
//!
//! Каждый артефакт подписывается ключом, а публичная часть лежит в
//! `tauri.conf.json`. Плагин проверяет подпись до установки; подделать файл
//! без приватного ключа нельзя. Ключ подписи — единственный секрет релиза,
//! и он не должен попадать в репозиторий.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};

/// Обновление, найденное сервером.
#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    /// Заметки к релизу. `None`, если сервер их не прислал.
    pub notes: Option<String>,
    /// Дата публикации в ISO 8601.
    pub date: Option<String>,
}

/// Настроено ли автообновление.
///
/// Пока в `tauri.conf.json` пустой `pubkey`, обновление не только не
/// установить — его нельзя и предлагать: подпись проверяется только на
/// установке, поэтому `check()` вернул бы версию с сервера, интерфейс
/// показал бы «доступно обновление», а нажатие «Установить» упало бы на
/// декодировании пустого ключа. Пользователь увидел бы заведомо
/// нерабочую кнопку.
fn is_configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|cfg| cfg.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_some_and(|key| !key.trim().is_empty())
}

/// Спрашивает сервер об обновлении.
///
/// Возвращает `Ok(None)`, когда обновлений нет или обновления выключены
/// (пустой ключ подписи, пустой список адресов). Это не ошибка — так
/// выглядит нормальное состояние сборки без настроенного сервера.
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> AppResult<Option<UpdateInfo>> {
    if !is_configured(app) {
        tracing::debug!("updater is not configured (no pubkey); skipping check");
        return Ok(None);
    }

    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| AppError::config(format!("updater is not configured: {e}")))?;

    let update = updater
        .check()
        .await
        .map_err(|e| AppError::network(format!("update check failed: {e}")))?;

    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        current_version: u.current_version,
        notes: u.body,
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Скачивает, проверяет подпись и устанавливает обновление.
///
/// Подпись проверяется плагином до установки: неподписанный или подписанный
/// чужим ключом файл отвергается, и команда возвращает ошибку.
///
/// На Linux файл заменяется на месте, поэтому для запуска новой версии нужен
/// перезапуск — его делает пользователь.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| AppError::config(format!("updater is not configured: {e}")))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|e| AppError::network(format!("update check failed: {e}")))?
    else {
        // Между проверкой и установкой релиз могли снять. Это не сбой:
        // сообщаем, что устанавливать нечего.
        return Err(AppError::config("no update available"));
    };

    let version = update.version.clone();
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| AppError::network(format!("update install failed: {e}")))?;

    tracing::info!(version, "update installed, restart required");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_info_serializes_camel_case() {
        let info = UpdateInfo {
            version: "0.3.0".into(),
            current_version: "0.2.0".into(),
            notes: Some("fixes".into()),
            date: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(r#""currentVersion":"0.2.0""#));
        assert!(json.contains(r#""version":"0.3.0""#));
        assert!(json.contains(r#""notes":"fixes""#));
    }
}
