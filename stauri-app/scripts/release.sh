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

# ---------- Целостность внешних загрузок ----------
#
# linuxdeploy и плагин appimage скачиваются с GitHub и исполняются.
# Подмена CDN, компрометация аккаунта или подмена релиза даёт выполнение
# произвольного кода на машине разработчика.
#
# Поэтому версия зафиксирована тегом (не `continuous`, который плавает),
# а содержимое сверяется по sha256. Скачанные ранее файлы тоже проверяются:
# файл мог быть изменён на диске.
#
# Плагин закреплён на версионном релизе. Чтобы получить его хеш при
# обновлении версии:
#   wget -q "$PLUGIN_URL" -O /tmp/p.AppImage && sha256sum /tmp/p.AppImage

LINUXDEPLOY_URL="https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy-07333c6/linuxdeploy-x86_64.AppImage"
LINUXDEPLOY_SHA256="36a2d7e274d12e1050d0e9ecfe11d339ed54720b2bec464c286d53f8b07f5c62"

PLUGIN_URL="https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/1-alpha-20250213-1/linuxdeploy-plugin-appimage-x86_64.AppImage"
PLUGIN_SHA256="992d502a248e14ab185448ddf6f6e7d25558cb84d4623c354c3af350c25fccb3"

# Скачивает файл и проверяет sha256. Повторно не скачивает, но всегда
# проверяет: локальная копия могла быть подменена.
fetch_verified() {
  local url="$1" dest="$2" expected="$3"

  if [[ ! -f "$dest" ]]; then
    echo "  downloading $(basename "$dest")"
    wget -q "$url" -O "$dest" || {
      echo "ERROR: download failed: $url" >&2
      exit 1
    }
  fi

  local actual
  actual=$(sha256sum "$dest" | awk '{print $1}')
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: checksum mismatch for $(basename "$dest")" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    echo "  If the release was updated intentionally, update the checksum in" >&2
    echo "  this script after verifying the new artifact." >&2
    exit 1
  fi
}

echo "=== Stauri release $VERSION ==="
echo "Root: $ROOT"

# ---------- 1. Проверка зависимостей ----------
echo
echo "[1/8] Checking dependencies"

for cmd in pnpm patchelf wget node git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd not found." >&2
    exit 1
  fi
done

# Необязательные проверяльщики: без них релиз не останавливаем, но честно
# говорим, что проверка пропущена. На CI их легко поставить пакетами
# appstream и desktop-file-utils.
MISSING_TOOLS=()
command -v appstreamcli         >/dev/null 2>&1 || MISSING_TOOLS+=(appstreamcli)
command -v desktop-file-validate >/dev/null 2>&1 || MISSING_TOOLS+=(desktop-file-validate)
command -v sha256sum            >/dev/null 2>&1 || MISSING_TOOLS+=(sha256sum)
if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
  echo "  WARNING: missing tools, checks will be skipped: ${MISSING_TOOLS[*]}" >&2
fi

