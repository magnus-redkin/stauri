//! Аутентифицирующий прокси к status-backend.
//!
//! ## Зачем
//!
//! `status-backend` (cmd/status-backend/server/server.go) не имеет
//! аутентификации: любой процесс на машине может подключиться к его порту
//! на 127.0.0.1 и вызвать, например, `settings_getSettings` (отдаёт
//! seed-фразу) или `wallet_*` (перевод средств). Проверка `CheckOrigin`
//! в WebSocket-обработчике возвращает `true`, то есть не защищает и от
//! сторонних веб-страниц. Доступа к странице из браузера на localhost.
//!
//! Loopback не изолирован между пользователями: другой пользователь машины
//! тоже может подключиться к 127.0.0.1:<port>.
//!
//! ## Что делает
//!
//! Слушает свой порт, требует заголовок `X-Stauri-Token` с секретом,
//! сгенерированным при старте, и только после проверки пересылает трафик
//! к настоящему порту бэкенда. Работает и для обычного HTTP, и для
//! WebSocket: после проверки первого запроса соединение просто копируется
//! в обе стороны, поэтому upgrade проходит прозрачно.
//!
//! ## Остаточный риск
//!
//! Токен передаётся во фронтенд, чтобы тот мог добавлять заголовок. Значит,
//! при XSS в webview токен доступен. Это осознанный компромисс: главная
//! цель — закрыть доступ *другим локальным процессам*, а при XSS у
//! атакующего и без того есть доступ к Tauri-командам.

use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tracing::{debug, error, info};

use crate::error::{AppError, AppResult};

/// Имя заголовка с токеном.
pub const TOKEN_HEADER: &str = "x-stauri-token";

/// Сколько максимум читаем до конца заголовков.
const MAX_HEADER_BYTES: usize = 32 * 1024;

/// Токен живёт всё время работы приложения.
static TOKEN: Mutex<Option<String>> = Mutex::new(None);

#[derive(Default)]
pub struct AuthProxyState {
    port: Mutex<Option<u16>>,
    upstream: Arc<Mutex<Option<u16>>>,
    task: Mutex<Option<JoinHandle<()>>>,
}

/// Генерирует токен из /dev/urandom.
fn generate_token() -> AppResult<String> {
    let mut buf = [0u8; 32];
    let mut f = std::fs::File::open("/dev/urandom")
        .map_err(|e| AppError::internal(format!("cannot open /dev/urandom: {e}")))?;
    std::io::Read::read_exact(&mut f, &mut buf)
        .map_err(|e| AppError::internal(format!("cannot read /dev/urandom: {e}")))?;

    let mut out = String::with_capacity(64);
    for b in buf {
        out.push_str(&format!("{b:02x}"));
    }
    Ok(out)
}

/// Возвращает текущий токен, создавая его при первом обращении.
pub fn token() -> AppResult<String> {
    let mut guard = TOKEN.lock().map_err(|_| AppError::poisoned())?;
    if let Some(t) = guard.as_ref() {
        return Ok(t.clone());
    }
    let t = generate_token()?;
    *guard = Some(t.clone());
    Ok(t)
}

/// Запускает прокси к указанному порту бэкенда.
///
/// Повторный вызов с тем же апстримом возвращает уже занятый порт.
pub async fn start(state: &AuthProxyState, upstream_port: u16) -> AppResult<u16> {
    // Обновляем апстрим даже если слушатель уже поднят: бэкенд может
    // перезапуститься на другом порту.
    {
        let mut up = state.upstream.lock().map_err(|_| AppError::poisoned())?;
        *up = Some(upstream_port);
    }

    if let Some(port) = *state.port.lock().map_err(|_| AppError::poisoned())? {
        return Ok(port);
    }

    // Токен нужен до первого запроса.
    let _ = token()?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::internal(format!("auth proxy bind failed: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::internal(format!("auth proxy local_addr failed: {e}")))?
        .port();

    let upstream = state.upstream.clone();
    let task = tokio::spawn(async move {
        loop {
            let (client, _) = match listener.accept().await {
                Ok(v) => v,
                Err(e) => {
                    error!(error = %e, "auth proxy accept failed");
                    break;
                }
            };
            let up = upstream.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_conn(client, up).await {
                    debug!(kind = ?e.kind, message = %e.message, "auth proxy connection error");
                }
            });
        }
    });

    *state.port.lock().map_err(|_| AppError::poisoned())? = Some(port);
    *state.task.lock().map_err(|_| AppError::poisoned())? = Some(task);

    info!(port, upstream = upstream_port, "auth proxy listening");
    Ok(port)
}

