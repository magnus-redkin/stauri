//! Структурное логирование приложения.
//!
//! ## Зачем
//!
//! До этого момента все сообщения шли через `println!`/`eprintln!`: в
//! AppImage-сборке они уходили в никуда, а `status.log` от самого status-go
//! был выключен, потому что тот писал полные URL RPC-провайдеров вместе с
//! API-ключами. В итоге при разборе проблем пользователя не оставалось
//! вообще ничего, кроме экрана с ошибкой.
//!
//! Здесь два независимых приёмника:
//!
//! * **файл** — `<data>/<APP_IDENTIFIER>/logs/stauri.<дата>.log`, суточная
//!   ротация, хранится 7 файлов. В релизе это основной источник диагностики.
//! * **stderr** — то, что видно при запуске из терминала. В debug-сборке
//!   идёт от `debug`, в release — только `warn` и выше, чтобы запуск из
//!   десктопного окружения не засорял журнал сессии.
//!
//! ## Почему секреты вычищаются на уровне писателя
//!
//! Чистить на каждом вызове `info!` — значит однажды забыть. Ключи утекают
//! не только из наших сообщений, но и из чужих ошибок: `reqwest` пишет
//! `error sending request for url (https://eth-mainnet.g.alchemy.com/v2/KEY)`,
//! а status-backend печатает в stdout JSON с `authToken` и провайдерами.
//! Поэтому каждый приёмник обёрнут в [`RedactingWriter`], который правит
//! строку целиком уже на выходе. Один раз обёрнуто — дальше забыть нельзя.

use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::Layer;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::env::APP_IDENTIFIER;

/// Сколько файлов лога хранить при суточной ротации.
const KEEP_LOG_FILES: usize = 7;

/// Предел накопления строки без перевода строки, после которого пишем как есть.
///
/// Страховка от мусора: если в лог попадёт поток без `\n`, буфер не должен
/// расти бесконечно.
const MAX_PENDING_LINE: usize = 1024 * 1024;

/// Держит фоновый поток записи, пока приложение живо.
///
/// `WorkerGuard` останавливает и досбрасывает очередь при своём `Drop`.
/// Держим его до `RunEvent::Exit`, иначе буферизованный хвост лога теряется
/// на выходе — а именно там чаще всего и лежит причина падения.
static GUARD: OnceLock<Mutex<Option<WorkerGuard>>> = OnceLock::new();

/// Инициализирует глобальный подписчик. Повторный вызов безопасен.
///
/// Директория логов вычисляется без `AppHandle`: `app_data_dir()` доступен
/// только после `.build()`, а логировать хочется уже с первых строк. На Linux
/// `app_data_dir()` — это `$XDG_DATA_HOME/<identifier>`, что совпадает с
/// `dirs::data_local_dir()`, поэтому путь тот же.
pub fn init() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // Чужой шум (tauri, reqwest, hyper) — только warn: их debug
        // утопил бы записи самого приложения.
        //
        // `frontend=` обязателен отдельно: сообщения из webview приходят с
        // target "frontend" (см. commands::log_frontend) и под правило
        // `tauri_app_lib=` не подпадают. Без него проходили только ERROR,
        // потому что они выше порога `warn`, — именно так debug/info с
        // фронтенда и потерялись при первой попытке.
        EnvFilter::new(if cfg!(debug_assertions) {
            "warn,tauri_app_lib=debug,frontend=debug,status_backend=debug"
        } else {
            "warn,tauri_app_lib=info,frontend=debug,status_backend=info"
        })
    });

    let console_level = if cfg!(debug_assertions) {
        tracing::level_filters::LevelFilter::DEBUG
    } else {
        tracing::level_filters::LevelFilter::WARN
    };

    let console = tracing_subscriber::fmt::layer()
        .with_writer(Redacting::new(io::stderr))
        .with_ansi(io::stderr().is_terminal())
        .with_target(false)
        .with_filter(console_level);

    match file_writer() {
        Some(writer) => {
            let file = tracing_subscriber::fmt::layer()
                .with_writer(Redacting::new(writer))
                .with_ansi(false)
                .with_target(true);
            let _ = tracing_subscriber::registry()
                .with(console)
                .with(file)
                .with(filter)
                .try_init();
        }
        None => {
            // Файл недоступен (нет прав, только для чтения) — не падаем:
            // приложение должно работать, stderr остаётся.
            let _ = tracing_subscriber::registry()
                .with(console)
                .with(filter)
                .try_init();
        }
    }
}

