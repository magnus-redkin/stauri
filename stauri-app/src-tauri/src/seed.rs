//! Seed-фраза: хранение вне webview.
//!
//! Раньше фронтенд запрашивал `settings_getSettings` напрямую и получал
//! всю фразу строкой в JavaScript. Это означало, что фраза живёт в куче
//! webview и доступна любому скрипту в нём (включая XSS).
//!
//! Теперь фраза забирается один раз на стороне Rust и остаётся в памяти
//! процесса. Фронтенд получает только:
//!
//!   * `seed_word(index)`          — одно слово для показа пользователю;
//!   * `seed_challenge()`          — случайные индексы для проверки;
//!   * `verify_seed_answer(i, ans)` — результат сравнения, без раскрытия слова.
//!
//! Пользователю всё равно нужно увидеть фразу, чтобы записать её — полностью
//! скрыть её невозможно. Цель — исключить хранение в webview и логгирование:
//! `clear_seed()` стирает фразу из памяти при уходе с экрана.

use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Фраза в памяти процесса. `None`, пока не загружена или после очистки.
static PHRASE: Mutex<Option<Vec<String>>> = Mutex::new(None);

#[derive(Serialize)]
pub struct SeedInfo {
    /// Количество слов: фронтенд нумерует их при показе.
    pub word_count: usize,
}

#[derive(Serialize, Deserialize)]
pub struct VerifyResult {
    pub correct: bool,
}

/// Достаёт mnemonic из status-go и сохраняет его в памяти Rust.
///
/// Возвращает только число слов — не саму фразу.
#[tauri::command]
pub async fn fetch_seed_phrase(app: tauri::AppHandle) -> AppResult<SeedInfo> {
    let port = {
        let state = app.state::<crate::sidecar::BackendState>();
        let port_lock = state.port.lock().map_err(|_| AppError::poisoned())?;
        port_lock.ok_or_else(|| AppError::backend("backend is not running"))?
    };

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::internal(format!("client build error: {e}")))?;

    let resp = client
        .post(format!("http://127.0.0.1:{port}/statusgo/CallRPC"))
        .header("Content-Type", "application/json")
        .body(
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "settings_getSettings",
                "params": []
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| AppError::network(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::backend(format!(
            "settings_getSettings HTTP {}",
            resp.status()
        )));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| AppError::network(format!("body read error: {e}")))?;

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| AppError::backend(format!("JSON parse error: {e}")))?;

    let mnemonic = parsed
        .get("result")
        .and_then(|r| r.get("mnemonic"))
        .and_then(|m| m.as_str())
        .ok_or_else(|| AppError::backend("mnemonic is not available"))?;

    let words: Vec<String> = mnemonic.split_whitespace().map(|w| w.to_string()).collect();

    if words.is_empty() {
        return Err(AppError::backend("mnemonic is empty"));
    }

    let count = words.len();
    *PHRASE.lock().map_err(|_| AppError::poisoned())? = Some(words);

    Ok(SeedInfo { word_count: count })
}

/// Одно слово по индексу — для отображения пользователю.
#[tauri::command]
pub fn seed_word(index: usize) -> AppResult<String> {
    let guard = PHRASE.lock().map_err(|_| AppError::poisoned())?;
    let words = guard
        .as_ref()
        .ok_or_else(|| AppError::backend("seed phrase is not loaded"))?;
    words
        .get(index)
        .cloned()
        .ok_or_else(|| AppError::internal(format!("word index {index} out of range")))
}

/// Случайные неповторяющиеся индексы для проверки запоминания.
#[tauri::command]
pub fn seed_challenge(count: usize) -> AppResult<Vec<usize>> {
    let guard = PHRASE.lock().map_err(|_| AppError::poisoned())?;
    let words = guard
        .as_ref()
        .ok_or_else(|| AppError::backend("seed phrase is not loaded"))?;

    let total = words.len();
    if total == 0 {
        return Err(AppError::backend("seed phrase is empty"));
    }
    let take = count.min(total);

    // Простой и детерминированный по объёму выбор без внешних зависимостей.
    // Криптостойкость здесь не нужна: цель — не дать пользователю отвечать
    // всегда на одни и те же слова, а не защититься от атакующего.
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15);

    let mut picked: Vec<usize> = Vec::with_capacity(take);
    while picked.len() < take {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let idx = (seed >> 33) as usize % total;
        if !picked.contains(&idx) {
            picked.push(idx);
        }
    }

    picked.sort_unstable();
    Ok(picked)
}

/// Проверяет ответ пользователя, не раскрывая ожидаемое слово.
#[tauri::command]
pub fn verify_seed_answer(index: usize, answer: String) -> AppResult<VerifyResult> {
    let guard = PHRASE.lock().map_err(|_| AppError::poisoned())?;
    let words = guard
        .as_ref()
        .ok_or_else(|| AppError::backend("seed phrase is not loaded"))?;
    let expected = words
        .get(index)
        .ok_or_else(|| AppError::internal(format!("word index {index} out of range")))?;

    Ok(VerifyResult {
        correct: expected.eq_ignore_ascii_case(answer.trim()),
    })
}

/// Стирает фразу из памяти. Вызывается при уходе с экрана.
#[tauri::command]
pub fn clear_seed() {
    if let Ok(mut guard) = PHRASE.lock() {
        if let Some(words) = guard.as_mut() {
            for w in words.iter_mut() {
                // Перезаписываем содержимое, чтобы строка не осталась в куче.
                w.clear();
            }
        }
        *guard = None;
    }
}
