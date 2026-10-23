#!/bin/bash
# Dock에 둘 실행 아이콘 앱(~/Applications/Wonbook.app)을 만든다(design.md 2.4). 실행: pnpm make-launcher
# 앱을 누르면 서버가 꺼져 있을 때만 켜고(빌드가 없으면 먼저 빌드) 브라우저로 연다.
# 서버는 요청이 WONBOOK_IDLE_MINUTES 동안 없으면 스스로 꺼진다(scripts/serve.ts).
# 저장소 위치, node·pnpm 경로, WONBOOK_PORT가 바뀌면 다시 실행한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(dirname "$(command -v node)")"
PNPM_BIN="$(dirname "$(command -v pnpm)")"
PORT="$(grep -E '^WONBOOK_PORT=' "$ROOT/.env.local" 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-4848}"
APP="$HOME/Applications/Wonbook.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 앱 안에서 실행할 스크립트. Dock에서 실행하면 터미널의 PATH가 없으므로 만들 때의 node·pnpm 경로를 박아 둔다.
cat > "$TMP/launch.sh" <<EOF
#!/bin/bash
export PATH="$NODE_BIN:$PNPM_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$ROOT"
URL="http://localhost:$PORT"
LOG="$ROOT/data/server.log"
mkdir -p "$ROOT/data"

if ! curl -s -o /dev/null "\$URL"; then
  if [ ! -f .next/BUILD_ID ]; then
    pnpm build >> "\$LOG" 2>&1 || { echo "빌드 실패. data/server.log를 확인하세요."; exit 1; }
  fi
  WONBOOK_PORT=$PORT nohup pnpm serve >> "\$LOG" 2>&1 < /dev/null &
  for i in \$(seq 1 60); do
    curl -s -o /dev/null "\$URL" && break
    sleep 0.5
  done
  curl -s -o /dev/null "\$URL" || { echo "서버가 뜨지 않았습니다. data/server.log를 확인하세요."; exit 1; }
fi
open "\$URL"
EOF

cat > "$TMP/main.applescript" <<'EOF'
try
  do shell script quoted form of (POSIX path of (path to resource "launch.sh"))
on error msg
  display alert "원북" message msg
end try
EOF

# 아이콘: 1024px 원본을 그려 크기별로 줄인 뒤 icns로 묶는다.
swift "$ROOT/scripts/launcher-icon.swift" "$TMP/icon.png"
ICONSET="$TMP/applet.iconset"
mkdir "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}.png" > /dev/null
  sips -z $((s * 2)) $((s * 2)) "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" > /dev/null
done
iconutil -c icns "$ICONSET" -o "$TMP/applet.icns"

rm -rf "$APP"
mkdir -p "$(dirname "$APP")"
osacompile -o "$APP" "$TMP/main.applescript"
cp "$TMP/launch.sh" "$APP/Contents/Resources/launch.sh"
chmod +x "$APP/Contents/Resources/launch.sh"
# osacompile이 넣는 기본 아이콘(Assets.car, CFBundleIconName)이 icns보다 우선하므로 지우고 icns로 바꾼다.
cp "$TMP/applet.icns" "$APP/Contents/Resources/applet.icns"
rm -f "$APP/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
# 묶음 내용을 바꿨으므로 다시 서명한다. 이 맥에서만 쓰므로 ad-hoc 서명으로 충분하다.
codesign --force --sign - "$APP"
# Finder가 예전 아이콘을 들고 있지 않게 알린다.
touch "$APP"

echo "만들었다: $APP"
echo "Finder에서 이 앱을 Dock으로 끌어다 둔다."
