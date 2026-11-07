//! Разбор ссылок-приглашений Status.
//!
//! ## Почему это в Rust, а не во фронтенде
//!
//! Ссылка на канал (`status.app/cc/…`) несёт не UUID, а **brotli-сжатый
//! protobuf** с описанием канала и сообщества:
//!
//! ```go
//! // pkg/services/sharedurls/service.go
//! func (api *PublicAPI) prepareEncodedCommunityChannelData(...) {
//!     channelData, _ := proto.Marshal(channelProto)
//!     urlData, _ := proto.Marshal(&protobuf.URLData{Content: channelData})
//!     return encodeDataURL(urlData)   // brotli + base64url
//! }
//! ```
//!
//! В webview brotli не декодируется: `DecompressionStream` в Chromium знает
//! gzip и deflate, brotli в нём нет. Поэтому разбор — здесь.
//!
//! Разбор ссылок есть и в самом `status-go` (`sharedurls.Service`), но не
//! выставлен как RPC: в `pkg/services/ext/api.go` такого метода нет. Форк
//! ради этого не нужен — формат простой и стабильный.
//!
//! ## Форматы ссылок
//!
//! ```text
//! status.app/c#<ключ>                 — сообщество, только ключ
//! status.app/c/<brotli>#<ключ>        — сообщество, с описанием
//! status.app/cc/<uuid>#<ключ>         — канал, по UUID
//! status.app/cc/<brotli>#<ключ>       — канал, с описанием (этот модуль)
//! ```
//!
//! Пейлоад всегда начинается с байта длины: `0x1b` в base64 превращается в
//! `G0…`, `0x1b` же — первый байт сжатого потока. Это не проверка формата, а
//! наблюдение: сжатый поток для описания сообщества и канала начинается с
//! `1b`, дальше идёт brotli.

use base64::Engine;
use serde::Serialize;

/// Что удалось достать из ссылки.
///
/// `channel_id` — `None`, если ссылка ведёт на сообщество целиком: канала в
/// ней нет, и открывать нечего.
#[derive(Debug, Serialize)]
pub struct InviteTarget {
    /// UUID канала (`c42488f6-68cc-455c-a206-a820ecd388d0`).
    pub channel_id: Option<String>,
    /// Имя канала из описания — для отображения до загрузки истории.
    pub channel_name: Option<String>,
    /// Имя сообщества из описания.
    pub community_name: Option<String>,
}

/// Разбирает `status.app/cc/…` и достаёт UUID канала.
///
/// Возвращает `None` только если ссылка вообще не содержит `/cc/` — то есть
/// канала в ней нет по определению. Нечитаемый пейлоад (битая база, чужой
/// формат) даёт `Some` с `channel_id: None`: сообщество по ключу после `#`
/// всё равно открывается, и падать из-за описания канала незачем.
#[tauri::command]
pub fn parse_invite_link(url: String) -> Option<InviteTarget> {
    let encoded = extract_cc_payload(&url)?;

    // Вариант с готовым UUID: `status.app/cc/<uuid>#<ключ>`.
    if let Some(uuid) = as_channel_uuid(&encoded) {
        tracing::debug!(target: "invite", "channel link carries a bare uuid");
        return Some(InviteTarget {
            channel_id: Some(uuid),
            channel_name: None,
            community_name: None,
        });
    }

    let empty = InviteTarget {
        channel_id: None,
        channel_name: None,
        community_name: None,
    };

    let Some(compressed) = decode_base64url(&encoded) else {
        tracing::debug!(target: "invite", "channel link payload is not base64url");
        return Some(empty);
    };
    let Some(decompressed) = decompress_brotli(&compressed) else {
        return Some(empty);
    };

    let parsed = parse_channel_proto(&decompressed);

    tracing::debug!(
        target: "invite",
        "decoded channel link: bytes={} uuid={:?}",
        decompressed.len(),
        parsed.channel_id
    );

    Some(parsed)
}

/// Достаёт часть между `/cc/` и `#` (или концом строки).
fn extract_cc_payload(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("/cc/")?;
    let end = rest.find(['#', '?', '&']).unwrap_or(rest.len());
    Some(rest[..end].trim().to_string())
}

/// Похоже ли значение на UUID канала (`channelUUIDRegExp` в status-go).
fn as_channel_uuid(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    let parts: Vec<&str> = lower.split('-').collect();
    let shapes = [8, 4, 4, 4, 12];
    if parts.len() != shapes.len() {
        return None;
    }
    for (part, want) in parts.iter().zip(shapes) {
        if part.len() != want || !part.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
    }
    // Позиции версии и варианта, как в регулярке status-go: 3-я группа
    // начинается с 0–5, 4-я — с 8/9/a/b.
    let version_ok = parts[2].starts_with(['0', '1', '2', '3', '4', '5']);
    let variant_ok = parts[3].starts_with(['8', '9', 'a', 'b']);
    if !version_ok || !variant_ok {
        return None;
    }
    Some(lower)
}

/// base64url без padding-safe: status-go использует `base64.URLEncoding`,
/// то есть с padding, но браузерные копии могут его терять.
fn decode_base64url(input: &str) -> Option<Vec<u8>> {
    let engine = base64::engine::general_purpose::URL_SAFE;
    engine.decode(input).ok().or_else(|| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(input)
            .ok()
    })
}

fn decompress_brotli(input: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    match brotli_decompressor::BrotliDecompress(&mut &input[..], &mut out) {
        Ok(_) => Some(out),
        Err(e) => {
            tracing::debug!(target: "invite", "brotli failed: {e}");
            None
        }
    }
}

