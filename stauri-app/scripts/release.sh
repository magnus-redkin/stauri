#!/usr/bin/env bash
# release.sh — сборка AppImage для Stauri (нативно, Ubuntu 24.04+).
#
# Использование (из stauri-app/):
#   ./scripts/release.sh 0.2.0
#
# Предполагается, что src-tauri/binaries/status-backend-x86_64-unknown-linux-gnu
# и src-tauri/binaries/libsds.so уже собраны в Nix (см. docs/BUILDING.md).
# Скрипт только собирает фронтенд, Rust-бинарник, AppDir и AppImage.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$ ]]; then
  echo "ERROR: version must be semver (e.g. 0.2.0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Stauri release $VERSION ==="
echo "Root: $ROOT"

# ---------- 1. Проверка зависимостей ----------
echo
echo "[1/6] Checking dependencies"

for cmd in pnpm patchelf wget node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd not found." >&2
    exit 1
  fi
done

if [[ ! -f "$ROOT/src-tauri/binaries/libsds.so" ]]; then
  echo "ERROR: src-tauri/binaries/libsds.so not found." >&2
  echo "       Соберите status-backend и libsds.so в Nix (см. docs/BUILDING.md)." >&2
  exit 1
fi
if [[ ! -f "$ROOT/src-tauri/binaries/status-backend-x86_64-unknown-linux-gnu" ]]; then
  echo "ERROR: src-tauri/binaries/status-backend-x86_64-unknown-linux-gnu not found." >&2
  echo "       Соберите status-backend в Nix (см. docs/BUILDING.md)." >&2
  exit 1
fi

echo "  pnpm:     $(pnpm --version)"
echo "  patchelf: $(patchelf --version)"
echo "  libsds:   OK"
echo "  backend:  OK"

# COINGECKO_KEY не обязателен: публичный эндпоинт отдаёт данные без ключа,
# ключ только повышает лимит запросов. Если он есть в $ROOT/.env — попадёт
# в бандл на этапе Vite-сборки. .env в AppImage не кладётся: артефакт
# распространяется, и секреты из него получил бы любой скачавший.
echo "  COINGECKO_KEY: $(grep -q '^COINGECKO_KEY=' "$ROOT/.env" 2>/dev/null && echo 'present (optional)' || echo 'absent (optional, keyless mode)')"

# ---------- 2. Обновление версии ----------
echo
echo "[2/6] Bumping version to $VERSION"

node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('$ROOT/package.json', 'utf8'));
p.version = '$VERSION';
fs.writeFileSync('$ROOT/package.json', JSON.stringify(p, null, 2) + '\n');
"
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('$ROOT/src-tauri/tauri.conf.json', 'utf8'));
p.version = '$VERSION';
fs.writeFileSync('$ROOT/src-tauri/tauri.conf.json', JSON.stringify(p, null, 2) + '\n');
"
echo "  package.json -> $VERSION"
echo "  tauri.conf.json -> $VERSION"

# ---------- 3. Фронтенд ----------
echo
echo "[3/6] Building frontend"
pnpm install --frozen-lockfile
pnpm build

# ---------- 4. Rust-бинарник (без bundle) ----------
echo
echo "[4/6] Building Rust binary (no bundle)"

export NO_STRIP=1
pnpm tauri build --no-bundle

TAURI_BIN="$ROOT/src-tauri/target/release/tauri-app"
STATUS_BIN="$ROOT/src-tauri/binaries/status-backend-x86_64-unknown-linux-gnu"
LIBSDS="$ROOT/src-tauri/binaries/libsds.so"

for f in "$TAURI_BIN" "$STATUS_BIN" "$LIBSDS"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: $f not found" >&2
    exit 1
  fi
done

echo "  tauri-app:      OK"
echo "  status-backend: OK"
echo "  libsds.so:      OK"

# ---------- 5. Ручное создание AppDir ----------
echo
echo "[5/6] Creating AppDir manually"

