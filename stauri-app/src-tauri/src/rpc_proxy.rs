//! Локальный HTTP-форвардер для RPC.
//!
//! Зачем он нужен: status-go переиспользует TCP-соединения из пула
//! (`http.DefaultTransport`), а в этом канале соединения тихо умирают —
//! сокет остаётся ESTAB, пакеты уходят, ответов нет, повторы копятся
//! до `tcp_retries2`. В результате запрос к живому RPC висит 20 секунд
//! и падает по таймауту circuit breaker'а.
//!
//! Поэтому status-go смотрит не на провайдера напрямую, а на
//! `http://127.0.0.1:<port>/<секрет>/<chainId>`, а этот форвардер на каждый
//! запрос открывает НОВОЕ соединение к upstream (пул отключён через
//! `pool_max_idle_per_host(0)`) — ровно так ведёт себя curl, который
//! в тех же условиях работает.
//!
//! # Почему секрет в пути, а не заголовок
//!
//! В форвардер ходит **status-go**, а не наш фронтенд: URL провайдера
//! записывается через `networks_setChainUserRpcProviders` и используется
//! внутри ноды. Заголовок `X-Stauri-Token` нода не пошлёт, поэтому защита
//! живёт в самом URL — единственном, что мы можем туда передать.
//!
//! Без этого любой процесс на машине (и любой сайт, открытый в WebView
//! dApp) мог обратиться к `127.0.0.1:<port>/1` и получить доступ к RPC.
//! Проверено: до правки запрос без параметров отвечал `HTTP 200`.
//!
//! Секрет генерируется один раз, хранится в файле и переживает перезапуск:
//! URL провайдеров уже записан в базу status-go, и со случайным секретом на
//! новом старте они указывали бы в никуда.

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

/// Длина секрета в пути, в hex-символах.
///
/// 32 символа = 128 бит энтропии. Перебирать его по сети бессмысленно, а
/// короткий был бы уязвим к перебору с той же машины.
const SECRET_HEX_LEN: usize = 32;

type Upstreams = Arc<Mutex<HashMap<u64, String>>>;

struct Handle {
    port: u16,
    /// Секрет, который обязан быть в пути каждого запроса.
    secret: String,
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

    /// Секрет пути. `None`, если форвардер не запущен.
    pub fn secret(&self) -> Option<String> {
        self.handle.lock().ok()?.as_ref().map(|h| h.secret.clone())
    }
}

/// Каталог для секрета — рядом с конфигом приложения.
fn secret_path() -> Option<std::path::PathBuf> {
    let dir = dirs::config_dir()?.join(env_identifier());
    Some(dir.join("rpc-proxy.secret"))
}

fn env_identifier() -> &'static str {
    crate::env::APP_IDENTIFIER
}

/// Читает секрет из файла или создаёт новый.
///
/// ## Почему файл, а не память
///
/// URL провайдера (`http://127.0.0.1:<port>/<секрет>/<chainId>`) записывается
/// в базу status-go и переживает перезапуск. С секретом в памяти на новом
/// старте все провайдеры указывали бы в никуда, и кошелёк остался бы без RPC.
///
/// Файл создаётся с правами `0600`: секрет даёт доступ к форвардеру, а через
/// него — к RPC-эндпоинтам.
fn load_or_create_secret() -> AppResult<String> {
    let path = secret_path()
        .ok_or_else(|| AppError::config("cannot determine config dir for rpc proxy secret"))?;

    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if trimmed.len() == SECRET_HEX_LEN && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(trimmed);
        }
        // Файл есть, но содержимое негодное: перегенерируем, а не падаем.
        // Худшее последствие — провайдеры в базе перестанут совпадать, и
        // `configureWalletRpc` перезапишет их новым URL.
        debug!(?path, "rpc proxy secret file is malformed, regenerating");
    }

    if let Some(parent) = path.parent()
        && let Err(e) = std::fs::create_dir_all(parent)
    {
        return Err(AppError::io(format!(
            "cannot create config dir for rpc proxy secret: {e}"
        )));
    }

    let secret = generate_secret()?;

    // Права выставляем до записи, чтобы не было окна с читаемым файлом.
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| AppError::io(format!("cannot create secret file: {e}")))?;
        file.write_all(secret.as_bytes())
            .map_err(|e| AppError::io(format!("cannot write secret file: {e}")))?;
    }

    #[cfg(not(unix))]
    {
        std::fs::write(&path, secret.as_bytes())
            .map_err(|e| AppError::io(format!("cannot write secret file: {e}")))?;
    }

    info!(?path, "rpc proxy secret generated");
    Ok(secret)
}