# Подпись и обновления обязательны.
#
# Раньше отсутствие ключа или пароля давало предупреждение, и релиз собирался
# без подписи. Практика показала, чем это кончается: AppImage выглядит
# готовым, но `check_for_update` в нём навсегда возвращает «обновлений нет»,
# и пользователи остаются на версии без возможности обновиться. Поэтому
# теперь это ошибка, а не предупреждение: собранный без подписи артефакт
# нельзя пускать в раздачу, и лучше упасть до трёхминутной сборки, чем после.
SIGN_KEY="${TAURI_SIGNING_PRIVATE_KEY_PATH:-}"
if [[ -z "$SIGN_KEY" && -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  SIGN_KEY="<TAURI_SIGNING_PRIVATE_KEY>"
fi
if [[ -z "$SIGN_KEY" ]]; then
  echo "ERROR: TAURI_SIGNING_PRIVATE_KEY_PATH не задан — без ключа нет ни подписи," >&2
  echo "       ни обновлений. Такой AppImage публиковать нельзя." >&2
  echo "       export TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/stauri.key" >&2
  exit 1
fi
if [[ "$SIGN_KEY" != "<TAURI_SIGNING_PRIVATE_KEY>" && ! -f "$SIGN_KEY" ]]; then
  echo "ERROR: ключ подписи не найден: $SIGN_KEY" >&2
  exit 1
fi
echo "  signing key: ${SIGN_KEY}"

# Пароль тоже обязателен. Сам по себе факт его наличия не гарантирует
# правильность — это выяснится на подписи, — но его отсутствие гарантирует
# провал, и узнать об этом сейчас дешевле, чем после сборки.
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  echo "ERROR: TAURI_SIGNING_PRIVATE_KEY_PASSWORD не задан — подпись не создастся." >&2
  echo "       export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...'" >&2
  exit 1
fi
echo "  signing password: set"

# Публичный ключ обязан быть в конфиге заранее: он инлайнится в бинарник при
# компиляции, и добавить его после сборки нельзя. Пустой ключ = сборка без
# обновлений, поэтому проверяем до компиляции, а не после.
CONFIG_PUBKEY="$(python3 -c "
import json
print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['plugins']['updater']['pubkey'].strip())
")"
if [[ -z "$CONFIG_PUBKEY" ]]; then
  echo "ERROR: plugins.updater.pubkey пуст в tauri.conf.json." >&2
  echo "       Впишите публичную часть ключа (> $SIGN_KEY.pub):" >&2
  echo "       без неё updater не сможет проверить подпись обновления." >&2
  exit 1
fi
echo "  updater pubkey: ${#CONFIG_PUBKEY} chars"

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
echo "[2/8] Bumping version to $VERSION"

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

# Cargo.toml: версия в секции [package] — единственная, которую надо трогать.
# Без неё `cargo` и Tauri расходятся: сборка идёт с одной версией, а
# метаданные пакета содержат другую (так и было: 0.1.0 против 0.2.0).
python3 - "$ROOT/src-tauri/Cargo.toml" "$VERSION" <<'PY'
import re, sys
path, version = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
new, count = re.subn(
    r'(?m)^version\s*=\s*"[^"]*"',
    f'version = "{version}"',
    text,
    count=1,
)
if count != 1:
    sys.exit(f"ERROR: could not bump version in {path}")
open(path, 'w', encoding='utf-8').write(new)
PY

# AppStream: самый свежий <release> должен совпадать с версией сборки, иначе
# центры установки показывают неверную.
python3 - "$ROOT/src-tauri/metainfo/com.magnus.stauri-app.appdata.xml" "$VERSION" "$(date +%Y-%m-%d)" <<'PY'
import re, sys
path, version, today = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding='utf-8').read()
pattern = re.compile(r'<release version="[^"]*" date="[^"]*">')
new, count = pattern.subn(f'<release version="{version}" date="{today}">', text, count=1)
if count != 1:
    sys.exit(f"ERROR: could not bump release in {path}")
open(path, 'w', encoding='utf-8').write(new)
PY

echo "  package.json     -> $VERSION"
echo "  tauri.conf.json  -> $VERSION"
echo "  Cargo.toml       -> $VERSION"
echo "  appdata.xml      -> $VERSION"

# ---------- 2a. Проверки перед сборкой ----------
echo
echo "[2a/8] Pre-build checks"

# AppStream и .desktop можно проверить до сборки: файлы статические.
METAINFO="$ROOT/src-tauri/metainfo/com.magnus.stauri-app.appdata.xml"
if [[ -f "$METAINFO" && -n "$(command -v appstreamcli || true)" ]]; then
  appstreamcli validate --no-net "$METAINFO" 2>&1 | sed 's/^/  /'
  # appstreamcli возвращает 0 и на info-замечаниях, ненулевой — только ошибки.
  if ! appstreamcli validate --no-net "$METAINFO" >/dev/null 2>&1; then
    echo "ERROR: metainfo не прошёл валидацию" >&2
    exit 1
  fi
  echo "  ✓ metainfo valid"
else
  echo "  WARNING: metainfo или appstreamcli отсутствуют — проверка пропущена" >&2
fi

# Git-состояние. Тег ставим ПОСЛЕ успешной сборки, поэтому сейчас только
# предупреждаем: тегировать грязное дерево значит потерять точку сборки.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "  WARNING: рабочее дерево содержит незакоммиченные изменения." >&2
    echo "           Тег v$VERSION будет указывать на HEAD, а не на эти файлы." >&2
  fi
  if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
    echo "ERROR: тег v$VERSION уже существует." >&2
    echo "       Версия должна монотонно расти: старый тег уже указывает на другой коммит." >&2
    exit 1
  fi
  echo "  git: HEAD $(git rev-parse --short HEAD)"
else
  echo "  WARNING: не git-репозиторий — тег не будет поставлен" >&2
fi

# ---------- 3. Фронтенд ----------
echo
echo "[3/8] Building frontend"
pnpm install --frozen-lockfile
pnpm build

