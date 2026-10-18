use tauri::Manager;
use tauri_plugin_shell::{ShellExt, process::CommandChild};
use std::sync::Mutex;
use std::net::TcpListener;
use serde_json::json;
use tauri::{WebviewUrl, WebviewWindowBuilder};

// Структура для хранения процесса и выделенного порта
struct BackendState {
    child: Mutex<Option<CommandChild>>,
    port: Mutex<Option<u16>>,
}

#[tauri::command]
async fn start_backend(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<BackendState>();

    // 1. Проверяем, не запущен ли уже процесс
    {
        let child_lock = state.child.lock().unwrap();
        if child_lock.is_some() {
            let port_lock = state.port.lock().unwrap();
            let port = port_lock.unwrap_or(0);

            // Получаем путь к данным и для уже запущенного процесса
            let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let data_dir_str = app_data_dir.to_string_lossy().to_string();

            return Ok(json!({ "port": port, "dataDir": data_dir_str }));
        }
    }

    // 2. Ищем свободный порт
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to find free port: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();
    drop(listener);

    // 3. Получаем путь к директории данных (создастся автоматически при первом обращении)
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let data_dir_str = app_data_dir.to_string_lossy().to_string();

    // 4. Запускаем sidecar
    let sidecar_command = app.shell()
        .sidecar("status-backend")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["--address", &format!("127.0.0.1:{}", port)]);

    let (mut rx, child) = sidecar_command.spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // 5. Сохраняем процесс и порт
    {
        let mut child_lock = state.child.lock().unwrap();
        *child_lock = Some(child);
        let mut port_lock = state.port.lock().unwrap();
        *port_lock = Some(port);
    }

    // 6. Читаем логи в фоне
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

    Ok(json!({ "port": port, "dataDir": data_dir_str }))
}


#[tauri::command]
fn stop_backend(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<BackendState>();

    // Сначала убиваем процесс
    let mut child_lock = state.child.lock().unwrap();
    let child_res = if let Some(child) = child_lock.take() {
        child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))
    } else {
        Ok(())
    };

    // Очищаем порт
    let mut port_lock = state.port.lock().unwrap();
    *port_lock = None;
    drop(port_lock); // явно отпускаем блокировку
    drop(child_lock);

    child_res.map(|_| "Backend stopped".to_string())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn open_dapp_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
  // Проверяем, что URL начинается с http:// или https://
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        .manage(BackendState {
            child: Mutex::new(None),
            port: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![greet, start_backend, stop_backend])
        .invoke_handler(tauri::generate_handler![ greet, start_backend, stop_backend, open_dapp_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