/// 16 случайных байт в hex.
fn generate_secret() -> AppResult<String> {
    use std::io::Read;
    let mut buf = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|e| AppError::internal(format!("cannot read randomness: {e}")))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
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

    let secret = load_or_create_secret()?;

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

    let task = tokio::spawn(accept_loop(
        listener,
        client,
        shared.clone(),
        secret.clone(),
    ));

    if let Ok(mut guard) = state.handle.lock() {
        *guard = Some(Handle {
            port,
            secret,
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

async fn accept_loop(
    listener: TcpListener,
    client: reqwest::Client,
    upstreams: Upstreams,
    secret: String,
) {
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
        let secret = secret.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, client, upstreams, &secret).await {
                debug!(kind = ?e.kind, message = %e.message, "rpc proxy request failed");
            }
        });
    }
}

/// Сравнение без раннего выхода — чтобы по времени ответа нельзя было
/// подобрать секрет посимвольно.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn handle_conn(
    mut stream: TcpStream,
    client: reqwest::Client,
    upstreams: Upstreams,
    secret: &str,
) -> AppResult<()> {
    let (request_line, _headers, body) = read_request(&mut stream).await?;

    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let mut parts = path
        .trim_start_matches('/')
        .split('?')
        .next()
        .unwrap_or("")
        .split('/');

    let given_secret = parts.next().unwrap_or("");
    let chain_part = parts.next().unwrap_or("");

    // Проверка секрета — до любого разбора: неверный путь не должен
    // раскрывать, существует ли такая сеть, и не должен считаться ошибкой.
    if !constant_time_eq(given_secret, secret) {
        // Отвечаем как на отсутствующий ресурс, а не 403: иначе чужая
        // программа узнаёт, что попала на наш форвардер, и может подбирать
        // дальше. Секрет при этом не логируем.
        debug!("rpc proxy request with invalid secret rejected");
        return write_plain(&mut stream, 404, "not found").await;
    }

    let chain_id: u64 = chain_part
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

    /// Поднимает локальный HTTP-сервер, отвечающий фиксированным JSON.
    ///
    /// Нужен вместо настоящего провайдера: тесты не должны ходить в сеть.
    /// Иначе они падают в CI без интернета и страдают от чужих лимитов.
    async fn mock_upstream(response_body: &'static str) -> (u16, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
        let port = listener.local_addr().expect("mock addr").port();

        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    // Читаем запрос целиком, чтобы клиент не получил RST.
                    let _ = read_request(&mut socket).await;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        response_body.len()
                    );
                    let _ = socket.write_all(head.as_bytes()).await;
                    let _ = socket.write_all(response_body.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });

        (port, handle)
    }

    /// Собирает URL форвардера так, как это делает фронтенд в
    /// `rpcConfig.ts`: секрет идёт первым сегментом пути.
    fn url_for(state: &RpcProxyState, port: u16, tail: &str) -> String {
        let secret = state.secret().expect("running proxy must expose a secret");
        format!("http://127.0.0.1:{port}/{secret}/{tail}")
    }

    /// Сквозной путь: запрос на локальный порт -> отдельный сокет к upstream
    /// -> ответ JSON-RPC обратно клиенту.
    #[tokio::test]
    async fn proxies_json_rpc_request() {
        let (mock_port, mock) =
            mock_upstream(r#"{"jsonrpc":"2.0","id":1,"result":"0x1234"}"#).await;

        let state = RpcProxyState::default();
        let mut map = HashMap::new();
        map.insert(1u64, format!("http://127.0.0.1:{mock_port}"));
        let port = start_on(&state, map, 0)
            .await
            .expect("proxy should start on any free port");

        let client = reqwest::Client::new();
        let resp = client
            .post(url_for(&state, port, "1"))
            .header("Content-Type", "application/json")
            .body(r#"{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}"#)
            .send()
            .await
            .expect("request to proxy should succeed");

        assert_eq!(resp.status(), 200);
        let text = resp.text().await.expect("body text");
        let body: serde_json::Value = serde_json::from_str(&text).expect("json body");
        assert_eq!(
            body.get("result").and_then(|v| v.as_str()),
            Some("0x1234"),
            "proxy must pass the upstream body through unchanged: {body}"
        );

        stop(&state);
        mock.abort();
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
            .post(url_for(&state, port, "999"))
            .body("{}")
            .send()
            .await
            .expect("request should complete");

        assert_eq!(resp.status(), 503);
        stop(&state);
    }

    /// Мёртвый upstream — 502 с JSON-RPC-ошибкой, а не обрыв соединения.
    ///
    /// Иначе ethclient видит EOF и тратит время на повтор, хотя причина
    /// уже известна.
    #[tokio::test]
    async fn dead_upstream_returns_502() {
        // Занимаем порт и сразу отпускаем: почти наверняка там никого нет.
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let dead_port = listener.local_addr().expect("addr").port();
        drop(listener);

        let state = RpcProxyState::default();
        let mut map = HashMap::new();
        map.insert(1u64, format!("http://127.0.0.1:{dead_port}"));
        let port = start_on(&state, map, 0).await.expect("proxy start");

        let resp = reqwest::Client::new()
            .post(url_for(&state, port, "1"))
            .body("{}")
            .send()
            .await
            .expect("proxy must answer, not drop the connection");

        assert_eq!(resp.status(), 502);
        let text = resp.text().await.expect("body");
        assert!(
            text.contains("\"error\""),
            "expected JSON-RPC error body, got: {text}"
        );

        stop(&state);
    }

    /// Смена таблицы на лету: новый chainId становится доступен без
    /// перезапуска форвардера.
    #[tokio::test]
    async fn set_upstreams_takes_effect_without_restart() {
        let (mock_port, mock) = mock_upstream(r#"{"jsonrpc":"2.0","id":1,"result":"0x1"}"#).await;

        let state = RpcProxyState::default();
        let port = start_on(&state, HashMap::new(), 0)
            .await
            .expect("proxy start");

        let client = reqwest::Client::new();
        let url = url_for(&state, port, "42161");

        // До обновления таблицы сети нет.
        assert_eq!(
            client.post(&url).body("{}").send().await.unwrap().status(),
            503
        );

        let mut map = HashMap::new();
        map.insert(42161u64, format!("http://127.0.0.1:{mock_port}"));
        set_upstreams(&state, map);

        assert_eq!(
            client.post(&url).body("{}").send().await.unwrap().status(),
            200
        );

        stop(&state);
        mock.abort();
    }

    /// Запрос с испорченным chainId не должен ронять процесс.
    #[tokio::test]
    async fn bad_chain_id_does_not_panic() {
        let state = RpcProxyState::default();
        let port = start_on(&state, HashMap::new(), 0)
            .await
            .expect("proxy start");

        let resp = reqwest::Client::new()
            .post(url_for(&state, port, "not-a-number"))
            .body("{}")
            .send()
            .await;

        // Соединение может быть закрыто без ответа — главное, что процесс
        // жив и следующий запрос обслуживается.
        let _ = resp;

        let ok = reqwest::Client::new()
            .post(url_for(&state, port, "999"))
            .body("{}")
            .send()
            .await
            .expect("proxy must still serve requests");
        assert_eq!(ok.status(), 503);

        stop(&state);
    }

    /// Запрос без секрета в пути должен отклоняться.
    ///
    /// Это регрессия на реальную дыру: до появления секрета любой процесс на
    /// машине (и любая страница в WebView dApp) мог обратиться к
    /// `127.0.0.1:<port>/1` и получить `HTTP 200` — то есть доступ к RPC.
    ///
    /// Отвечаем именно 404, а не 403: 403 подтвердил бы, что на порту
    /// действительно живёт форвардер, и подсказал бы перебирать пути дальше.
    #[tokio::test]
    async fn request_without_secret_is_rejected() {
        let (mock_port, mock) = mock_upstream(r#"{"jsonrpc":"2.0","id":1,"result":"0x1"}"#).await;

        let state = RpcProxyState::default();
        let mut map = HashMap::new();
        map.insert(1u64, format!("http://127.0.0.1:{mock_port}"));
        let port = start_on(&state, map, 0).await.expect("proxy start");

        let client = reqwest::Client::new();

        // Голый chainId без секрета — ровно то, чем эксплуатировалась дыра.
        let bare = client
            .post(format!("http://127.0.0.1:{port}/1"))
            .body("{}")
            .send()
            .await
            .expect("proxy must answer");
        assert_eq!(
            bare.status(),
            404,
            "request without secret must be rejected"
        );

        // Чужой секрет той же длины.
        let wrong = client
            .post(format!(
                "http://127.0.0.1:{port}/{}",
                "a".repeat(SECRET_HEX_LEN)
            ))
            .body("{}")
            .send()
            .await
            .expect("proxy must answer");
        assert_eq!(
            wrong.status(),
            404,
            "request with wrong secret must be rejected"
        );

        // А правильный пропускает — иначе тест выше проходил бы и на
        // форвардере, который отклоняет всё подряд.
        let ok = client
            .post(url_for(&state, port, "1"))
            .body("{}")
            .send()
            .await
            .expect("proxy must answer");
        assert_eq!(ok.status(), 200, "request with valid secret must pass");

        stop(&state);
        mock.abort();
    }
}
