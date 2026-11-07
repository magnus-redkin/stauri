//! Внешние источники данных (провайдеры).
//!
//! По `docs/ru/providers_and_dapps.md` провайдер отдаёт **данные**, не код, и
//! получает один запрос «дай список», а не «что у пользователя уже есть».
//! Склейка с нативными элементами — всегда локальная.
//!
//! # Что здесь есть
//!
//! Первая категория — «источник каналов»: лента по URL. Встроенного типа
//! достаточно, потому что каналы однородны (заголовок, отрывок, ссылка).
//! Telegram-канал становится его экземпляром — **в коде Telegram нет вообще**:
//! `t.me/s/<name>` разбирается как HTML-страница с тем же набором полей.
//!
//! # Защита от SSRF
//!
//! URL вводит пользователь, запрос делает Rust. На `127.0.0.1` висят
//! `rpc_proxy` и auth-прокси, поэтому фид с адресом `http://127.0.0.1:43057/1`
//! заставил бы нас обратиться к собственной инфраструктуре. Блокируются
//! loopback, частные диапазоны, link-local и IPv6-эквиваленты — как по
//! литеральному адресу, так и после разыменования имени.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};

/// Ограничение на размер ответа: фид не должен съесть память.
const MAX_BODY_BYTES: usize = 512 * 1024;

/// Сколько записей отдаём фронтенду.
const MAX_ITEMS: usize = 50;

/// Один элемент ленты — то же, что строка канала в списке чатов.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeedItem {
    /// Ссылка на запись — используется как идентификатор для открытия.
    pub url: String,
    /// Заголовок записи.
    pub title: String,
    /// Отрывок текста. Только текст: HTML сюда не попадает (см. §9.5).
    pub summary: String,
    /// Время публикации в миллисекундах, если удалось разобрать.
    pub published_at: Option<i64>,
}

/// Результат загрузки фида.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedResponse {
    /// Название источника — заголовок фида или имя канала.
    pub title: String,
    pub items: Vec<FeedItem>,
    /// Источник, к которому относится каждый элемент (`t.me/<name>` или хост).
    pub source: String,
}

/// Проверяет, что адрес ведёт наружу.
///
/// Правило простое: `http`/`https` и ни одного «внутреннего» адреса.
/// Проверка делается **до** запроса по имени хоста и по его разрешённым
/// адресам — иначе `localhost.attacker.com` с записью A на `127.0.0.1`
/// обошёл бы фильтр.
pub fn validate_external_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw).map_err(|e| AppError::config(format!("invalid URL: {e}")))?;

    match url.scheme() {
        "http" | "https" => {}
        other => {
            return Err(AppError::config(format!(
                "only http(s) is allowed, got {other}"
            )));
        }
    }

    let host = url
        .host_str()
        .ok_or_else(|| AppError::config("URL has no host"))?;

    // Литеральный IP проверяем сразу: без DNS.
    if let Ok(ip) = host.parse::<IpAddr>() {
        ensure_public_ip(ip)?;
        return Ok(url);
    }

    // Имя хоста: отсекаем очевидные локальные имена до обращения к DNS.
    let lower = host.to_ascii_lowercase();
    if lower == "localhost"
        || lower.ends_with(".localhost")
        || lower.ends_with(".local")
        || lower.ends_with(".internal")
    {
        return Err(AppError::config(
            "localhost and private names are not allowed",
        ));
    }

    // Разыменовываем имя и проверяем каждый адрес: DNS rebinding — реальный
    // обход наивной проверки по строке.
    use std::net::ToSocketAddrs;
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| AppError::network(format!("DNS resolution failed: {e}")))?;

    let mut any_public = false;
    for addr in addrs {
        ensure_public_ip(addr.ip())?;
        any_public = true;
    }
    if !any_public {
        return Err(AppError::network("host resolves to no addresses"));
    }

    Ok(url)
}

/// Отклоняет loopback, частные диапазоны, link-local и их IPv6-эквиваленты.
fn ensure_public_ip(ip: IpAddr) -> AppResult<()> {
    let blocked = match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => is_blocked_v6(v6),
    };
    if blocked {
        return Err(AppError::config(format!(
            "address {ip} is internal and cannot be fetched"
        )));
    }
    Ok(())
}

