use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{ShellExt, process::CommandChild};
use std::sync::Mutex;
use std::net::TcpListener;
use serde::{Serialize, Deserialize};
use std::path::PathBuf;

#[derive(Serialize)]
struct StartBackendResponse {
  port: u16,
  #[serde(rename = "dataDir")]
  data_dir: String,
  #[serde(rename = "networkName")]
  network_name: String,
  #[serde(rename = "chainId")]
  chain_id: u64,
  #[serde(rename = "rpcUrl")]
  rpc_url: String,
  #[serde(rename = "wakuFleet")]
  waku_fleet: String,
  #[serde(rename = "isTestnet")]
  is_testnet: bool,
}

#[derive(Deserialize, Default)]
struct AppConfig {
    ethereum: Option<EthereumConfig>,
    waku: Option<WakuConfig>,
}

#[derive(Deserialize, Default)]
struct EthereumConfig {
    preset: Option<String>,
    #[serde(default = "default_chain_id")]
    chain_id: u64,
    rpc_url: Option<String>,
}

#[derive(Deserialize, Default)]
struct WakuConfig {
    fleet: Option<String>,
}

fn default_chain_id() -> u64 {
    1
}

impl AppConfig {
    fn network_name(&self) -> String {
        self.ethereum
            .as_ref()
            .and_then(|e| e.preset.clone())
            .unwrap_or_else(|| "mainnet".to_string())
    }

    fn chain_id(&self) -> u64 {
        self.ethereum
            .as_ref()
            .map(|e| e.chain_id)
            .unwrap_or(1)
    }

    fn rpc_url(&self) -> String {
        self.ethereum
            .as_ref()
            .and_then(|e| e.rpc_url.clone())
            .unwrap_or_else(|| default_rpc_url(&self.network_name()))
    }

    fn waku_fleet(&self) -> String {
        self.waku
            .as_ref()
            .and_then(|w| w.fleet.clone())
            .unwrap_or_else(|| "status.prod".to_string())
    }

    fn is_testnet(&self) -> bool {
        self.network_name() != "mainnet"
    }

    fn data_dir_suffix(&self) -> PathBuf {
        let network = self.network_name();
        if network == "mainnet" {
            PathBuf::new()
        } else {
            PathBuf::from(&network)
        }
    }
}

fn default_rpc_url(network: &str) -> String {
    match network {
        "sepolia" => "https://rpc.sepolia.org".to_string(),
        "holesky" => "https://ethereum-holesky-rpc.publicnode.com".to_string(),
        _ => "https://ethereum-rpc.publicnode.com".to_string(),
    }
}

fn load_config() -> AppConfig {
    // 1. Проверяем STAURI_NETWORK shorthand
    if let Ok(network) = std::env::var("STAURI_NETWORK") {
        let chain_id = match network.as_str() {
            "sepolia" => 11155111,
            "holesky" => 17000,
            "mainnet" => 1,
            _ => 1,
        };

        let fleet = if network == "mainnet" {
            "status.prod".to_string()
        } else {
            "status.test".to_string()
        };

        return AppConfig {
            ethereum: Some(EthereumConfig {
                preset: Some(network),
                chain_id,
                rpc_url: None,
            }),
            waku: Some(WakuConfig {
                fleet: Some(fleet),
            }),
        };
    }

    // 2. Проверяем STAURI_CONFIG_PATH
    if let Ok(path) = std::env::var("STAURI_CONFIG_PATH") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }

    // 3. Проверяем ~/.config/stauri/config.json
    if let Some(config_dir) = dirs::config_dir() {
        let config_path = config_dir.join("stauri").join("config.json");
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }

    // 4. Дефолт (Mainnet)
    AppConfig::default()
}

// Вспомогательная функция для создания конфига по имени сети
fn config_for_network(network: &str) -> AppConfig {
    let chain_id = match network {
        "sepolia" => 11155111,
        "holesky" => 17000,
        _ => 1,
    };
    let fleet = if network == "mainnet" {
        "status.prod".to_string()
    } else {
        "status.test".to_string()
    };
    AppConfig {
        ethereum: Some(EthereumConfig {
            preset: Some(network.to_string()),
            chain_id,
            rpc_url: None,
        }),
        waku: Some(WakuConfig {
            fleet: Some(fleet),
        }),
    }
}

struct BackendState {
    child: Mutex<Option<CommandChild>>,
    port: Mutex<Option<u16>>,
    data_dir: Mutex<Option<PathBuf>>, // <-- Сохраняем dataDir для stop_backend
}