# ---------- 4. Rust-бинарник (без bundle) ----------
echo
echo "[4/8] Building Rust binary"

# `--no-bundle` больше не передаём: в tauri.conf.json стоит "targets": [],
# то есть штатный `tauri build` и так не собирает ни deb, ни AppImage.
#
# Раньше конфиг объявлял "targets": "deb", а флаг молча отменял это обещание.
# Несовпадение вводило в заблуждение: конфиг говорил одно, скрипт делал другое,
# а `tauri build` без скрипта неожиданно собирал .deb. Пустой список — это
# единственная правда: упаковкой занимается этот скрипт, см. шаг 5.
export NO_STRIP=1
pnpm tauri build

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
echo "[5/8] Creating AppDir manually"

APPDIR="$ROOT/src-tauri/target/release/bundle/appimage/stauri-app.AppDir"
rm -rf "$APPDIR"
# Убираем AppImage от прошлой сборки: иначе при сбое linuxdeploy проверка на
# шаге 7 найдёт старый файл и отрапортует об успехе, отдав пользователю
# предыдущую версию с тем же именем.
rm -f "$ROOT/src-tauri/target/release/bundle/appimage/"*.AppImage
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
#
# Имя файла — обратный DNS, равный Tauri `identifier`. Это не вкусовщина:
# `appimagetool` ищет метаданные AppStream по имени desktop-файла
# (`<имя>.appdata.xml`), а `appstreamcli validate-tree` требует, чтобы
# `<launchable>` ссылался на существующий desktop-id. Пока имя было
# `stauri-app.desktop`, а `<id>` — `com.magnus.stauri-app`, проверки
# падали с `metainfo-filename-cid-mismatch` и `desktop-file-not-found`,
# и linuxdeploy отказывался собирать образ.
#
# Иконка ставится по имени `stauri-app`, без пути: так её ищет менеджер окон.
DESKTOP_ID="com.magnus.stauri-app"
cat > "$APPDIR/usr/share/applications/$DESKTOP_ID.desktop" << 'EOF'
[Desktop Entry]
Type=Application
Name=Stauri
GenericName=Status client
Comment=Лёгкий клиент Status: чаты и кошелёк
Exec=stauri-app %U
Icon=stauri-app
Terminal=false
Categories=Network;InstantMessaging;
Keywords=status;messenger;waku;ethereum;wallet;
StartupWMClass=stauri-app
EOF

if [[ -n "$(command -v desktop-file-validate || true)" ]]; then
  if desktop-file-validate "$APPDIR/usr/share/applications/$DESKTOP_ID.desktop" 2>&1 | sed 's/^/  /'; then
    echo "  ✓ desktop entry valid"
  else
    echo "ERROR: desktop-file-validate нашёл ошибки в $DESKTOP_ID.desktop" >&2
    exit 1
  fi
else
  echo "  WARNING: desktop-file-validate отсутствует — проверка .desktop пропущена" >&2
fi

# AppStream: кладём в usr/share/metainfo/ под именем, равным <id>.
#
# Суффикс обязан быть `.appdata.xml`, а имя — совпадать с component id.
# `linuxdeploy-plugin-appimage` вызывает `appstreamcli validate-tree`, и при
# суффиксе `.metainfo.xml` тот не находит файл вовсе (`dir-no-metadata-found`),
# а при несовпадении имени и id падает с `metainfo-filename-cid-mismatch`,
# из-за чего плагин прерывает сборку образа.
if [[ -f "$METAINFO" ]]; then
  mkdir -p "$APPDIR/usr/share/metainfo"
  cp "$METAINFO" "$APPDIR/usr/share/metainfo/$(basename "$METAINFO")"
  echo "  metainfo: installed as $(basename "$METAINFO")"
fi

# Лицензия: каталоги (Flathub, AppImageHub) и GPL-линтеры требуют, чтобы текст
# шёл в комплекте. `<project_license>MPL-2.0</project_license>` в metainfo —
# это лишь идентификатор, а не текст.
LICENSE_FILE="$ROOT/LICENSE.md"
if [[ -f "$LICENSE_FILE" ]]; then
  mkdir -p "$APPDIR/usr/share/licenses/stauri-app"
  cp "$LICENSE_FILE" "$APPDIR/usr/share/licenses/stauri-app/LICENSE.md"
  echo "  license: installed"
else
  echo "  WARNING: LICENSE.md отсутствует — текст лицензии не попадёт в пакет" >&2