/// Минимальный разбор protobuf: нужны только строковые поля.
///
/// Структура (`protocol/protobuf/url_data.proto`):
///
/// ```text
/// URLData { bytes content = 1; }
/// Channel { string display_name = 1; string description = 2; bytes emoji = 3;
///           string color = 4; Community community = 5; string uuid = 6; }
/// Community { string display_name = 1; ... }
/// ```
///
/// Полноценный protobuf-парсер здесь избыточен: нужны два вложенных поля, а
/// формат определены в spec и меняться не будет. Неизвестные поля
/// пропускаются по wire-type, поэтому лишние данные не ломают разбор.
fn parse_channel_proto(data: &[u8]) -> InviteTarget {
    let mut target = InviteTarget {
        channel_id: None,
        channel_name: None,
        community_name: None,
    };

    // Внешний уровень — URLData: поле 1 (content, bytes) содержит Channel.
    let Some(content) = find_length_delimited(data, 1) else {
        return target;
    };

    // Внутри Channel: 1 — display_name, 5 — community, 6 — uuid.
    target.channel_name =
        find_length_delimited(content, 1).and_then(|b| String::from_utf8(b.to_vec()).ok());
    target.channel_id = find_length_delimited(content, 6)
        .and_then(|b| String::from_utf8(b.to_vec()).ok())
        .and_then(|s| as_channel_uuid(&s));
    target.community_name = find_length_delimited(content, 5)
        .and_then(|community| find_length_delimited(community, 1))
        .and_then(|b| String::from_utf8(b.to_vec()).ok());

    target
}

/// Ищет первое поле с указанным номером и length-delimited wire-type (2).
///
/// Возвращает тело поля. Остальные поля пропускаются, чтобы порядок и
/// наличие необязательных полей не влияли на результат.
fn find_length_delimited(data: &[u8], field_number: u32) -> Option<&[u8]> {
    let mut pos = 0;
    while pos < data.len() {
        let (key, used) = read_varint(&data[pos..])?;
        pos += used;

        let field = (key >> 3) as u32;
        let wire = key & 0x7;

        match wire {
            // Varint: пропускаем значение.
            0 => {
                let (_, used) = read_varint(&data[pos..])?;
                pos += used;
            }
            // 64-bit.
            1 => pos += 8,
            // Length-delimited.
            2 => {
                let (len, used) = read_varint(&data[pos..])?;
                pos += used;
                let len = len as usize;
                if pos + len > data.len() {
                    return None;
                }
                let body = &data[pos..pos + len];
                if field == field_number {
                    return Some(body);
                }
                pos += len;
            }
            // 32-bit.
            5 => pos += 4,
            // Группы (3, 4) в новых схемах не используются.
            _ => return None,
        }
    }
    None
}

fn read_varint(data: &[u8]) -> Option<(u64, usize)> {
    let mut value = 0u64;
    let mut shift = 0;
    for (i, byte) in data.iter().take(10).enumerate() {
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((value, i + 1));
        }
        shift += 7;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Настоящая ссылка на канал из SIM (сообщество stauri-akk-test-1131).
    const CHANNEL_LINK: &str = "https://status.app/cc/G6MAAGRsbYhHPOGJ7cR__Ufp9yLSIjo5YP6-nX7QII88AC6PseEMUlyZ3X-6Wz9LVLJ_xqhNBov43gTuw87TtM3CZnyt35xJbP6-5u5YN7qtQqDjGDRu3QBCGNnfeEAePwMdZv7Dsh-MdZ3JnE0Z_diccsPwJJCGbQMuhA00xRJog2LXdphhOBg=#zQ3shuaXi1bQ6iVowkgm6eUtt5PPToUUpifePDvereeupioks";

    #[test]
    fn parses_real_sim_channel_link() {
        let target = parse_invite_link(CHANNEL_LINK.to_string()).expect("must parse");

        assert_eq!(
            target.channel_id.as_deref(),
            Some("c42488f6-68cc-455c-a206-a820ecd388d0")
        );
        assert_eq!(target.channel_name.as_deref(), Some("general"));
        assert_eq!(
            target.community_name.as_deref(),
            Some("stauri-akk-test-1131")
        );
    }

    #[test]
    fn parses_bare_uuid_channel_link() {
        let target = parse_invite_link(
            "https://status.app/cc/c42488f6-68cc-455c-a206-a820ecd388d0#zQ3shabc".to_string(),
        )
        .expect("must parse");

        assert_eq!(
            target.channel_id.as_deref(),
            Some("c42488f6-68cc-455c-a206-a820ecd388d0")
        );
    }

    #[test]
    fn rejects_community_link() {
        // /c/ — сообщество целиком, канала в ссылке нет.
        let target = parse_invite_link("https://status.app/c/G0UAAGTcHPB7#zQ3shabc".to_string());
        assert!(target.is_none());
    }

    #[test]
    fn survives_garbage_payload() {
        // Не ошибка подключения: сообщество всё равно откроется по ключу.
        let target =
            parse_invite_link("https://status.app/cc/!!!not-base64!!!#zQ3shabc".to_string());
        assert!(target.is_some());
        assert_eq!(target.unwrap().channel_id, None);
    }

    #[test]
    fn reads_varint_across_bytes() {
        // 300 = 0b1_0010_1100 → 0xAC 0x02
        assert_eq!(read_varint(&[0xac, 0x02]), Some((300, 2)));
        assert_eq!(read_varint(&[0x7f]), Some((127, 1)));
        assert_eq!(read_varint(&[]), None);
    }
}
