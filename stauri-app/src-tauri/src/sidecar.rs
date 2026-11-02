//! Управление процессом `status-backend`: запуск, остановка, PID-файл,
//! чтение логов.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_shell::{ShellExt, process::CommandChild};
use tracing::{debug, info, warn};

use crate::auth_proxy;
use crate::config::{config_for_network, load_config};
use crate::error::{AppError, AppResult};

/// Состояние бэкенда, разделяемое командами.
pub struct BackendState {
    pub child: Mutex<Option<CommandChild>>,
    pub port: Mutex<Option<u16>>,
    pub data_dir: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
pub struct StartBackendResponse {
    pub port: u16,
    /// Порт аутентифицирующего прокси. Фронтенд ходит только сюда;
    /// `port` — настоящий порт бэкенда, наружу не нужен.
    #[serde(rename = "authPort")]
    pub auth_port: u16,
    #[serde(rename = "dataDir")]
    pub data_dir: String,
    #[serde(rename = "networkName")]
    pub network_name: String,
    #[serde(rename = "chainId")]
    pub chain_id: u64,
    #[serde(rename = "rpcUrl")]
    pub rpc_url: String,
    #[serde(rename = "wakuFleet")]
    pub waku_fleet: String,
    #[serde(rename = "isTestnet")]
    pub is_testnet: bool,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(None),
            data_dir: Mutex::new(None),
        }
    }
}

/// Убивает процесс, оставшийся от предыдущего запуска.
///
/// PID-файл пишется при старте, но при аварийном завершении остаётся.
/// Проверяем имя процесса, чтобы не убить чужой PID, если файл устарел.
pub fn kill_stale_backend(dir: &Path) {
    let pid_file = dir.join("status-backend.pid");
    if let Ok(s) = std::fs::read_to_string(&pid_file) {
        if let Ok(pid) = s.trim().parse::<u32>() {
            #[cfg(target_os = "linux")]
            {
                if std::fs::read_to_string(format!("/proc/{pid}/comm"))
                    .map(|c| c.trim() == "status-backend")
                    .unwrap_or(false)
                {
                    let _ = std::process::Command::new("kill")
                        .arg(pid.to_string())
                        .status();
                }
            }
        }
        let _ = std::fs::remove_file(&pid_file);
    }
}

/// Запускает sidecar и аутентифицирующий прокси.
pub async fn start(
    app: tauri::AppHandle,
    network: Option<String>,
) -> AppResult<StartBackendResponse> {
    let state = app.state::<BackendState>();

    // 1. Проверяем, не запущен ли уже процесс.
    //
    // Мьютексы здесь удерживаются только для чтения и отпускаются до
    // первого await: MutexGuard не Send, а start — async.
    let already_running = {
        let child_lock = state.child.lock().map_err(|_| AppError::poisoned())?;
        child_lock.is_some()
    };

    if already_running {
        // Если процесс уже запущен, но запрошена другая сеть — возвращаем ошибку
        let current_config = load_config();
        if let Some(ref net) = network
            && net != &current_config.network_name()
        {
            return Err(AppError::backend(format!(
                "backend already running on network '{}', cannot switch to '{}' without restart",
                current_config.network_name(),
                net
            )));
        }
        let port = {
            let port_lock = state.port.lock().map_err(|_| AppError::poisoned())?;
            port_lock.unwrap_or(0)
        };

        let data_dir_str = {
            let data_dir_lock = state.data_dir.lock().map_err(|_| AppError::poisoned())?;
            data_dir_lock
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default()
        };

        let config = if let Some(net) = &network {
            config_for_network(net)?
        } else {
            load_config()
        };

        // Запускаем аутентифицирующий прокси и отдаём фронтенду его порт.
        // Сам порт бэкенда остаётся внутренним.
        let auth_state = app.state::<auth_proxy::AuthProxyState>();
        let auth_port = auth_proxy::start(&auth_state, port).await?;

        return Ok(StartBackendResponse {
            port,
            auth_port,
            data_dir: data_dir_str,
            network_name: config.network_name(),
            chain_id: config.chain_id(),
            rpc_url: config.rpc_url(),
            waku_fleet: config.waku_fleet(),
            is_testnet: config.is_testnet(),
        });
    }

    // 2. Загружаем конфигурацию
    let config = if let Some(net) = &network {
        config_for_network(net)?
    } else {
        load_config()
    };

    let response = StartBackendResponse {
        port: 0,
        auth_port: 0,
        data_dir: String::new(),
        network_name: config.network_name(),
        chain_id: config.chain_id(),
        rpc_url: config.rpc_url(),
        waku_fleet: config.waku_fleet(),
        is_testnet: config.is_testnet(),
    };

    // 3. Формируем dataDir
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::io(e.to_string()))?;
    let data_dir = app_data_dir.join(config.data_dir_suffix());
    std::fs::create_dir_all(&data_dir).map_err(|e| AppError::io(e.to_string()))?;
    let data_dir_str = data_dir.to_string_lossy().to_string();

    // 4. Убиваем "зомби"
    kill_stale_backend(&data_dir);

    // 5. Ищем свободный порт
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| AppError::internal(format!("failed to find free port: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::internal(format!("failed to get local addr: {e}")))?
        .port();
    drop(listener);

    // 6. Аргументы для status-backend
    let args = vec!["-address".to_string(), format!("127.0.0.1:{port}")];

    // 7. Запускаем sidecar.
    //
    // В dev libsds.so лежит в target/debug/binaries/, поэтому нужен
    // LD_LIBRARY_PATH=./binaries (относительно cwd = target/debug/).
    // В release/AppImage libsds.so лежит рядом со status-backend (usr/bin/),
    // и работает RPATH=$ORIGIN, который Tauri ставит при сборке.
    // LD_LIBRARY_PATH в release НЕ выставляем, иначе он перекрывает RPATH
    // и указывает на usr/lib/stauri-app/, где libsds.so нет.
    let sidecar = app
        .shell()
        .sidecar("status-backend")
        .map_err(|e| AppError::backend(format!("failed to create sidecar command: {e}")))?
        .args(&args);

    let sidecar_command = if cfg!(debug_assertions) {
        sidecar.env("LD_LIBRARY_PATH", "./binaries")
    } else {
        sidecar
    };

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| AppError::backend(format!("failed to spawn sidecar: {e}")))?;

    // 7a. Поднимаем аутентифицирующий прокси.
    //
    // status-backend не проверяет, кто к нему подключился, и слушает
    // 127.0.0.1, доступный всем локальным процессам. Прокси требует
    // секретный заголовок и пропускает только наш фронтенд.
    let auth_port = {
        let auth_state = app.state::<auth_proxy::AuthProxyState>();
        auth_proxy::start(&auth_state, port).await?
    };

    // 8. Записываем PID
    let pid = child.pid();
    let pid_file = data_dir.join("status-backend.pid");
    if let Err(e) = std::fs::write(&pid_file, pid.to_string()) {
        warn!(pid_file = %pid_file.display(), error = %e, "не удалось записать PID-файл");
    }

    info!(
        port,
        auth_port,
        data_dir = %data_dir_str,
        network = config.network_name(),
        chain_id = config.chain_id(),
        "backend started"
    );

    // 9. Сохраняем процесс, порт и dataDir
    {
        let mut child_lock = state.child.lock().map_err(|_| AppError::poisoned())?;
        *child_lock = Some(child);
        let mut port_lock = state.port.lock().map_err(|_| AppError::poisoned())?;
        *port_lock = Some(port);
        let mut data_dir_lock = state.data_dir.lock().map_err(|_| AppError::poisoned())?;
        *data_dir_lock = Some(data_dir.clone());
    }

    // 10. Читаем логи в фоне
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    log_backend_line(&line, tracing::Level::DEBUG);
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    // status-backend пишет в stderr и обычный прогресс, поэтому
                    // уровень не WARN: иначе релизный лог превратится в шум.
                    log_backend_line(&line, tracing::Level::INFO);
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    warn!(
                        code = payload.code,
                        signal = payload.signal,
                        "status-backend terminated"
                    );
                    let state = app_handle.state::<BackendState>();
                    if let Ok(mut port_lock) = state.port.lock() {
                        *port_lock = None;
                    }
                    if let Ok(mut child_lock) = state.child.lock() {
                        *child_lock = None;
                    }
                }
                _ => {}
            }
        }
    });

    Ok(StartBackendResponse {
        port,
        auth_port,
        data_dir: data_dir_str,
        ..response
    })
}