APPDIR="$ROOT/src-tauri/target/release/bundle/appimage/stauri-app.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/lib"
mkdir -p "$APPDIR/usr/share/applications"
mkdir -p "$APPDIR/usr/share/icons/hicolor/128x128/apps"

# Бинарники
cp "$TAURI_BIN"   "$APPDIR/usr/bin/stauri-app"
cp "$STATUS_BIN"  "$APPDIR/usr/bin/status-backend"
cp "$LIBSDS"      "$APPDIR/usr/lib/libsds.so"

# ---------- Зачистка nix-зависимостей ----------
#
# status-backend и libsds.so собраны в Nix, поэтому у них:
#   * INTERP указывает на /nix/store/.../ld-linux-x86-64.so.2 — на машине без
#     этого стора execve вернёт ENOENT и AppImage не запустится вообще;
#   * RUNPATH содержит /nix/store/...glibc... — при старте грузится nix-овский
#     загрузчик (2.40), но системная libc.so.6 находится раньше по
#     LD_LIBRARY_PATH (унаследованному из шелла), и в одном процессе
#     оказываются две несовместимые glibc → SIGSEGV в конструкторах libsds.so.
#
# Поэтому: системный загрузчик + чистый $ORIGIN-RUNPATH.
SYSTEM_LOADER="/lib64/ld-linux-x86-64.so.2"
if [[ ! -e "$SYSTEM_LOADER" ]]; then
  echo "ERROR: $SYSTEM_LOADER not found" >&2
  exit 1
fi

echo "  INTERP before: $(patchelf --print-interpreter "$APPDIR/usr/bin/status-backend" 2>/dev/null || true)"
echo "  RUNPATH before: $(patchelf --print-rpath "$APPDIR/usr/bin/status-backend" 2>/dev/null || true)"

# status-backend: libsds.so лежит в usr/lib, бинарник — в usr/bin.
patchelf --set-interpreter "$SYSTEM_LOADER" "$APPDIR/usr/bin/status-backend"
patchelf --set-rpath '$ORIGIN/../lib'       "$APPDIR/usr/bin/status-backend"

# libsds.so: все её NEEDED — системные, но убираем nix-овскую glibc из RUNPATH.
patchelf --set-rpath '$ORIGIN'              "$APPDIR/usr/lib/libsds.so"

echo "  INTERP after:  $(patchelf --print-interpreter "$APPDIR/usr/bin/status-backend")"
echo "  RUNPATH after: $(patchelf --print-rpath "$APPDIR/usr/bin/status-backend")"
echo "  libsds RUNPATH after: $(patchelf --print-rpath "$APPDIR/usr/lib/libsds.so")"

# Проверяем, что nix не просочился в динамическую секцию.
for f in "$APPDIR/usr/bin/status-backend" "$APPDIR/usr/lib/libsds.so"; do
  if readelf -d "$f" | grep -q '/nix/store'; then
    echo "ERROR: /nix/store still present in dynamic section of $f" >&2
    readelf -d "$f" | grep '/nix/store' >&2
    exit 1
  fi
done
echo "  no /nix/store in dynamic section"

# .desktop
cat > "$APPDIR/usr/share/applications/stauri-app.desktop" << 'EOF'
[Desktop Entry]
Type=Application
Name=Stauri
Exec=stauri-app
Icon=stauri-app
Categories=Network;InstantMessaging;
Terminal=false
EOF

# Иконка
ICON="$ROOT/src-tauri/icons/128x128.png"
if [[ -f "$ICON" ]]; then
  cp "$ICON" "$APPDIR/usr/share/icons/hicolor/128x128/apps/stauri-app.png"
  cp "$ICON" "$APPDIR/stauri-app.png"
fi

# AppRun: LD_LIBRARY_PATH на usr/lib (где libsds.so) и запуск tauri-app.
#
# LD_LIBRARY_PATH сбрасывается, а не дополняется: унаследованное значение может
# содержать /usr/lib/x86_64-linux-gnu и тогда системная libc перекрывает ту,
# с которой согласованы бинарники.
cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"
unset LD_LIBRARY_PATH
export LD_LIBRARY_PATH="$HERE/usr/lib"
exec "$HERE/usr/bin/stauri-app" "$@"
EOF
chmod +x "$APPDIR/AppRun"