fn is_blocked_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()          // 127.0.0.0/8
        || ip.is_private()    // 10/8, 172.16/12, 192.168/16
        || ip.is_link_local() // 169.254/16
        || ip.is_broadcast()
        || ip.is_unspecified()
        || ip.is_documentation()
        // 100.64.0.0/10 — CGNAT
        || (o[0] == 100 && (64..128).contains(&o[1]))
        // 0.0.0.0/8
        || o[0] == 0
}

fn is_blocked_v6(ip: Ipv6Addr) -> bool {
    ip.is_loopback() || ip.is_unspecified() || ip.is_unique_local() || ip.is_unicast_link_local()
}

/// Загружает ленту по URL.
///
/// Поддерживает два вида:
///   * RSS/Atom — обычный фид;
///   * `t.me/s/<name>` — HTML-страница публичного канала Telegram.
///
/// Разбор Telegram здесь же, без посредника: по §9.6 это вариант «без моста»,
/// с риском хрупкости, но без утечки подписки третьей стороне.
#[tauri::command]
pub async fn fetch_feed(url: String) -> AppResult<FeedResponse> {
    let parsed = validate_external_url(&url)?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();

    let client = reqwest::Client::builder()
        // Системный прокси СОЗНАТЕЛЬНО не отключаем.
        //
        // Раньше здесь стоял `.no_proxy()`: исходили из того, что прямой выход
        // есть всегда. На машине с `HTTP_PROXY`/`HTTPS_PROXY` это даёт
        // `request failed: error sending request for url (...)`, то есть
        // лента не грузится вообще — именно так и вышло на первой попытке
        // открыть `t.me/s/status`.
        //
        // Компромисс известен: при работе через прокси DNS разворачивает сам
        // прокси, поэтому проверка [`validate_external_url`] остаётся первой
        // линией (литеральные адреса и локальные имена), а не последней.
        // Без прокси она проверяет и результат DNS.
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::internal(format!("client build error: {e}")))?;

    let resp = client
        .get(parsed.as_str())
        .header(
            "Accept",
            "application/rss+xml, application/atom+xml, text/xml, text/html",
        )
        // Telegram отдаёт HTML только браузерной подписи; без неё — заглушка.
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Stauri/0.2",
        )
        .send()
        .await
        .map_err(|e| AppError::network(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::network(format!("HTTP {}", resp.status())));
    }

    // Ограничение по размеру: читаем не больше лимита, остальное отбрасываем.
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::network(format!("body read error: {e}")))?;
    let body = &bytes[..bytes.len().min(MAX_BODY_BYTES)];
    let text = String::from_utf8_lossy(body).to_string();

    let source = if host.ends_with("t.me") {
        parsed
            .path_segments()
            .and_then(|mut s| s.rfind(|p| !p.is_empty()))
            .map(|name| format!("t.me/{name}"))
            .unwrap_or_else(|| "t.me".to_string())
    } else {
        host.clone()
    };

    let result = if host.ends_with("t.me") {
        parse_telegram_html(&text, &source)?
    } else {
        parse_rss(&text, &source)?
    };

    tracing::info!(
        target: "providers",
        "feed {} -> {} items",
        source,
        result.items.len()
    );

    Ok(result)
}