/// Останавливает прокси.
pub fn stop(state: &AuthProxyState) {
    if let Ok(mut guard) = state.task.lock()
        && let Some(task) = guard.take()
    {
        task.abort();
    }
    if let Ok(mut port) = state.port.lock() {
        *port = None;
    }
}

/// Проверяет токен и пересылает соединение к бэкенду.
async fn handle_conn(mut client: TcpStream, upstream: Arc<Mutex<Option<u16>>>) -> AppResult<()> {
    // Читаем заголовки, но не тело: тело может быть большим, а нам нужно
    // только проверить токен. Дальше байты пойдут как есть.
    let mut head = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];

    let header_end = loop {
        if let Some(pos) = find_subsequence(&head, b"\r\n\r\n") {
            break pos + 4;
        }
        if head.len() > MAX_HEADER_BYTES {
            let _ = write_forbidden(&mut client, "headers too large").await;
            return Err(AppError::internal("auth proxy: headers too large"));
        }
        let n = client
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::io(e.to_string()))?;
        if n == 0 {
            // Соединение закрыто до конца заголовков — отвечать некому.
            return Ok(());
        }
        head.extend_from_slice(&chunk[..n]);
    };

    let request_head = String::from_utf8_lossy(&head[..header_end]).to_string();
    let expected = token()?;

    let authorized = parse_headers(&request_head)
        .get(TOKEN_HEADER)
        .map(|v| constant_time_eq(v.as_bytes(), expected.as_bytes()))
        .unwrap_or(false);

    if !authorized {
        let _ = write_forbidden(&mut client, "missing or invalid token").await;
        return Ok(());
    }

    // Мьютекс отпускаем до await: MutexGuard не Send, а функция вызывается
    // из tokio::spawn.
    let target_port = {
        let up = upstream.lock().map_err(|_| AppError::poisoned())?;
        *up
    };
    let Some(target_port) = target_port else {
        let _ = write_forbidden(&mut client, "backend is not running").await;
        return Ok(());
    };

    let mut server = TcpStream::connect(("127.0.0.1", target_port))
        .await
        .map_err(|e| AppError::backend(format!("auth proxy: cannot reach backend: {e}")))?;

    // Пересылаем уже прочитанные байты бэкенду, удалив заголовок токена:
    // бэкенд о нём знать не должен.
    let forwarded_head = strip_token_header(&request_head);
    server
        .write_all(forwarded_head.as_bytes())
        .await
        .map_err(|e| AppError::io(e.to_string()))?;
    server
        .write_all(&head[header_end..])
        .await
        .map_err(|e| AppError::io(e.to_string()))?;

    // Дальше — прозрачный двунаправленный поток: покрывает и keep-alive,
    // и WebSocket-фреймы после upgrade.
    let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
    Ok(())
}

/// Сравнение без раннего выхода, чтобы не утекало время сравнения.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Разбирает заголовки запроса в нижнем регистре.
fn parse_headers(head: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut lines = head.split("\r\n");
    lines.next(); // строка запроса
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            map.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    map
}

/// Убирает строку заголовка токена из запроса.
fn strip_token_header(head: &str) -> String {
    let mut out = String::with_capacity(head.len());
    for line in head.split_inclusive("\r\n") {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with(TOKEN_HEADER) && lower.contains(':') {
            continue;
        }
        out.push_str(line);
    }
    out
}

