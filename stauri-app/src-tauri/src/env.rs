//! Загрузка `.env`.
//!
//! Путь `../.env` работает только когда cwd = src-tauri/, то есть в
//! `pnpm tauri dev`. В release cwd — это каталог, откуда пользователь запустил
//! приложение, а у AppImage он произвольный, поэтому ключи нужно искать по
//! абсолютным путям, а не относительно cwd.
//!
//! dotenv не перезаписывает уже заданные переменные окружения, поэтому
//! значение из шелла по-прежнему имеет приоритет над файлом.

use std::path::PathBuf;

pub const APP_IDENTIFIER: &str = "com.magnus.stauri-app";

/// Загружает `.env` из первого найденного места.
///
/// Возвращает `true`, если файл найден и прочитан. Возвращаем признак, а не
/// пишем предупреждение здесь же: функцию зовут до инициализации логирования
/// (иначе `RUST_LOG` из `.env` не увидит `EnvFilter`), и предупреждение из
/// неё ушло бы в никуда. Печатает вызывающий, уже с подписчиком.
pub fn load_env() -> bool {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Пользовательский конфиг: ~/.config/com.magnus.stauri-app/.env
    if let Some(dir) = dirs::config_dir() {
        candidates.push(dir.join(APP_IDENTIFIER).join(".env"));
    }

    // 2. Рядом с исполняемым файлом (для AppImage — usr/bin/).
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(dir.join(".env"));
    }

    // 3. Каталог сборки — только для debug, чтобы release не тянул
    //    путь машины разработчика.
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../.env"
        )));
    }

    // 4. Историческое поведение: cwd = src-tauri/.
    candidates.push(PathBuf::from("../.env"));

    candidates
        .iter()
        .any(|path| path.is_file() && dotenv::from_path(path).is_ok())
}