echo "  AppDir: $APPDIR"

# ---------- 6. linuxdeploy ----------
echo
echo "[6/6] Running linuxdeploy"

# Обход segfault ldd на status-backend больше не нужен: после патча интерпретатора
# бинарник линкуется системным загрузчиком и ldd отрабатывает штатно.
rm -f /tmp/bin/ldd

# Скачиваем linuxdeploy и плагин appimage (если нет)
if [[ ! -f /tmp/linuxdeploy-x86_64.AppImage ]]; then
  wget -q https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy-07333c6/linuxdeploy-x86_64.AppImage -O /tmp/linuxdeploy-x86_64.AppImage
  chmod +x /tmp/linuxdeploy-x86_64.AppImage
fi
if [[ ! -f /tmp/linuxdeploy-plugin-appimage-x86_64.AppImage ]]; then
  wget -q https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage -O /tmp/linuxdeploy-plugin-appimage-x86_64.AppImage
  chmod +x /tmp/linuxdeploy-plugin-appimage-x86_64.AppImage
fi

cp /tmp/linuxdeploy-plugin-appimage-x86_64.AppImage /tmp/bin/linuxdeploy-plugin-appimage
chmod +x /tmp/bin/linuxdeploy-plugin-appimage

cd "$(dirname "$APPDIR")"

PATH="/tmp/bin:$PATH" \
NO_STRIP=1 \
APPIMAGE_EXTRACT_AND_RUN=1 \
/tmp/linuxdeploy-x86_64.AppImage \
  --appdir "$(basename "$APPDIR")" \
  --output appimage

# ---------- 7. Проверка ----------
echo
echo "[7/7] Verifying AppImage"

APPIMAGE_PATH=$(find "$(dirname "$APPDIR")" -maxdepth 1 -name "*.AppImage" | head -1 || true)
if [[ -z "${APPIMAGE_PATH:-}" || ! -f "$APPIMAGE_PATH" ]]; then
  echo "ERROR: AppImage not found in $(dirname "$APPDIR")" >&2
  exit 1
fi

echo "  AppImage: $APPIMAGE_PATH"
echo "  Size:     $(du -h "$APPIMAGE_PATH" | cut -f1)"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
(
  cd "$TMP"
  "$APPIMAGE_PATH" --appimage-extract >/dev/null 2>&1 || true
  if find squashfs-root -name "libsds.so" | grep -q .; then
    echo "  ✓ libsds.so found inside AppImage"
  else
    echo "  WARNING: libsds.so not found inside AppImage" >&2
  fi
  if [[ -x squashfs-root/AppRun ]]; then
    echo "  ✓ AppRun present"
  fi
  RPATH=$(patchelf --print-rpath squashfs-root/usr/bin/status-backend 2>/dev/null || true)
  echo "  status-backend RPATH: '$RPATH'"
  INTERP=$(patchelf --print-interpreter squashfs-root/usr/bin/status-backend 2>/dev/null || true)
  echo "  status-backend INTERP: '$INTERP'"

  if [[ "$INTERP" == /nix/store/* ]]; then
    echo "  ERROR: interpreter still points into /nix/store" >&2
    exit 1
  fi

  # Запуск под «грязным» окружением — воспроизводит условия машины с
  # унаследованным LD_LIBRARY_PATH из шелла.
  if LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu \
     squashfs-root/usr/bin/status-backend --help >/dev/null 2>&1; then
    echo "  ✓ status-backend starts under inherited LD_LIBRARY_PATH"
  else
    echo "  ERROR: status-backend crashed on startup" >&2
    exit 1
  fi
)

echo
echo "=== Done ==="
echo "AppImage: $APPIMAGE_PATH"