fn kill_stale_backend(dir: &std::path::Path) {
    let pid_file = dir.join("status-backend.pid");
    if let Ok(s) = std::fs::read_to_string(&pid_file) {
        if let Ok(pid) = s.trim().parse::<u32>() {
            #[cfg(target_os = "linux")]
            {
                if std::fs::read_to_string(format!("/proc/{}/comm", pid))
                    .map(|c| c.trim() == "status-backend")
                    .unwrap_or(false)
                {
                    let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
                }
            }
        }
        let _ = std::fs::remove_file(&pid_file);
    }
}

#[tauri::command]
async fn start_backend(app: tauri::AppHandle, network: Option<String>) -> Result<StartBackendResponse, String> {
    let state = app.state::<BackendState>();

    // 1. Проверяем, не запущен ли уже процесс
    {
        let child_lock = state.child.lock().map_err(|_| "Mutex poisoned")?;
        if child_lock.is_some() {
            let port_lock = state.port.lock().map_err(|_| "Mutex poisoned")?;
            let port = port_lock.unwrap_or(0);

            let data_dir_lock = state.data_dir.lock().map_err(|_| "Mutex poisoned")?;
            let data_dir_str = data_dir_lock.as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            // Определяем конфиг для ответа (если network передан, используем его)
            let config = if let Some(net) = &network {
                config_for_network(net)
            } else {
                load_config()
            };

            return Ok(StartBackendResponse {
                port,
                data_dir: data_dir_str,
                network_name: config.network_name(),
                chain_id: config.chain_id(),
                rpc_url: config.rpc_url(),
                waku_fleet: config.waku_fleet(),
                is_testnet: config.is_testnet(),
            });
        }
    }

    // 2. Загружаем конфигурацию (если network передан — используем его)
    let config = if let Some(net) = &network {
        config_for_network(net)
    } else {
        load_config()
    };

    let network_name = config.network_name();
    let chain_id = config.chain_id();
    let rpc_url = config.rpc_url();
    let waku_fleet = config.waku_fleet();
    let is_testnet = config.is_testnet();

    // 3. Формируем dataDir
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let data_dir = app_data_dir.join(config.data_dir_suffix());
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let data_dir_str = data_dir.to_string_lossy().to_string();

    // 4. Убиваем "зомби"
    kill_stale_backend(&data_dir);

    // 5. Ищем свободный порт
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to find free port: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();
    drop(listener);

    // 6. Формируем аргументы для status-backend
    let args = vec![
        "-address".to_string(),
        format!("127.0.0.1:{}", port),
    ];

    // 7. Запускаем sidecar
    let sidecar_command = app.shell()
        .sidecar("status-backend")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(&args);

    let (mut rx, child) = sidecar_command.spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // 8. Записываем PID
    let pid = child.pid();
    let pid_file = data_dir.join("status-backend.pid");
    if let Err(e) = std::fs::write(&pid_file, pid.to_string()) {
        eprintln!("Warning: failed to write PID file: {}", e);
    }

    // 9. Сохраняем процесс, порт и dataDir
    {
        let mut child_lock = state.child.lock().map_err(|_| "Mutex poisoned")?;
        *child_lock = Some(child);
        let mut port_lock = state.port.lock().map_err(|_| "Mutex poisoned")?;
        *port_lock = Some(port);
        let mut data_dir_lock = state.data_dir.lock().map_err(|_| "Mutex poisoned")?;
        *data_dir_lock = Some(data_dir.clone());
    }

    // 10. Читаем логи в фоне
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    println!("[status-backend stdout] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    println!("[status-backend stderr] {}", String::from_utf8_lossy(&line));
                }
                _ => {}
            }
        }
    });

    Ok(StartBackendResponse {
        port,
        data_dir: data_dir_str,
        network_name,
        chain_id,
        rpc_url,
        waku_fleet,
        is_testnet,
    })
}

#[tauri::command]
fn stop_backend(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<BackendState>();
    let mut child_lock = state.child.lock().map_err(|_| "Mutex poisoned")?;
    let child_res = if let Some(child) = child_lock.take() {
        child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))
    } else {
        Ok(())
    };

    let mut port_lock = state.port.lock().map_err(|_| "Mutex poisoned")?;
    *port_lock = None;
    drop(port_lock);
    drop(child_lock);

    // Удаляем PID-файл, используя сохраненный dataDir
    let data_dir_lock = state.data_dir.lock().map_err(|_| "Mutex poisoned")?;
    if let Some(data_dir) = data_dir_lock.as_ref() {
        let pid_file = data_dir.join("status-backend.pid");
        let _ = std::fs::remove_file(&pid_file);
    }

    child_res.map(|_| "Backend stopped".to_string())
}