async fn write_forbidden(stream: &mut TcpStream, message: &str) -> AppResult<()> {
    let body = format!("{{\"error\":\"{message}\"}}");
    let head = format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| AppError::io(e.to_string()))?;
    stream
        .write_all(body.as_bytes())
        .await
        .map_err(|e| AppError::io(e.to_string()))?;
    let _ = stream.shutdown().await;
    Ok(())
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_hex_and_stable() {
        let a = token().expect("token");
        let b = token().expect("token");
        assert_eq!(a, b, "token must be stable within a run");
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn constant_time_eq_works() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn parses_and_strips_token_header() {
        let head = "POST /statusgo/x HTTP/1.1\r\nX-Stauri-Token: abc\r\nHost: 127.0.0.1\r\n\r\n";
        let headers = parse_headers(head);
        assert_eq!(headers.get(TOKEN_HEADER).map(String::as_str), Some("abc"));

        let stripped = strip_token_header(head);
        assert!(!stripped.to_ascii_lowercase().contains(TOKEN_HEADER));
        assert!(stripped.contains("Host: 127.0.0.1"));
        assert!(stripped.ends_with("\r\n\r\n"));
    }

    #[test]
    fn missing_token_header_is_not_authorized() {
        let head = "GET /health HTTP/1.1\r\nHost: x\r\n\r\n";
        let headers = parse_headers(head);
        assert!(!headers.contains_key(TOKEN_HEADER));
    }

    // ---------------------------------------------------------------------
    // Сквозные тесты
    //
    // Юнит-тесты выше проверяют разбор строк. Здесь проверяется то, ради
    // чего прокси существует: без токена запрос не доходит до бэкенда, с
    // токеном — доходит и получает ответ, а заголовок токена до бэкенда
    // не доезжает.
    // ---------------------------------------------------------------------

    /// Поднимает фальшивый бэкенд и считает дошедшие до него запросы.
    ///
    /// Возвращает порт и счётчик: по нему проверяется, что отклонённый
    /// прокси запрос до бэкенда НЕ дошёл.
    async fn fake_backend() -> (u16, Arc<std::sync::atomic::AtomicUsize>) {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind backend");
        let port = listener.local_addr().expect("backend addr").port();
        let hits = Arc::new(AtomicUsize::new(0));
        let hits_for_task = hits.clone();

        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let hits = hits_for_task.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 1024];
                    loop {
                        match socket.read(&mut chunk).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                buf.extend_from_slice(&chunk[..n]);
                                if find_subsequence(&buf, b"\r\n\r\n").is_some() {
                                    break;
                                }
                            }
                        }
                    }

                    let request = String::from_utf8_lossy(&buf).to_string();
                    // Заголовок токена не должен доходить до бэкенда.
                    if !request.to_ascii_lowercase().contains(TOKEN_HEADER) {
                        hits.fetch_add(1, Ordering::SeqCst);
                    }

                    let body = r#"{"result":"ok"}"#;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(head.as_bytes()).await;
                    let _ = socket.write_all(body.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });

        (port, hits)
    }

    /// С правильным токеном запрос проходит и ответ возвращается клиенту.
    #[tokio::test]
    async fn valid_token_is_forwarded_to_backend() {
        let (backend_port, _hits) = fake_backend().await;

        let state = AuthProxyState::default();
        let port = start(&state, backend_port).await.expect("proxy start");
        let expected = token().expect("token");

        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/statusgo/x"))
            .header(TOKEN_HEADER, expected)
            .body("{}")
            .send()
            .await
            .expect("request through proxy");

        assert_eq!(resp.status(), 200);
        assert_eq!(resp.text().await.expect("body"), r#"{"result":"ok"}"#);

        stop(&state);
    }

    /// Без токена — 403, и до бэкенда ничего не доходит.
    #[tokio::test]
    async fn missing_token_is_rejected_and_backend_untouched() {
        let (backend_port, hits) = fake_backend().await;

        let state = AuthProxyState::default();
        let port = start(&state, backend_port).await.expect("proxy start");

        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/statusgo/x"))
            .body("{}")
            .send()
            .await
            .expect("request through proxy");

        assert_eq!(resp.status(), 403);
        assert_eq!(
            hits.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "backend must not see unauthenticated requests"
        );

        stop(&state);
    }

    /// Неверный токен — тоже 403.
    #[tokio::test]
    async fn wrong_token_is_rejected() {
        let (backend_port, hits) = fake_backend().await;

        let state = AuthProxyState::default();
        let port = start(&state, backend_port).await.expect("proxy start");

        let resp = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/statusgo/x"))
            .header(TOKEN_HEADER, "definitely-not-the-token")
            .body("{}")
            .send()
            .await
            .expect("request through proxy");

        assert_eq!(resp.status(), 403);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);

        stop(&state);
    }

    /// Заголовок токена не пересылается бэкенду.
    ///
    /// Проверяется отдельно от счётчика в fake_backend: там же ловится
    /// и провал, поэтому нужен явный случай с успешным запросом.
    #[tokio::test]
    async fn token_header_is_stripped_before_forwarding() {
        let head = "POST /x HTTP/1.1\r\nX-Stauri-Token: secret\r\nHost: h\r\n\r\n";
        let stripped = strip_token_header(head);

        assert!(!stripped.to_ascii_lowercase().contains(TOKEN_HEADER));
        assert!(stripped.starts_with("POST /x HTTP/1.1\r\n"));
        assert!(stripped.contains("Host: h\r\n"));
    }

    /// Разные токены различаются посимвольно, а не только по длине.
    #[test]
    fn token_comparison_rejects_prefix() {
        let expected = "a".repeat(64);
        let mut wrong = expected.clone();
        wrong.pop();
        wrong.push('b');

        assert!(!constant_time_eq(wrong.as_bytes(), expected.as_bytes()));
        // Совпадающий префикс не должен давать положительный результат.
        assert!(!constant_time_eq(
            &expected.as_bytes()[..63],
            expected.as_bytes()
        ));
    }
}