/// Досбрасывает очередь на диск. Вызывать при выходе из приложения.
pub fn shutdown() {
    if let Some(guard) = GUARD.get()
        && let Ok(mut slot) = guard.lock()
    {
        // `take` уничтожает guard, его `Drop` вычитывает очередь.
        slot.take();
    }
}

/// Каталог логов: `<data_local_dir>/<APP_IDENTIFIER>/logs`.
pub fn log_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join(APP_IDENTIFIER).join("logs"))
}

fn file_writer() -> Option<NonBlocking> {
    let dir = log_dir()?;
    std::fs::create_dir_all(&dir).ok()?;

    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("stauri")
        .filename_suffix("log")
        .max_log_files(KEEP_LOG_FILES)
        .build(&dir)
        .ok()?;

    let (writer, guard) = tracing_appender::non_blocking(appender);
    let _ = GUARD.set(Mutex::new(Some(guard)));
    Some(writer)
}

// ===========================================================================
// ВЫЧИЩЕНИЕ СЕКРЕТОВ
// ===========================================================================

/// Приёмник, который правит строку перед записью.
///
/// Копит байты до перевода строки: ключ не должен проскочить только потому,
/// что `write` разбил его на два куска.
pub struct RedactingWriter<W> {
    inner: W,
    pending: Vec<u8>,
}

impl<W> RedactingWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            pending: Vec::new(),
        }
    }
}

impl<W: Write> Write for RedactingWriter<W> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.pending.extend_from_slice(data);

        while let Some(pos) = self.pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=pos).collect();
            let text = String::from_utf8_lossy(&line);
            self.inner.write_all(redact(&text).as_bytes())?;
        }

        if self.pending.len() > MAX_PENDING_LINE {
            let text = String::from_utf8_lossy(&self.pending).into_owned();
            self.inner.write_all(redact(&text).as_bytes())?;
            self.pending.clear();
        }

        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if !self.pending.is_empty() {
            let text = String::from_utf8_lossy(&self.pending).into_owned();
            self.inner.write_all(redact(&text).as_bytes())?;
            self.pending.clear();
        }
        self.inner.flush()
    }
}

/// Обёртка, превращающая любой [`MakeWriter`] в вычищающий.
struct Redacting<M> {
    inner: M,
}

impl<M> Redacting<M> {
    fn new(inner: M) -> Self {
        Self { inner }
    }
}

impl<'a, M> MakeWriter<'a> for Redacting<M>
where
    M: MakeWriter<'a>,
{
    type Writer = RedactingWriter<M::Writer>;

    fn make_writer(&'a self) -> Self::Writer {
        RedactingWriter::new(self.inner.make_writer())
    }
}

/// Имена полей и параметров, значение которых в лог попадать не должно.
///
/// Сравнение идёт по нормализованному виду: нижний регистр без `_` и `-`,
/// поэтому `apiKey`, `api_key` и `API-KEY` — одно и то же.
const SECRET_NAMES: &[&str] = &[
    "key",
    "apikey",
    "token",
    "accesstoken",
    "authtoken",
    "password",
    "passwordhash",
    "secret",
    "privatekey",
    "mnemonic",
    "channelkey",
];

fn is_secret_name(name: &str) -> bool {
    let normalized: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    SECRET_NAMES.contains(&normalized.as_str())
}

/// Вычищает секреты из строки лога.
///
/// Две независимые проверки, потому что источники разные:
/// * URL — `https://<host>/v2/<ключ>`, `?apikey=...`, `user:pass@host`;
/// * JSON — `"authToken":"..."` из вывода status-backend.
pub fn redact(input: &str) -> String {
    redact_json_fields(&redact_urls(input))
}

