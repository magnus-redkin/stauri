//! Открытие внешних ссылок системным обработчиком.
//!
//! ## Почему не через плагин `shell`
//!
//! `@tauri-apps/plugin-shell.open` на деле отказывает без разрешения в
//! `capabilities`, а разрешение на открытие произвольных адресов из webview —
//! лишняя дверь: любая XSS в нашем интерфейсе смогла бы запускать чужие
//! программы. Здесь адрес приходит в Rust, проверяется по схеме и только
//! потом передаётся системе.
//!
//! ## Почему отдельная команда, а не `<a target="_blank">`
//!
//! В WebKitGTK `target="_blank"` внутри Tauri-окна часто ничего не делает:
//! webview не является браузером и не обязан уметь открывать новые окна.
//! Поэтому клик по ссылке — это вызов команды, а не навигация.

use url::Url;

use crate::error::{AppError, AppResult};

/// Схемы, которые разрешено открывать.
///
/// `http`/`https` — обычные ссылки из лент. `mailto` — на случай писем в
/// статьях. Всё остальное (`file:`, `javascript:`, `data:`) отклоняется:
/// первые две — путь к локальным файлам и выполнению кода.
const ALLOWED_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// Открывает адрес обработчиком системы по умолчанию.
///
/// ## Telegram
///
/// Если это ссылка на сообщение Telegram (`t.me/<channel>/<id>`), сначала
/// пробуем схему `tg:` — её регистрирует клиент Telegram при установке, и
/// тогда сообщение открывается в приложении, а не в браузере. Если клиента
/// нет, `tg:` не найдёт обработчика и вернёт ошибку — тогда открываем
/// обычный `https`, то есть браузер.
///
/// Порядок именно такой, потому что `tg:` не имеет резервного обработчика:
/// без установленного клиента это гарантированный отказ, и узнать об этом
/// можно только попробовав.
#[tauri::command]
pub fn open_external(url: String) -> AppResult<()> {
    let parsed = parse(&url)?;

    if let Some(tg) = telegram_deep_link(&parsed)
        && open::that(&tg).is_ok()
    {
        return Ok(());
    }

    open::that(parsed.as_str())
        .map_err(|e| AppError::internal(format!("no handler for this address: {e}")))
}

/// Проверяет схему и разбирает адрес.
fn parse(raw: &str) -> AppResult<Url> {
    let url =
        Url::parse(raw.trim()).map_err(|e| AppError::config(format!("invalid address: {e}")))?;

    if !ALLOWED_SCHEMES.contains(&url.scheme()) {
        return Err(AppError::config(format!(
            "scheme {} is not allowed",
            url.scheme()
        )));
    }

    Ok(url)
}

/// Ссылка `tg://`, ведущая на то же сообщение Telegram, что и `t.me`-адрес.
///
/// `https://t.me/eveningprophet/4645` → `tg://resolve?domain=eveningprophet&post=4645`.
///
/// Возвращает `None`, если адрес не Telegram или не похож на ссылку на пост:
/// канал без номера (`https://t.me/eveningprophet`) — это лента, её в
/// приложении открывать нечего, и обычный браузер здесь уместнее.
fn telegram_deep_link(url: &Url) -> Option<String> {
    let host = url.host_str()?.to_ascii_lowercase();
    if host != "t.me" && host != "telegram.me" && host != "www.t.me" {
        return None;
    }

    let mut segments = url.path_segments()?.filter(|s| !s.is_empty());
    let channel = segments.next()?;
    let post = segments.next()?;

    // Номер поста — только цифры; `t.me/s/<name>` и прочие служебные пути
    // сюда не подходят, их поведение в приложении не определено.
    if !post.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // Имя канала — буквы, цифры и подчёркивание. Так отсекаются `t.me/s/…`.
    if !channel
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return None;
    }

    Some(format!("tg://resolve?domain={channel}&post={post}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_web_schemes() {
        assert!(parse("file:///etc/passwd").is_err());
        assert!(parse("javascript:alert(1)").is_err());
        assert!(parse("data:text/html,<script>").is_err());
    }

    #[test]
    fn accepts_http_https_and_mailto() {
        assert!(parse("https://example.com/article").is_ok());
        assert!(parse("http://example.com").is_ok());
        assert!(parse("mailto:author@example.com").is_ok());
    }

    #[test]
    fn builds_telegram_deep_link_for_post() {
        let url = parse("https://t.me/eveningprophet/4645").expect("valid");
        assert_eq!(
            telegram_deep_link(&url).as_deref(),
            Some("tg://resolve?domain=eveningprophet&post=4645")
        );
    }

    #[test]
    fn no_deep_link_for_channel_feed() {
        // Лента канала — не пост: в приложении открывать нечего.
        let url = parse("https://t.me/eveningprophet").expect("valid");
        assert_eq!(telegram_deep_link(&url), None);
    }

    #[test]
    fn no_deep_link_for_preview_path() {
        // `t.me/s/<name>` — служебный путь предпросмотра, не пост.
        let url = parse("https://t.me/s/eveningprophet").expect("valid");
        assert_eq!(telegram_deep_link(&url), None);
    }

    #[test]
    fn no_deep_link_for_other_hosts() {
        let url = parse("https://blog.rust-lang.org/2024/01/01/post.html").expect("valid");
        assert_eq!(telegram_deep_link(&url), None);
    }

    #[test]
    fn no_deep_link_for_lookalike_host() {
        // `t.me.evil.com` не Telegram: сравнение по точному имени хоста.
        let url = parse("https://t.me.evil.com/chan/1").expect("valid");
        assert_eq!(telegram_deep_link(&url), None);
    }

    #[test]
    fn no_deep_link_for_non_numeric_post() {
        let url = parse("https://t.me/channel/about").expect("valid");
        assert_eq!(telegram_deep_link(&url), None);
    }
}