#[tauri::command]
async fn open_dapp_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }

    let window_label = format!("dapp-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

    WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::External(url.parse().map_err(|e| format!("Invalid URL: {}", e))?))
        .title("dApp Browser")
        .inner_size(1024.0, 768.0)
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        .manage(BackendState {
            child: Mutex::new(None),
            port: Mutex::new(None),
            data_dir: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![greet, start_backend, stop_backend, open_dapp_window])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<BackendState>();
                let mut child_lock = state.child.lock().unwrap();
                if let Some(child) = child_lock.take() {
                    let _ = child.kill();
                    println!("[status-backend] Killed on exit");
                }
                let data_dir_lock = state.data_dir.lock().unwrap();
                if let Some(data_dir) = data_dir_lock.as_ref() {
                    let _ = std::fs::remove_file(data_dir.join("status-backend.pid"));
                }
            }
        });
}

// =========================================================================
// UNIT TESTS
// =========================================================================
#[cfg(test)]
mod tests {
    use super::*; // Импортирует ВСЁ из lib.rs, включая приватные функции и структуры
    use std::path::PathBuf;

    // --- Тесты для default_rpc_url ---
    #[test]
    fn test_default_rpc_url_sepolia() {
        assert_eq!(default_rpc_url("sepolia"), "https://rpc.sepolia.org");
    }

    #[test]
    fn test_default_rpc_url_holesky() {
        assert_eq!(default_rpc_url("holesky"), "https://ethereum-holesky-rpc.publicnode.com");
    }

    #[test]
    fn test_default_rpc_url_fallback() {
        assert_eq!(default_rpc_url("mainnet"), "https://ethereum-rpc.publicnode.com");
        assert_eq!(default_rpc_url("unknown_network"), "https://ethereum-rpc.publicnode.com");
    }

    // --- Тесты для config_for_network ---
    #[test]
    fn test_config_for_network_sepolia() {
        let config = config_for_network("sepolia");
        assert_eq!(config.network_name(), "sepolia");
        assert_eq!(config.chain_id(), 11155111);
        assert_eq!(config.waku_fleet(), "status.test");
        assert!(config.is_testnet());
    }

    #[test]
    fn test_config_for_network_mainnet() {
        let config = config_for_network("mainnet");
        assert_eq!(config.network_name(), "mainnet");
        assert_eq!(config.chain_id(), 1);
        assert_eq!(config.waku_fleet(), "status.prod");
        assert!(!config.is_testnet());
    }

    // --- Тесты для методов AppConfig ---
    #[test]
    fn test_app_config_defaults() {
        let config = AppConfig::default();
        assert_eq!(config.network_name(), "mainnet");
        assert_eq!(config.chain_id(), 1);
        assert_eq!(config.rpc_url(), "https://ethereum-rpc.publicnode.com");
        assert_eq!(config.waku_fleet(), "status.prod");
        assert!(!config.is_testnet());
        assert_eq!(config.data_dir_suffix(), PathBuf::new());
    }

    #[test]
    fn test_app_config_custom() {
        let config = AppConfig {
            ethereum: Some(EthereumConfig {
                preset: Some("sepolia".to_string()),
                chain_id: 11155111,
                rpc_url: Some("https://custom.rpc".to_string()),
            }),
            waku: Some(WakuConfig {
                fleet: Some("custom.fleet".to_string()),
            }),
        };
        assert_eq!(config.network_name(), "sepolia");
        assert_eq!(config.chain_id(), 11155111);
        assert_eq!(config.rpc_url(), "https://custom.rpc");
        assert_eq!(config.waku_fleet(), "custom.fleet");
        assert!(config.is_testnet());
        assert_eq!(config.data_dir_suffix(), PathBuf::from("sepolia"));
    }

    // --- Тесты для load_config (с переменными окружения) ---
    #[test]
    fn test_load_config_from_env_shorthand() {
        // В новых версиях Rust работа с переменными окружения требует unsafe блока
        unsafe {
            std::env::set_var("STAURI_NETWORK", "sepolia");
            std::env::remove_var("STAURI_CONFIG_PATH");
        }

        let config = load_config();
        assert_eq!(config.network_name(), "sepolia");
        assert_eq!(config.chain_id(), 11155111);

        // Очистка после теста
        unsafe {
            std::env::remove_var("STAURI_NETWORK");
        }
    }

    #[test]
    fn test_load_config_default() {
        unsafe {
            std::env::remove_var("STAURI_NETWORK");
            std::env::remove_var("STAURI_CONFIG_PATH");
        }

        let config = load_config();
        assert_eq!(config.network_name(), "mainnet");
        assert_eq!(config.chain_id(), 1);
    }
}