const SCHEMES: [&str; 4] = ["https://", "http://", "wss://", "ws://"];

fn redact_urls(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    loop {
        let Some(start) = find_scheme(rest) else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);

        let after = &rest[start..];
        let end = url_end(after);
        let (url, tail) = after.split_at(end);
        out.push_str(&redact_one_url(url));
        rest = tail;
    }

    out
}

fn find_scheme(input: &str) -> Option<usize> {
    SCHEMES.iter().filter_map(|scheme| input.find(scheme)).min()
}

/// Граница URL: пробел, кавычка, скобка или разделитель предложения.
fn url_end(input: &str) -> usize {
    input
        .char_indices()
        .find(|(_, c)| c.is_whitespace() || "\"'<>()[],;`".contains(*c))
        .map(|(i, _)| i)
        .unwrap_or(input.len())
}

fn redact_one_url(url: &str) -> String {
    let Some(scheme_end) = url.find("://") else {
        return url.to_string();
    };
    let (scheme, rest) = url.split_at(scheme_end + 3);

    let auth_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(auth_end);

    let authority = match authority.rfind('@') {
        Some(at) => format!("***@{}", &authority[at + 1..]),
        None => authority.to_string(),
    };

    let (path, query_and_frag) = match tail.find(['?', '#']) {
        Some(i) => tail.split_at(i),
        None => (tail, ""),
    };

    let (query, fragment) = query_and_frag
        .split_once('#')
        .map_or((query_and_frag, ""), |(q, f)| (q, f));

    let query = match query.strip_prefix('?') {
        Some(params) => format!("?{}", redact_query(params)),
        None => String::new(),
    };
    let fragment = if fragment.is_empty() {
        String::new()
    } else {
        format!("#{fragment}")
    };

    format!("{scheme}{authority}{}{query}{fragment}", redact_path(path))
}

fn redact_path(path: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (i, segment) in path.split('/').enumerate() {
        let previous = if i > 0 { parts[i - 1].as_str() } else { "" };
        if i > 0 && looks_like_secret_segment(segment, previous) {
            parts.push("***".to_string());
        } else {
            parts.push(segment.to_string());
        }
    }
    parts.join("/")
}

