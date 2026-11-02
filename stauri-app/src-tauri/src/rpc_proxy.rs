//! Локальный HTTP-форвардер для RPC.
//!
//! Зачем он нужен: status-go переиспользует TCP-соединения из пула
//! (`http.DefaultTransport`), а в этом канале соединения тихо умирают —
//! сокет остаётся ESTAB, пакеты уходят, ответов нет, повторы копятся
//! до `tcp_retries2`. В результате запрос к живому RPC висит 20 секунд
//! и падает по таймауту circuit breaker'а.
//!
//! Поэтому status-go смотрит не на провайдера напрямую, а на
//! `http://127.0.0.1:<port>/<chainId>`, а этот форвардер на каждый
//! запрос открывает НОВОЕ соединение к upstream (пул отключён через
//! `pool_max_idle_per_host(0)`) — ровно так ведёт себя curl, который
//! в тех же условиях работает.

use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, error, info};

/// Максимальный размер заголовков и тела входящего запроса.
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// Порт, который форвардер старается занять.
///
/// Порт обязан быть постоянным: URL провайдера (`http://127.0.0.1:<port>/<chain>`)
/// сохраняется в БД status-go и переживает перезапуск приложения. Со случайным
/// портом на следующем старте провайдер указывал бы в никуда, и RPC-клиент,
/// созданный при инициализации ноды, был бы уже нерабочим.
const PREFERRED_PORT: u16 = 43057;

type Upstreams = Arc<Mutex<HashMap<u64, String>>>;

struct Handle {
    port: u16,
    task: tokio::task::JoinHandle<()>,
    upstreams: Upstreams,
}

#[derive(Default)]
pub struct RpcProxyState {
    handle: Mutex<Option<Handle>>,
}

impl RpcProxyState {
    pub fn port(&self) -> Option<u16> {
        self.handle.lock().ok()?.as_ref().map(|h| h.port)
    }
}

/// Запускает форвардер с картой chainId -> upstream.
///
/// Повторный вызов возвращает уже занятый порт, второй слушатель не
/// поднимается, но карта upstream-ов обновляется.
///
/// ## Почему порт не должен меняться молча
///
/// URL провайдера (`http://127.0.0.1:<port>/<chain>`) сохраняется в БД
/// status-go и переживает перезапуск приложения. Если при старте занять
/// вместо него случайный порт:
///
/// * клиент, собранный при инициализации ноды, смотрит на `<port>` и будет
///   получать ответы от **чужого** процесса, если тот его слушает, —
///   запросы уходят в неизвестное место;
/// * либо получает отказ от чужого процесса и выглядит как «провайдер мёртв».
///
/// Поэтому порт фиксирован: занят — возвращаем ошибку с объяснением.
/// Вызывающая сторона сама решает, что делать, а не получает втихую
/// нерабочую конфигурацию.
pub async fn start(state: &RpcProxyState, upstreams: HashMap<u64, String>) -> AppResult<u16> {
    start_on(state, upstreams, PREFERRED_PORT).await
}

/// Запуск на заданном порту. `0` — любой свободный.
///
/// Отдельно от [`start`], чтобы тесты не дрались за production-порт:
/// два теста `#[tokio::test]` идут параллельно и оба биндили бы 43057.
pub async fn start_on(
    state: &RpcProxyState,
    upstreams: HashMap<u64, String>,
    preferred: u16,
) -> AppResult<u16> {
    if let Some(port) = state.port() {
        set_upstreams(state, upstreams);
        return Ok(port);
    }

    let listener = TcpListener::bind(("127.0.0.1", preferred))
        .await
        .map_err(|e| {
            AppError::internal(format!(
                "RPC-провайдеры указывают на 127.0.0.1:{preferred}, но этот порт занят ({e}). \
                 Скорее всего работает другая копия Stauri — закройте её и перезапустите приложение."
            ))
        })?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::internal(format!("rpc proxy local_addr failed: {e}")))?
        .port();

    let shared: Upstreams = Arc::new(Mutex::new(upstreams));

    // Пул отключён: каждое соединение живёт один запрос. Это и есть суть фикса.
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::internal(format!("rpc proxy client failed: {e}")))?;

    let task = tokio::spawn(accept_loop(listener, client, shared.clone()));

    if let Ok(mut guard) = state.handle.lock() {
        *guard = Some(Handle {
            port,
            task,
            upstreams: shared,
        });
    }

    info!(port, "rpc proxy listening");
    Ok(port)
}

pub fn stop(state: &RpcProxyState) {
    if let Ok(mut guard) = state.handle.lock()
        && let Some(handle) = guard.take()
    {
        handle.task.abort();
        info!(port = handle.port, "rpc proxy stopped");
    }
}

pub fn set_upstreams(state: &RpcProxyState, map: HashMap<u64, String>) {
    let guard = match state.handle.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(handle) = guard.as_ref()
        && let Ok(mut target) = handle.upstreams.lock()
    {
        *target = map;
    }
}