fi

# Иконки: раскладываем по размерам в hicolor, а не только 128x128 — иначе
# в трее и в меню на HiDPI используется растянутый мелкий файл.
for size in 32 128 256 512; do
  case "$size" in
    32)  src="$ROOT/src-tauri/icons/32x32.png" ;;
    128) src="$ROOT/src-tauri/icons/128x128.png" ;;
    256) src="$ROOT/src-tauri/icons/128x128@2x.png" ;;
    512) src="$ROOT/src-tauri/icons/icon.png" ;;
  esac
  if [[ -f "$src" ]]; then
    mkdir -p "$APPDIR/usr/share/icons/hicolor/${size}x${size}/apps"
    cp "$src" "$APPDIR/usr/share/icons/hicolor/${size}x${size}/apps/stauri-app.png"
  fi
done

# Корневая иконка нужна linuxdeploy: по ней он определяет, что AppDir
# упакован правильно.
ICON="$ROOT/src-tauri/icons/128x128.png"
if [[ -f "$ICON" ]]; then
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
echo "[6/8] Running linuxdeploy"

# Обход segfault ldd на status-backend больше не нужен: после патча интерпретатора
# бинарник линкуется системным загрузчиком и ldd отрабатывает штатно.
mkdir -p /tmp/bin
rm -f /tmp/bin/ldd

# Скачиваем linuxdeploy и плагин appimage, сверяя sha256.
# Повторная загрузка не выполняется, но проверка — всегда.
fetch_verified "$LINUXDEPLOY_URL" /tmp/linuxdeploy-x86_64.AppImage "$LINUXDEPLOY_SHA256"
fetch_verified "$PLUGIN_URL" /tmp/linuxdeploy-plugin-appimage-x86_64.AppImage "$PLUGIN_SHA256"
chmod +x /tmp/linuxdeploy-x86_64.AppImage /tmp/linuxdeploy-plugin-appimage-x86_64.AppImage

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
echo "[7/8] Verifying AppImage"

# Берём самый свежий файл, а не первый попавшийся: linuxdeploy при некоторых
# настройках плагина кладёт рядом и версионированный AppImage, и ссылку на него.
APPIMAGE_PATH=$(
  find "$(dirname "$APPDIR")" -maxdepth 1 -name "*.AppImage" -printf '%T@ %p\n' \
    | sort -rn | head -1 | cut -d' ' -f2- || true
)
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

# ---------- 8. Контрольные суммы, подпись, манифест обновления, тег ----------
echo
echo "[8/8] Checksums, signature, update manifest, git tag"

# Рядом с AppImage кладём <имя>.sha256 в формате `sha256sum -c`: его можно
# проверить одной командой и он не зависит от нашего скрипта.
CHECKSUM_FILE="${APPIMAGE_PATH}.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$(dirname "$APPIMAGE_PATH")"
    sha256sum "$(basename "$APPIMAGE_PATH")" > "$(basename "$CHECKSUM_FILE")"
  )
  echo "  sha256: $(cut -d' ' -f1 "$CHECKSUM_FILE")"
  echo "  file:   $(basename "$CHECKSUM_FILE")"
else
  echo "  WARNING: sha256sum отсутствует — контрольная сумма не создана" >&2
fi

# Подпись minisign-совместимым ключом Tauri. Это же подпись, которую
# проверяет встроенный updater, поэтому она полезна и без автообновления:
# пользователь может убедиться, что файл собран нами.
#
# --app-version привязывает подпись к версии: она попадает в подписанный
# trusted comment, и updater с requireSignedVersion отвергнет манифест,
# в котором номер версии подменён на другой.
if [[ -n "$SIGN_KEY" ]]; then
  SIGNATURE_FILE="${APPIMAGE_PATH}.sig"
  if [[ "$SIGN_KEY" == "<TAURI_SIGNING_PRIVATE_KEY>" ]]; then
    pnpm tauri signer sign --app-version "$VERSION" "$APPIMAGE_PATH" 2>&1 | sed 's/^/  /'
  else
    pnpm tauri signer sign -f "$SIGN_KEY" --app-version "$VERSION" "$APPIMAGE_PATH" 2>&1 | sed 's/^/  /'
  fi
  if [[ -f "$SIGNATURE_FILE" ]]; then
    echo "  signature: $(basename "$SIGNATURE_FILE") (v$VERSION)"
  else
    echo "ERROR: подпись не создана (ожидался $SIGNATURE_FILE)" >&2
    exit 1
  fi