/// Ключ в пути URL.
///
/// Alchemy и Infura кладут его сразу за `v2`/`v3`. Остальные провайдеры
/// (QuickNode и подобные) — просто длинным токеном в первом сегменте пути.
fn looks_like_secret_segment(segment: &str, previous: &str) -> bool {
    if segment.is_empty() {
        return false;
    }
    if previous.eq_ignore_ascii_case("v2") || previous.eq_ignore_ascii_case("v3") {
        return true;
    }
    segment.len() >= 24
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn redact_query(query: &str) -> String {
    query
        .split('&')
        .map(|pair| match pair.split_once('=') {
            Some((name, _)) if is_secret_name(name) => format!("{name}=***"),
            _ => pair.to_string(),
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn redact_json_fields(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len() + 8);
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'"' {
            let start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                i += 1;
            }
            out.push_str(&input[start..i]);
            continue;
        }

        let Some((key, after_key)) = read_json_string(input, i) else {
            out.push_str(&input[i..]);
            break;
        };

        let mut colon = after_key;
        while colon < bytes.len() && bytes[colon].is_ascii_whitespace() {
            colon += 1;
        }
        let mut value_start = colon + 1;
        while value_start < bytes.len() && bytes[value_start].is_ascii_whitespace() {
            value_start += 1;
        }

        let is_string_value =
            colon < bytes.len() && bytes[colon] == b':' && bytes.get(value_start) == Some(&b'"');

        if is_string_value && is_secret_name(&key) {
            match read_json_string(input, value_start) {
                Some((_, after_value)) => {
                    // Сохраняем исходное написание ключа и пробелы вокруг
                    // двоеточия, заменяя только значение.
                    out.push_str(&input[i..value_start]);
                    out.push_str("\"***\"");
                    i = after_value;
                    continue;
                }
                None => {
                    out.push_str(&input[i..after_key]);
                    i = after_key;
                    continue;
                }
            }
        }

        out.push_str(&input[i..after_key]);
        i = after_key;
    }

    out
}

/// Читает JSON-строку с позиции `start` (там должна быть `"`).
///
/// Возвращает сырое содержимое и индекс сразу за закрывающей кавычкой.
/// Кавычка считается закрывающей, только если перед ней нечётное число
/// обратных слэшей.
fn read_json_string(input: &str, start: usize) -> Option<(String, usize)> {
    let bytes = input.as_bytes();
    if bytes.get(start) != Some(&b'"') {
        return None;
    }

    let mut raw = String::new();
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => return Some((raw, i + 1)),
            b'\\' if i + 1 < bytes.len() => {
                raw.push(bytes[i] as char);
                raw.push(bytes[i + 1] as char);
                i += 2;
            }
            byte => {
                raw.push(byte as char);
                i += 1;
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_alchemy_key_in_path() {
        assert_eq!(
            redact("GET https://eth-mainnet.g.alchemy.com/v2/abc123def456 done"),
            "GET https://eth-mainnet.g.alchemy.com/v2/*** done"
        );
    }

    #[test]
    fn masks_infura_key_in_path() {
        assert_eq!(
            redact("upstream https://mainnet.infura.io/v3/0123456789abcdef"),
            "upstream https://mainnet.infura.io/v3/***"
        );
    }

    #[test]
    fn masks_long_token_segment() {
        assert_eq!(
            redact("https://example.quiknode.pro/0123456789abcdef0123456789abcdef/"),
            "https://example.quiknode.pro/***/"
        );
    }

    #[test]
    fn masks_secret_query_parameter() {
        assert_eq!(
            redact("https://rpc.example.com/?apikey=secret&chain=1"),
            "https://rpc.example.com/?apikey=***&chain=1"
        );
    }

    #[test]
    fn masks_userinfo() {
        assert_eq!(
            redact("https://user:hunter2@rpc.example.com/1"),
            "https://***@rpc.example.com/1"
        );
    }

    #[test]
    fn keeps_ordinary_urls_intact() {
        let line = "rpc proxy on 127.0.0.1:43057 -> backend :12345";
        assert_eq!(redact(line), line);
        let url = "https://ethereum-rpc.publicnode.com";
        assert_eq!(redact(url), url);
    }

    #[test]
    fn masks_json_token_field() {
        assert_eq!(
            redact(r#"{"authToken":"abcdef","chainId":1}"#),
            r#"{"authToken":"***","chainId":1}"#
        );
    }

    #[test]
    fn masks_json_mnemonic_field_with_spaces() {
        assert_eq!(
            redact(r#"{"mnemonic" : "one two three"}"#),
            r#"{"mnemonic" : "***"}"#
        );
    }

    #[test]
    fn leaves_ordinary_json_alone() {
        let json = r#"{"chainId":1,"name":"Ethereum"}"#;
        assert_eq!(redact(json), json);
    }

    #[test]
    fn masks_every_url_in_a_line() {
        let line = "a https://x.alchemy.com/v2/KEY1 b https://y.infura.io/v3/KEY2 c";
        assert_eq!(
            redact(line),
            "a https://x.alchemy.com/v2/*** b https://y.infura.io/v3/*** c"
        );
    }

    #[test]
    fn writer_redacts_across_write_boundaries() {
        let mut out: Vec<u8> = Vec::new();
        {
            let mut writer = RedactingWriter::new(&mut out);
            // Ключ разрезан ровно посередине: построчная буферизация должна
            // склеить его обратно до вычищения.
            writer
                .write_all(b"url https://eth-mainnet.g.alchemy.com/v2/abc")
                .unwrap();
            writer.write_all(b"def\nnext line\n").unwrap();
        }
        let text = String::from_utf8(out).unwrap();
        assert_eq!(
            text,
            "url https://eth-mainnet.g.alchemy.com/v2/***\nnext line\n"
        );
    }
}