/// Останавливает sidecar и удаляет PID-файл.
pub fn stop(app: tauri::AppHandle) -> AppResult<String> {
    let state = app.state::<BackendState>();
    let mut child_lock = state.child.lock().map_err(|_| AppError::poisoned())?;
    let child_res = if let Some(child) = child_lock.take() {
        child
            .kill()
            .map_err(|e| AppError::backend(format!("failed to kill sidecar: {e}")))
    } else {
        Ok(())
    };

    let mut port_lock = state.port.lock().map_err(|_| AppError::poisoned())?;
    *port_lock = None;
    drop(port_lock);
    drop(child_lock);

    // Удаляем PID-файл, используя сохраненный dataDir
    let data_dir_lock = state.data_dir.lock().map_err(|_| AppError::poisoned())?;
    if let Some(data_dir) = data_dir_lock.as_ref() {
        let pid_file = data_dir.join("status-backend.pid");
        let _ = std::fs::remove_file(&pid_file);
    }

    child_res.map(|_| "Backend stopped".to_string())
}

/// Останавливает sidecar при выходе из приложения. Ошибки игнорируются.
pub fn shutdown(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<BackendState>();
    if let Ok(mut child_lock) = state.child.lock()
        && let Some(child) = child_lock.take()
    {
        let _ = child.kill();
        info!("status-backend killed on exit");
    }
    if let Ok(data_dir_lock) = state.data_dir.lock()
        && let Some(data_dir) = data_dir_lock.as_ref()
    {
        let _ = std::fs::remove_file(data_dir.join("status-backend.pid"));
    }
}

/// Пишет строку вывода `status-backend` в общий лог.
///
/// Поток читается построчно, поэтому `\n` на конце отбрасывается — иначе
/// каждая запись лога получала бы пустую строку в хвосте.
fn log_backend_line(bytes: &[u8], level: tracing::Level) {
    let text = String::from_utf8_lossy(bytes);
    let line = text.trim_end_matches(['\r', '\n']);
    if line.is_empty() {
        return;
    }
    match level {
        tracing::Level::DEBUG => debug!(target: "status_backend", "{line}"),
        tracing::Level::INFO => info!(target: "status_backend", "{line}"),
        tracing::Level::WARN => warn!(target: "status_backend", "{line}"),
        _ => info!(target: "status_backend", "{line}"),
    }
}
