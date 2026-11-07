//! Внешние dApp в отдельном окне.
//!
//! ## Чем dApp отличается от провайдера
//!
//! Провайдер отдаёт **данные** по фиксированной схеме, и мы рисуем их сами.
//! dApp приносит свой интерфейс и работает в своём окне (`docs/ru/providers_and_dapps.md` §12).
//!
//! ## Изоляция
//!
//! Окно создаётся с `WebviewUrl::External`, то есть его origin — не наш.
//! В Tauri IPC доступен только окнам, перечисленным в capabilities; у внешнего
//! окна записи нет, поэтому `invoke` из чужой страницы не работает. Это не
//! соглашение, а отсутствие разрешения: capabilities сопоставляются по метке
//! окна (`dapp-…`), и ни одна из них на неё не распространяется.
//!
//! Заголовок окна содержит хост — это и есть «видимая рамка с источником»
//! из §12: пользователь всегда видит, чей интерфейс перед ним.
//!
//! ## Что проверяется
//!
//! Адрес проходит тот же фильтр, что и ленты ([`validate_external_url`]):
//! только `http(s)`, никаких `localhost` и приватных диапазонов. Сама по себе
//! проверка здесь не про SSRF (запрос делает чужое окно, а не мы) — она не
//! даёт dApp-строке превратиться в способ открыть наш собственный интерфейс
//! или локальный сервис в чужой рамке.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};
use crate::providers::validate_external_url;

/// Размер окна dApp. Достаточно для десктопного интерфейса, но не
/// во весь экран: пользователь должен видеть, что это отдельное окно.
const DAPP_WIDTH: f64 = 1024.0;
const DAPP_HEIGHT: f64 = 800.0;
const DAPP_MIN_WIDTH: f64 = 480.0;
const DAPP_MIN_HEIGHT: f64 = 360.0;

/// Открывает внешний dApp в изолированном окне.
///
/// Возвращает метку окна. Повторный вызов с тем же адресом не создаёт второе
/// окно: оно фокусируется. Иначе клик по примеру дважды оставлял бы
/// невидимые копии поверх друг друга.
#[tauri::command]
pub async fn open_dapp(app: tauri::AppHandle, url: String) -> AppResult<String> {
    let parsed = validate_external_url(&url)?;
    let label = window_label(parsed.as_str());

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(label);
    }

    let host = parsed.host_str().unwrap_or("dApp").to_string();

    // Меню навигации. Без него из окна dApp нельзя вернуться назад — его
    // собственный интерфейс может не иметь такой кнопки, а истории у нас нет
    // ни на уровне Tauri, ни где-либо ещё.
    //
    // Только три пункта: «назад», «вперёд», «обновить». Ни «сохранить
    // страницу», ни devtools — чужому коду на диске пользователя делать нечего.
    let back = MenuItem::with_id(&app, "dapp-back", "← Back", true, Some("Alt+Left"))
        .map_err(|e| AppError::internal(format!("menu item: {e}")))?;
    let forward = MenuItem::with_id(&app, "dapp-forward", "→ Forward", true, Some("Alt+Right"))
        .map_err(|e| AppError::internal(format!("menu item: {e}")))?;
    let reload = MenuItem::with_id(&app, "dapp-reload", "⟳ Reload", true, Some("F5"))
        .map_err(|e| AppError::internal(format!("menu item: {e}")))?;
    let sep = PredefinedMenuItem::separator(&app)
        .map_err(|e| AppError::internal(format!("menu separator: {e}")))?;
    // Закрытие — пункт меню, а не крестик окна: в полноэкранном режиме крестика
    // не видно, а выйти нужно всегда.
    let close = MenuItem::with_id(&app, "dapp-close", "✕ Close", true, Some("Ctrl+W"))
        .map_err(|e| AppError::internal(format!("menu item: {e}")))?;
    let menu = Menu::with_items(&app, &[&back, &forward, &reload, &sep, &close])
        .map_err(|e| AppError::internal(format!("dApp menu: {e}")))?;

    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        // Хост в заголовке — не украшение: это единственное, что отличает
        // чужой интерфейс от нашего. Формат `dApp — example.com` читается
        // однозначно и не даёт подделать себя именем страницы.
        .title(format!("dApp — {host}"))
        .inner_size(DAPP_WIDTH, DAPP_HEIGHT)
        .min_inner_size(DAPP_MIN_WIDTH, DAPP_MIN_HEIGHT)
        .menu(menu)
        .resizable(true)
        .build()
        .map_err(|e| AppError::internal(format!("cannot open dApp window: {e}")))?;

    // Обработчик живёт на_window_, а не на приложении: так пункты меню
    // относятся только к этому окну и не влияют на главное.
    window.on_menu_event(move |win, event| match event.id().0.as_str() {
        "dapp-back" => navigate(win, "history.back()"),
        "dapp-forward" => navigate(win, "history.forward()"),
        "dapp-reload" => {
            if let Some(webview) = win.app_handle().get_webview_window(win.label()) {
                let _ = webview.reload();
            }
        }
        "dapp-close" => {
            let _ = win.close();
        }
        _ => {}
    });

    Ok(label)
}

/// Выполняет навигационный вызов в чужой странице.
///
/// `history.back()` — единственный способ вернуться: у Tauri нет нативного
/// `goBack`, а wry не выставляет историю наружу. Скрипт выполняется в
/// main-frame окна, то есть в самой странице; ничего из Stauri он не видит.
///
/// Ошибку намеренно проглатываем: если страница ещё грузится, `eval` может
/// не пройти, и падать из-за этого незачем — пользователь нажмёт ещё раз.
fn navigate(win: &tauri::Window, js: &str) {
    if let Some(webview) = win.app_handle().get_webview_window(win.label()) {
        let _ = webview.eval(js);
    }
}

/// Метка окна по адресу.
///
/// Tauri требует метку из `[a-zA-Z0-9-_]`, поэтому URL не годится напрямую.
/// FNV-1a даёт стабильную метку без зависимостей: один и тот же адрес всегда
/// открывается в одном и том же окне.
fn window_label(url: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in url.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("dapp-{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_is_stable_and_safe() {
        let a = window_label("https://remix.ethereum.org");
        assert_eq!(a, window_label("https://remix.ethereum.org"));
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "tauri rejects labels with other characters: {a}"
        );
    }

    #[test]
    fn different_urls_get_different_labels() {
        assert_ne!(
            window_label("https://remix.ethereum.org"),
            window_label("https://etherscan.io")
        );
    }
}