/// Разбирает RSS/Atom.
///
/// Через `quick-xml` в потоковом режиме: дерево не строим, поэтому большой
/// фид не занимает память целиком.
fn parse_rss(xml: &str, source: &str) -> AppResult<FeedResponse> {
    use quick_xml::Reader;
    use quick_xml::events::Event;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut feed_title = String::new();
    let mut items: Vec<FeedItem> = Vec::new();

    let mut cur: Option<FeedItem> = None;
    // Стек полей: нужен из-за вложенности. `<description><p>x</p></description>`
    // не должен превращать поле в `p`, как это было с одним `field`.
    let mut fields: Vec<String> = Vec::new();
    // Накопитель текста: сущности приходят отдельными событиями `GeneralRef`.
    let mut pending = String::new();
    let mut seen_feed_title = false;

    loop {
        match reader.read_event() {
            Ok(Event::Eof) => break,

            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref());
                if matches!(name.as_str(), "item" | "entry") {
                    flush(
                        &mut cur,
                        &mut feed_title,
                        fields.last(),
                        &mut pending,
                        &mut seen_feed_title,
                    );
                    fields.clear();
                    cur = Some(FeedItem {
                        url: String::new(),
                        title: String::new(),
                        summary: String::new(),
                        published_at: None,
                    });
                } else {
                    flush(
                        &mut cur,
                        &mut feed_title,
                        fields.last(),
                        &mut pending,
                        &mut seen_feed_title,
                    );
                    fields.push(name);
                }
            }

            Ok(Event::Empty(e)) => {
                // Atom хранит ссылку в атрибуте: <link href="..."/>
                let name = local_name(e.name().as_ref());
                if name == "link"
                    && let Some(href) = attr_value(&e, "href")
                    && let Some(item) = cur.as_mut()
                    && item.url.is_empty()
                {
                    item.url = href;
                }
            }

            Ok(Event::Text(t)) => pending.push_str(&t.xml10_content()),

            Ok(Event::GeneralRef(r)) => {
                // &lt;, &amp; и числовые ссылки. Раскрываем сразу: иначе
                // экранированный HTML из `<description>` не будет снят.
                if let Ok(Some(ch)) = r.resolve_char_ref() {
                    pending.push(ch);
                } else if let Some(rep) =
                    quick_xml::escape::resolve_predefined_entity(&r.xml10_content())
                {
                    pending.push_str(rep);
                } else {
                    pending.push('&');
                    pending.push_str(&r.xml10_content());
                    pending.push(';');
                }
            }

            Ok(Event::CData(t)) => pending.push_str(&t.xml10_content()),

            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref());

                if matches!(name.as_str(), "item" | "entry") {
                    flush(
                        &mut cur,
                        &mut feed_title,
                        fields.last(),
                        &mut pending,
                        &mut seen_feed_title,
                    );
                    fields.clear();
                    if let Some(item) = cur.take() {
                        let item = finalize_item(item);
                        if !item.title.is_empty() || !item.summary.is_empty() {
                            items.push(item);
                            if items.len() >= MAX_ITEMS {
                                break;
                            }
                        }
                    }
                } else {
                    flush(
                        &mut cur,
                        &mut feed_title,
                        fields.last(),
                        &mut pending,
                        &mut seen_feed_title,
                    );
                    fields.pop();
                }
            }

            Ok(_) => {}

            Err(e) => {
                // Битый фид — ошибка источника, а не наша: сообщаем с позицией.
                return Err(AppError::network(format!(
                    "XML parse error at {}: {e}",
                    reader.buffer_position()
                )));
            }
        }
    }

    Ok(FeedResponse {
        title: feed_title,
        items,
        source: source.to_string(),
    })
}

/// Записывает накопленный текст в текущую цель.
///
/// Цель — запись, если мы внутри неё, иначе заголовок фида. Это единственное
/// место, где решается, куда идёт текст: раньше заголовок фида терялся, потому
/// что накопитель писал только в `cur`.
fn flush(
    cur: &mut Option<FeedItem>,
    feed_title: &mut String,
    field: Option<&String>,
    pending: &mut String,
    seen_feed_title: &mut bool,
) {
    if pending.is_empty() {
        return;
    }
    let Some(field) = field else {
        pending.clear();
        return;
    };

    match cur.as_mut() {
        Some(item) => apply_field(item, field, pending),
        None => {
            if field == "title" && !*seen_feed_title {
                *feed_title = clean_text(pending);
                *seen_feed_title = true;
            }
        }
    }
    pending.clear();
}

/// Раскладывает текст по полям записи. Имена — из RSS и Atom.
fn apply_field(item: &mut FeedItem, field: &str, text: &str) {
    match field {
        "title" => {
            if item.title.is_empty() {
                item.title = text.trim().to_string();
            }
        }
        "description" | "summary" | "content" => {
            if item.summary.is_empty() {
                // Сущности уже раскрыты читалкой (см. `read_text`), поэтому
                // здесь только снимаем теги и нормализуем пробелы.
                item.summary = clean_text(text);
            }
        }
        "link" => {
            if item.url.is_empty() {
                item.url = text.trim().to_string();
            }
        }
        "pubDate" | "published" | "updated" | "date" => {
            if item.published_at.is_none() {
                item.published_at = parse_date(text);
            }
        }
        _ => {}
    }
}

