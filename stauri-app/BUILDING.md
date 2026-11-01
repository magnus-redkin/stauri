# Сборка Stauri

Документ описывает воспроизводимую сборку `status-backend` и Stauri.

## Пререквизиты

- **Nix** (flakes enabled). Рекомендуется Determinate Nix.
- **Rust** ≥ 1.85 (edition 2024).
- **Node.js** ≥ 20 + **pnpm**.
- **Системные пакеты Tauri на Linux**:
  `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.

## 1. Сборка `status-backend` в Nix

Клонируй `status-go` и переключись на протестированный коммит:

```bash
git clone https://github.com/status-im/status-go.git ~/ETH/github.status-go
cd ~/ETH/github.status-go
git checkout 766535cf3   # протестированный коммит
```
Войди в Nix shell:
```bash
nix develop --extra-experimental-features 'nix-command flakes'
```
ВАЖНО: перед сборкой убедись, что в окружении нет «протечек» из твоих локальных экспериментов (vosk, whisper, portaudio, onnxruntime). Они подмешивают системные библиотеки (например, libmp3lame) и ломают Nix-сборку.
```bash
unset CGO_LDFLAGS CGO_CFLAGS LD_LIBRARY_PATH LIBRARY_PATH
```
Собери status-backend:
```bash
make status-backend
```
Готовый бинарник: build/bin/status-backend.

## 2. Найти libsds.so из того же Nix-окружения

libsds.so лежит в Nix store. Возьми ту же, что использовалась при линковке status-backend. В логе сборки была строка -L/nix/store/<hash>-nim-sds-.../lib -lsds. Найди её:
```bash
find /nix/store -name "libsds.so" 2>/dev/null
```
Если в store несколько версий (например, три), выбери ту, что соответствует nim-sds, с которой собран status-backend. Точный путь виден в логе make status-backend (строка -L/nix/store/.../lib -lsds).

## 3. Скопировать артефакты в Stauri
```bash
TRIPLE=x86_64-unknown-linux-gnu

cp ~/ETH/github.status-go/build/bin/status-backend \
   ~/ETH/stauri/stauri-app/src-tauri/binaries/status-backend-$TRIPLE

cp /nix/store/<hash>-nim-sds-.../lib/libsds.so \
   ~/ETH/stauri/stauri-app/src-tauri/binaries/libsds.so
```
## 4. Проверка
```bash
cd ~/ETH/stauri/stauri-app/src-tauri
LD_LIBRARY_PATH=./binaries ./binaries/status-backend-$TRIPLE --help
```
Должен вывести Usage of ...status-backend (а не segmentation fault).

## 5. Запуск Stauri
```bash
cd ~/ETH/stauri/stauri-app
pnpm install
pnpm tauri dev
```
## 6. Сборка AppImage
```bash
cd ~/ETH/stauri/stauri-app
./scripts/release.sh 0.2.0
```
release.sh собирает AppImage нативно (Ubuntu 24.04+), копирует libsds.so рядом с status-backend в AppDir/usr/bin/, использует RPATH=$ORIGIN и запускает linuxdeploy с обходом ldd segfault.

## Почему Nix

status-backend и libsds.so должны быть собраны в одном окружении (одна glibc, один ABI). Nix гарантирует это. Если собрать status-backend системным Go, а libsds.so взять из Nix store (или наоборот), получишь SIGSEGV при запуске — status-backend загрузится, но упадёт при инициализации libsds.so.
Известные проблемы

- CGO_LDFLAGS/CGO_CFLAGS из локальных экспериментов (vosk, whisper, portaudio) подмешивают системные библиотеки. Всегда unset их перед make status-backend в Nix shell.
- patchelf assertion splitIndex != -1 на некоторых бинарниках. Если patchelf --set-rpath падает, используйте --remove-rpath + --set-rpath, или не патчите RPATH (положите libsds.so рядом с бинарником, RPATH=$ORIGIN сработает).
- ldd segfault на status-backend — linuxdeploy падает при анализе. Обход: обёртка /tmp/bin/ldd, которая для status-backend отвечает statically linked.

## Проверка сборки (CI)

Для CI повтори шаги 1–4 в Nix shell. release.sh можно расширить, добавив опциональный шаг сборки status-backend через nix develop --command make status-backend, если бинарник нужно пересобрать.
