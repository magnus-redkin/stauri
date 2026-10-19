#!/usr/bin/env bash
set -euo pipefail

# Использование:
# ./scripts/prepare-sidecar.sh <path/to/status-backend> <path/to/libsds.so>
#
# Пример (из корня staturi):
# ./scripts/prepare-sidecar.sh status-go/build/bin/status-backend /nix/store/.../lib/libsds.so

if [ $# -ne 2 ]; then
    echo "Usage: $0 <path/to/status-backend> <path/to/libsds.so>"
    exit 1
fi

SRC_BACKEND="$1"
SRC_LIBSDS="$2"

# Определяем target-triple
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$TRIPLE" ]; then
    echo "Error: Could not determine Rust target triple."
    exit 1
fi

# Путь к tauri-app/src-tauri/binaries относительно этого скрипта
DST_DIR="$(cd "$(dirname "$0")/../tauri-app/src-tauri/binaries" && pwd)" || {
    echo "Error: Target directory not found. Is tauri-app present?"
    exit 1
}

DST_BACKEND="$DST_DIR/status-backend-$TRIPLE"
DST_LIBSDS="$DST_DIR/libsds.so"

echo "Preparing sidecar binaries for target: $TRIPLE"
mkdir -p "$DST_DIR"

# Копируем
cp "$SRC_BACKEND" "$DST_BACKEND"
cp "$SRC_LIBSDS" "$DST_LIBSDS"

chmod 755 "$DST_BACKEND" "$DST_LIBSDS"

# Патчим (только для Linux)
if [[ "$TRIPLE" == *"linux"* ]]; then
    echo "Patching binaries with patchelf..."
    patchelf --set-interpreter /lib64/ld-linux-x86-64.so.2 --set-rpath '$ORIGIN' "$DST_BACKEND"
    patchelf --set-rpath '$ORIGIN' "$DST_LIBSDS"
else
    echo "Warning: patchelf is only applied on Linux. Skipping for $TRIPLE."
fi

# Проверка
echo "Checking dependencies..."
if ldd "$DST_BACKEND" | grep -qE 'not found|/nix/store'; then
    echo "WARN: Unresolved or Nix dependencies found in status-backend:"
    ldd "$DST_BACKEND" | grep -E 'not found|/nix/store'
else
    echo "OK: No unresolved/nix dependencies in status-backend."
fi

if ldd "$DST_LIBSDS" | grep -qE 'not found|/nix/store'; then
    echo "WARN: Unresolved or Nix dependencies found in libsds.so:"
    ldd "$DST_LIBSDS" | grep -E 'not found|/nix/store'
else
    echo "OK: No unresolved/nix dependencies in libsds.so."
fi

echo "Sidecar binaries are ready in: $DST_DIR"