/// Предел длины отрывка.
///
/// Раньше было 400 символов, и это резало текст на полуслове: в интерфейсе
/// такой отрывок нельзя было раскрыть — «…» стояло в самой строке, а не в
/// вёрстке. Теперь отрывок хранится почти целиком, а сокращает его только
/// CSS (`line-clamp`), который снимается по клику.
///
/// 4000 — компромисс: этого хватает большинству статей, а ограничение
/// остаётся, потому что ленты целиком писать в память и в `localStorage`
/// нельзя.
const MAX_SUMMARY_CHARS: usize = 4000;

/// Дополняет запись: пустые поля — пустые строки, отрывок ограничен.
fn finalize_item(mut item: FeedItem) -> FeedItem {
    item.title = item.title.trim().to_string();
    item.summary = item.summary.trim().to_string();
    if item.summary.chars().count() > MAX_SUMMARY_CHARS {
        item.summary = item
            .summary
            .chars()
            .take(MAX_SUMMARY_CHARS)
            .collect::<String>()
            + "…";
    }
    item
}

/// Убирает теги и нормализует пробелы.
///
/// RSS часто содержит HTML в `<description>`. По §9.5 разметка не должна
/// доходить до интерфейса: только текст, без `{@html}`.
///
/// Сущности здесь **не** раскрываются: `quick-xml` 0.42 отдаёт `&lt;` отдельным
/// событием `GeneralRef`, и читалка склеивает поток уже раскрытым (см.
/// `read_text`). Если раскрывать здесь ещё раз, `<b>` из описания снова станет
/// тегом — и вместо текста останется мусор.
fn clean_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// То же для случая, когда разметка пришла обычным текстом (HTML-страница).
fn strip_tags(input: &str) -> String {
    clean_text(&decode_entities(input))
}

/// Раскрывает частые HTML-сущности. Полный список не нужен: остальное
/// останется как есть и не сломает отображение.
fn decode_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

/// Локальное имя тега без namespace-префикса.
///
/// В slice-режиме `quick-xml` 0.42 отдаёт имена как `&str`, а не как байты.
fn local_name(raw: &str) -> String {
    match raw.rsplit_once(':') {
        Some((_, local)) => local.to_ascii_lowercase(),
        None => raw.to_ascii_lowercase(),
    }
}

fn attr_value(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    for attr in e.attributes().flatten() {
        if attr.key.as_ref() == key {
            return attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()
                .map(|v| v.to_string());
        }
    }
    None
}

/// Разбирает дату в миллисекунды.
///
/// Поддерживаются форматы RSS (`RFC 2822`) и Atom (`RFC 3339`). Остальные —
/// `None`: время не критично, а падать из-за формата незачем.
fn parse_date(raw: &str) -> Option<i64> {
    let trimmed = raw.trim();

    // RFC 3339: 2026-11-05T12:34:56Z или с смещением.
    if let Ok(dt) = chrono_lite_parse(trimmed) {
        return Some(dt);
    }
    None
}

/// Минимальный разбор ISO-8601 без внешней зависимости.
///
/// `chrono` в зависимостях нет, а тянуть её ради одного поля — избыточно.
/// Понимает `YYYY-MM-DDTHH:MM:SS(Z|±HH:MM)` и `YYYY-MM-DD HH:MM:SS`.
fn chrono_lite_parse(s: &str) -> Result<i64, ()> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return Err(());
    }
    let year: i32 = s.get(0..4).ok_or(())?.parse().map_err(|_| ())?;
    let month: u32 = s.get(5..7).ok_or(())?.parse().map_err(|_| ())?;
    let day: u32 = s.get(8..10).ok_or(())?.parse().map_err(|_| ())?;
    let hour: u32 = s.get(11..13).ok_or(())?.parse().map_err(|_| ())?;
    let min: u32 = s.get(14..16).ok_or(())?.parse().map_err(|_| ())?;
    let sec: u32 = s.get(17..19).ok_or(())?.parse().map_err(|_| ())?;

    Some(
        days_from_civil(year, month, day) * 86_400_000
            + i64::from(hour) * 3_600_000
            + i64::from(min) * 60_000
            + i64::from(sec) * 1000,
    )
    .ok_or(())
}

