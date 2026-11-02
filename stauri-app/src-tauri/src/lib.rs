//! Stauri — точка входа Tauri-приложения.
//!
//! Здесь только сборка приложения и регистрация обработчиков. Вся логика
//! разнесена по модулям:
//!
//! * [`config`] — определение и загрузка сетевой конфигурации;
//! * [`env`] — поиск и загрузка `.env`;
//! * [`sidecar`] — запуск и остановка `status-backend`;
//! * [`commands`] — команды, доступные фронтенду;
//! * [`rpc_proxy`] — форвардер RPC-провайдеров;
//! * [`auth_proxy`] — аутентифицирующий прокси к бэкенду;
//! * [`seed`] — работа с seed-фразой вне webview;
//! * [`market`] — данные CoinGecko;
//! * [`logging`] — логирование в файл и stderr с вычищением секретов;
//! * [`updater`] — проверка и установка обновлений;
//! * [`error`] — типизированные ошибки команд.

use tauri::Manager;

mod auth_proxy;
mod commands;
mod config;
mod env;
mod error;
mod logging;
mod market;
mod rpc_proxy;
mod seed;
mod sidecar;
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Порядок важен. `.env` грузим первым: в нём может лежать `RUST_LOG`,
    // а `EnvFilter` читается при создании подписчика. Предупреждение об
    // отсутствии файла печатаем уже после `logging::init` — иначе оно
    // уходит в никуда.
    let env_found = env::load_env();
    logging::init();
    if !env_found {
        tracing::warn!("no .env found; using environment variables only");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        // Плагин обновлений регистрируется ради конфигурации (endpoints +
        // pubkey из tauri.conf.json). Его команды фронтенду недоступны:
        // permission не выдан в capabilities, фронтенд ходит через
        // commands::check_for_update / install_update.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(sidecar::BackendState::default())
        .manage(rpc_proxy::RpcProxyState::default())
        .manage(auth_proxy::AuthProxyState::default())
        .invoke_handler(tauri::generate_handler![
            commands::start_backend,
            commands::stop_backend,
            commands::start_rpc_proxy,
            commands::set_rpc_upstreams,
            commands::stop_rpc_proxy,
            commands::auth_proxy_token,
            commands::check_for_update,
            commands::install_update,
            commands::restart_app,
            market::fetch_market_data,
            seed::fetch_seed_phrase,
            seed::seed_word,
            seed::seed_challenge,
            seed::verify_seed_answer,
            seed::clear_seed
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let auth_state = app_handle.state::<auth_proxy::AuthProxyState>();
                auth_proxy::stop(&auth_state);

                let proxy_state = app_handle.state::<rpc_proxy::RpcProxyState>();
                rpc_proxy::stop(&proxy_state);

                sidecar::shutdown(app_handle);

                // Последним: дописывает то, что ещё лежит в очереди лога.
                logging::shutdown();
            }
        });
}
