#!/usr/bin/env sh
# تنصيب سريع على سيرفر Ubuntu/Debian جديد (VPS):
#   curl -fsSL https://raw.githubusercontent.com/iimnm/arabic-epg/main/aiolivetv/install.sh | sh
set -e
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
DIR="$HOME/aiolivetv"; mkdir -p "$DIR"; cd "$DIR"
BASE=https://raw.githubusercontent.com/iimnm/arabic-epg/main/aiolivetv
[ -f compose.yaml ] || curl -fsSL "$BASE/compose.yaml" -o compose.yaml
if [ ! -f .env ]; then
  IP=$(curl -fsS https://api.ipify.org)
  HOST="$(echo "$IP" | tr . -).sslip.io"
  PASS=$(openssl rand -hex 8)
  cat > .env <<ENV
DOMAIN=$HOST
BASE_URL=https://$HOST
SECRET_KEY=$(openssl rand -hex 32)
AIOLIVETV_AUTH=admin:$PASS
ENV
  echo "تم إنشاء .env  —  يوزر: admin  باسورد: $PASS"
fi
docker compose up -d
. ./.env
echo "افتح: $BASE_URL/stremio/configure"