async fn accept_loop(listener: TcpListener, client: reqwest::Client, upstreams: Upstreams) {
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                error!(error = %e, "rpc proxy accept failed");
                continue;
            }
        };
        let client = client.clone();
        let upstreams = upstreams.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, client, upstreams).await {
                debug!(kind = ?e.kind, message = %e.message, "rpc proxy request failed");
            }
        });
    }
}

async fn handle_conn(
    mut stream: TcpStream,
    client: reqwest::Client,
    upstreams: Upstreams,
) -> AppResult<()> {
    let (request_line, _headers, body) = read_request(&mut stream).await?;

    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let chain_id: u64 = path
        .trim_start_matches('/')
        .split('?')
        .next()
        .unwrap_or("")
        .parse()
        .map_err(|_| AppError::internal(format!("bad chain id in path: {path}")))?;

    let upstream = {
        let guard = upstreams.lock().map_err(|_| AppError::poisoned())?;
        guard.get(&chain_id).cloned()
    };
    let Some(upstream) = upstream else {
        return write_plain(&mut stream, 503, "no upstream configured for chain").await;
    };

    let response = match client
        .post(&upstream)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // Отдаём 502 с JSON-RPC-ошибкой, а не рвём соединение молча:
            // иначе ethclient видит EOF и тратит время на повтор запроса,
            // хотя причина уже известна.
            let body = format!(
                "{{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{{\"code\":-32603,\"message\":\"rpc proxy: {}\"}}}}",
                e.to_string().replace('\\', "\\\\").replace('"', "\\\"")
            );
            return write_json(&mut stream, 502, body.as_bytes()).await;
        }
    };

    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::network(format!("upstream body read failed: {e}")))?;

    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        reason(status),
        bytes.len()
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| AppError::io(e.to_string()))?;
    stream
        .write_all(&bytes)
        .await
        .map_err(|e| AppError::io(e.to_string()))?;
    let _ = stream.shutdown().await;
    Ok(())
}

/// Отдаёт JSON-тело с указанным статусом и закрывает соединение.
async fn write_json(stream: &mut TcpStream, status: u16, body: &[u8]) -> AppResult<()> {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        reason(status),
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| AppError::io(e.to_string()))?;
    stream
        .write_all(body)
        .await
        .map_err(|e| AppError::io(e.to_string()))?;
    let _ = stream.shutdown().await;
    Ok(())
}

/// Читает запрос целиком: строку запроса, заголовки и тело по Content-Length.
async fn read_request(
    stream: &mut TcpStream,
) -> AppResult<(String, HashMap<String, String>, Vec<u8>)> {
    let mut buf = Vec::with_capacity(8192);
    let mut chunk = [0u8; 4096];

    let header_end = loop {
        if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Err(AppError::internal("headers too large"));
        }
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::io(e.to_string()))?;
        if n == 0 {
            return Err(AppError::internal("connection closed before headers"));
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err(AppError::internal("body too large"));
    }

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::io(e.to_string()))?;
        if n == 0 {
            return Err(AppError::internal("connection closed before body"));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok((request_line, headers, body))
}

async fn write_plain(stream: &mut TcpStream, code: u16, message: &str) -> AppResult<()> {
    let body = format!(
        "{{\"jsonrpc\":\"2.0\",\"error\":{{\"code\":-32603,\"message\":\"{}\"}}}}",
        message
    );
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        code,
        reason(code),
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
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Проверяет весь путь: HTTP-запрос на локальный порт -> новый сокет к
    /// upstream -> ответ JSON-RPC обратно клиенту.
    #[tokio::test]
    async fn proxies_json_rpc_request() {
        let state = RpcProxyState::default();
        let mut map = HashMap::new();
        map.insert(1u64, "https://ethereum-rpc.publicnode.com".to_string());
        let port = start_on(&state, map, 0)
            .await
            .expect("proxy should start on any free port");

        let client = reqwest::Client::new();
        let resp = client
            .post(format!("http://127.0.0.1:{}/1", port))
            .header("Content-Type", "application/json")
            .body(r#"{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}"#)
            .send()
            .await
            .expect("request to proxy should succeed");

        assert_eq!(resp.status(), 200);
        let text = resp.text().await.expect("body text");
        let body: serde_json::Value = serde_json::from_str(&text).expect("json body");
        let result = body.get("result").and_then(|v| v.as_str()).unwrap_or("");
        assert!(
            result.starts_with("0x"),
            "expected hex block number, got: {}",
            body
        );

        stop(&state);
    }

    /// Неизвестная сеть должна давать 503, а не молчаливый таймаут.
    #[tokio::test]
    async fn unknown_chain_returns_503() {
        let state = RpcProxyState::default();
        let port = start_on(&state, HashMap::new(), 0)
            .await
            .expect("proxy should start on any free port");

        let client = reqwest::Client::new();
        let resp = client
            .post(format!("http://127.0.0.1:{}/999", port))
            .body("{}")
            .send()
            .await
            .expect("request should complete");

        assert_eq!(resp.status(), 503);
        stop(&state);
    }
}