else
  echo "  WARNING: подпись пропущена (ключ не задан)" >&2
fi

# Манифест обновления latest.json — ровно то, что скачивает встроенный
# updater по адресу из plugins.updater.endpoints в tauri.conf.json.
#
# Формат «static»: один файл описывает платформы, и updater выбирает запись
# по ключу linux-x86_64. Имя ключа — это формат из tauri-plugin-updater
# (updater_os + "-" + updater_arch), менять его нельзя.
#
# url — GitHub releases: тег загружается отдельно, но имя файла должно
# совпадать с тем, что реально положено в релиз. signature — содержимое
# .sig одной строкой, как его ждёт плагин.
MANIFEST_FILE="$(dirname "$APPIMAGE_PATH")/latest.json"

# Сверка ключа в собранном бинарнике.
#
# Это ровно тот промах, который случился на релизе 0.2.0: подпись и
# latest.json создались, но в tauri.conf.json на момент сборки pubkey был
# пуст. Внешне релиз выглядел готовым, а обновления в нём не работали бы
# вовсе — `check_for_update` вернул бы None навсегда.
#
# Ключ инлайнится в бинарник как строка, поэтому его достаточно найти в нём.
# Проверяем только когда ключ задан: иначе такого требования нет.
CONFIG_PUBKEY="$(python3 -c "
import json
print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['plugins']['updater']['pubkey'].strip())
")"
if [[ -n "$CONFIG_PUBKEY" ]]; then
  if grep -qaF "$CONFIG_PUBKEY" "$TAURI_BIN"; then
    echo "  ✓ updater pubkey is embedded in the binary"
  else
    echo "ERROR: в собранном бинарнике нет pubkey из tauri.conf.json." >&2
    echo "       Ключ был добавлен после сборки — пересоберите приложение," >&2
    echo "       иначе проверка обновлений всегда будет возвращать «нет обновлений»." >&2
    exit 1
  fi
else
  echo "  WARNING: plugins.updater.pubkey пуст — обновления в этой сборке" >&2
  echo "           работать не будут, даже если подпись создана." >&2
fi
if [[ -n "$SIGN_KEY" && -f "${APPIMAGE_PATH}.sig" ]]; then
  DOWNLOAD_URL="https://github.com/magnus-redkin/stauri/releases/download/v$VERSION/$(basename "$APPIMAGE_PATH")"
  python3 - "$MANIFEST_FILE" "$VERSION" "$DOWNLOAD_URL" "${APPIMAGE_PATH}.sig" <<'PY'
import json, sys
from datetime import datetime, timezone

manifest_path, version, url, sig_path = sys.argv[1:5]
signature = open(sig_path, encoding='utf-8').read().strip()

manifest = {
    "version": version,
    "pub_date": datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    "platforms": {
        "linux-x86_64": {
            "url": url,
            "signature": signature,
        }
    },
}
with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
  echo "  update manifest: $(basename "$MANIFEST_FILE")"
  echo "    upload: $(basename "$APPIMAGE_PATH"), $(basename "$APPIMAGE_PATH").sig, latest.json"
else
  echo "  WARNING: latest.json не создан — без подписи updater всё равно" >&2
  echo "           отвергнет обновление." >&2
  MANIFEST_FILE=""
fi

# Тег ставится последним и только при успехе: он должен указывать на код,
# из которого действительно собран этот AppImage. Push не делаем — отправка
# в remote остаётся решением человека. `git tag -a` создаёт аннотированный
# тег, у него есть дата и автор, в отличие от лёгкого.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
    echo "  WARNING: тег v$VERSION появился во время сборки — не переставляю" >&2
  else
    git tag -a "v$VERSION" -m "Stauri $VERSION"
    echo "  tag: v$VERSION -> $(git rev-parse --short HEAD)"
    echo "  отправить в remote: git push origin v$VERSION"
  fi
else
  echo "  WARNING: не git-репозиторий — тег не поставлен" >&2
fi

echo
echo "=== Artifacts ==="
echo "  $APPIMAGE_PATH"
[[ -f "$CHECKSUM_FILE" ]] && echo "  $CHECKSUM_FILE"
[[ -n "$SIGN_KEY" && -f "${APPIMAGE_PATH}.sig" ]] && echo "  ${APPIMAGE_PATH}.sig"
[[ -n "$MANIFEST_FILE" && -f "$MANIFEST_FILE" ]] && echo "  $MANIFEST_FILE"
