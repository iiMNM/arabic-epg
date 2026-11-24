#!/usr/bin/env sh
# تنصيب سريع على سيرفر Ubuntu/Debian جديد (VPS):
#   curl -fsSL https://raw.githubusercontent.com/iimnm/arabic-epg/main/aiometadata/install.sh | sh
# تقدر تمرّر مفتاح TMDB مباشرة:
#   curl -fsSL .../install.sh | TMDB_KEY=xxxx sh
set -e
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
DIR="$HOME/aiometadata"; mkdir -p "$DIR"; cd "$DIR"
BASE=https://raw.githubusercontent.com/iimnm/arabic-epg/main/aiometadata
[ -f compose.yaml ] || curl -fsSL "$BASE/compose.yaml" -o compose.yaml
if [ ! -f .env ]; then
  curl -fsSL "$BASE/.env.sample" -o .env
  IP=$(curl -fsS https://api.ipify.org)
  HOST="$(echo "$IP" | tr . -).sslip.io"
  if [ -z "$TMDB_KEY" ] && [ -r /dev/tty ]; then
    printf "مفتاح TMDB (API Key v3، Enter للتخطي): " > /dev/tty
    read -r TMDB_KEY < /dev/tty || true
  fi
  PASS=$(openssl rand -hex 8)
  sed -i \
    -e "s|^DOMAIN=.*|DOMAIN=$HOST|" \
    -e "s|^HOST_NAME=.*|HOST_NAME=https://$HOST|" \
    -e "s|^ADMIN_KEY=.*|ADMIN_KEY=$(openssl rand -hex 32)|" \
    -e "s|^ADDON_PASSWORD=.*|ADDON_PASSWORD=$PASS|" \
    -e "s|^BUILT_IN_TMDB_API_KEY=.*|BUILT_IN_TMDB_API_KEY=$TMDB_KEY|" \
    .env
  echo "تم إنشاء .env  —  باسورد الإضافة: $PASS"
  [ -n "$TMDB_KEY" ] || echo "تنبيه: ما حطيت مفتاح TMDB — عدّل $DIR/.env ثم: docker compose up -d"
fi
mkdir -p data cache
docker compose up -d
. ./.env
echo "افتح: $HOST_NAME/configure"
echo "مفتاح لوحة التحكم (ADMIN_KEY) موجود في $DIR/.env"