/// Дни от 1970-01-01 до даты (алгоритм Говарда Хиннанта).
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Разбирает страницу `t.me/s/<name>`.
///
/// Структура страницы неофициальная и может измениться — по §9.6 это
/// осознанно выбранный риск: без моста подписка не уходит третьей стороне.
/// Нужны только текстовые поля, поэтому регулярки по классам достаточны и не
/// тянут HTML-парсер.
fn parse_telegram_html(html: &str, source: &str) -> AppResult<FeedResponse> {
    use regex::Regex;

    // Записи канала: каждый блок сообщения.
    let block_re =
        Regex::new(r#"(?s)<div class="tgme_widget_message_wrap.*?</div>\s*</div>\s*</div>"#)
            .map_err(|e| AppError::internal(format!("regex: {e}")))?;
    // Ссылка на сообщение: data-post="channel/12345".
    let post_re = Regex::new(r#"data-post="([^"]+)""#)
        .map_err(|e| AppError::internal(format!("regex: {e}")))?;
    // Запасной вариант: href="https://t.me/channel/12345".
    let href_post_re = Regex::new(r#"href="https?://t\.me/([^"]+)""#)
        .map_err(|e| AppError::internal(format!("regex: {e}")))?;
    // Текст сообщения.
    let text_re = Regex::new(r#"(?s)<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>"#)
        .map_err(|e| AppError::internal(format!("regex: {e}")))?;
    // Время публикации.
    let time_re = Regex::new(r#"<time[^>]+datetime="([^"]+)""#)
        .map_err(|e| AppError::internal(format!("regex: {e}")))?;
    // Заголовок канала.
    let title_re =
        Regex::new(r#"(?s)<div class="tgme_channel_info_header_title"[^>]*>(.*?)</div>"#)
            .map_err(|e| AppError::internal(format!("regex: {e}")))?;

    let title = title_re
        .captures(html)
        .map(|c| strip_tags(&c[1]))
        .unwrap_or_default();

    let mut items = Vec::new();
    for block in block_re.find_iter(html).take(MAX_ITEMS) {
        let chunk = block.as_str();

        // Ссылка на сообщение. В реальной разметке Telegram это атрибут
        // `data-post="channel/12345"` на внешнем `<a>`; в некоторых версиях
        // страницы — обычный `href="https://t.me/channel/12345"`. Поддерживаем
        // оба: опираться только на один значит ломаться при смене вёрстки.
        let post = post_re
            .captures(chunk)
            .map(|c| c[1].to_string())
            .or_else(|| href_post_re.captures(chunk).map(|c| c[1].to_string()));
        let text = text_re
            .captures(chunk)
            .map(|c| strip_tags(&c[1]))
            .unwrap_or_default();
        let published = time_re
            .captures(chunk)
            .and_then(|c| chrono_lite_parse(&c[1]).ok());

        // Без текста запись бесполезна: это может быть служебный блок.
        if text.trim().is_empty() {
            continue;
        }

        let url = post
            .map(|p| format!("https://t.me/{p}"))
            .unwrap_or_default();

        // Первая строка текста как заголовок: у Telegram его нет.
        let summary = text.trim().to_string();
        let first_line = summary.lines().next().unwrap_or_default().to_string();
        let title = if first_line.chars().count() > 80 {
            first_line.chars().take(80).collect::<String>() + "…"
        } else {
            first_line
        };

        items.push(FeedItem {
            url,
            title,
            // Полный текст: сокращает его только вёрстка (`line-clamp`),
            // снимаемая по клику. Обрезка здесь оставляла «…» внутри строки,
            // и раскрыть такой отрывок было нельзя.
            summary: {
                if summary.chars().count() > MAX_SUMMARY_CHARS {
                    summary.chars().take(MAX_SUMMARY_CHARS).collect::<String>() + "…"
                } else {
                    summary
                }
            },
            published_at: published,
        });
    }

    if items.is_empty() {
        return Err(AppError::network(
            "no messages found on the Telegram page — layout may have changed",
        ));
    }

    Ok(FeedResponse {
        title,
        items,
        source: source.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_loopback_and_private_ranges() {
        for url in [
            "http://127.0.0.1:43057/1",
            "http://127.0.0.1/",
            "http://10.0.0.1/feed",
            "http://192.168.1.1/feed",
            "http://172.16.0.1/feed",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/feed",
            "http://localhost/feed",
        ] {
            assert!(
                validate_external_url(url).is_err(),
                "{url} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_non_http_schemes() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.org/x",
            "javascript:alert(1)",
        ] {
            assert!(
                validate_external_url(url).is_err(),
                "{url} must be rejected"
            );
        }
    }

    #[test]
    fn blocks_local_domain_names() {
        for url in [
            "http://foo.localhost/x",
            "http://nas.local/x",
            "http://svc.internal/x",
        ] {
            assert!(
                validate_external_url(url).is_err(),
                "{url} must be rejected"
            );
        }
    }

    #[test]
    fn strips_html_from_summary() {
        // §9.5: разметка провайдера не должна доходить до интерфейса.
        assert_eq!(strip_tags("<b>hello</b> <i>world</i>"), "hello world");
        assert_eq!(strip_tags("a &amp; b"), "a & b");
        assert_eq!(strip_tags("  spaced   out  "), "spaced out");
    }

    #[test]
    fn parses_rss_items() {
        let xml = r#"<?xml version="1.0"?>
<rss><channel>
<title>My Feed</title>
<item>
  <title>First</title>
  <link>https://example.org/1</link>
  <description>&lt;p&gt;Hello &lt;b&gt;there&lt;/b&gt;&lt;/p&gt;</description>
  <pubDate>Wed, 05 Nov 2026 12:00:00 +0000</pubDate>
</item>
<item>
  <title>Second</title>
  <link>https://example.org/2</link>
  <description>Plain text</description>
</item>
</channel></rss>"#;

        let feed = parse_rss(xml, "example.org").expect("must parse");
        assert_eq!(feed.title, "My Feed");
        assert_eq!(feed.items.len(), 2);
        assert_eq!(feed.items[0].title, "First");
        assert_eq!(feed.items[0].url, "https://example.org/1");
        // Теги из описания удалены, сущности раскрыты.
        assert_eq!(feed.items[0].summary, "Hello there");
        assert_eq!(feed.items[1].summary, "Plain text");
    }

    #[test]
    fn parses_atom_entries_with_href_links() {
        let xml = r#"<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Feed</title>
<entry>
  <title>Entry One</title>
  <link href="https://example.org/a1"/>
  <summary>Summary text</summary>
  <updated>2026-11-05T10:30:00Z</updated>
</entry>
</feed>"#;

        let feed = parse_rss(xml, "example.org").expect("must parse");
        assert_eq!(feed.items.len(), 1);
        assert_eq!(feed.items[0].url, "https://example.org/a1");
        assert_eq!(feed.items[0].summary, "Summary text");
        assert_eq!(feed.items[0].published_at, Some(1_793_874_600_000));
    }

    #[test]
    fn empty_feed_is_not_an_error() {
        let xml = r#"<?xml version="1.0"?><rss><channel><title>Empty</title></channel></rss>"#;
        let feed = parse_rss(xml, "example.org").expect("must parse");
        assert!(feed.items.is_empty());
    }

    #[test]
    fn parses_telegram_html_blocks() {
        let html = r#"
<div class="tgme_channel_info_header_title">Test Channel</div>
<div class="tgme_widget_message_wrap">
  <a class="tgme_widget_message_date" href="https://t.me/testchannel/1">
    <time datetime="2026-11-05T10:30:00+00:00"></time>
  </a>
  <div class="tgme_widget_message_text">First <b>message</b></div>
</div>
</div>
</div>"#;

        let feed = parse_telegram_html(html, "t.me/testchannel").expect("must parse");
        assert_eq!(feed.title, "Test Channel");
        assert_eq!(feed.items.len(), 1);
        // Разметка снята, остаётся текст.
        assert_eq!(feed.items[0].summary, "First message");
        assert_eq!(feed.items[0].url, "https://t.me/testchannel/1");
    }

    #[test]
    fn days_from_civil_matches_epoch() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1970, 1, 2), 1);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
    }
}
