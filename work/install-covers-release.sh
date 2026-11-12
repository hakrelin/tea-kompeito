#!/usr/bin/env bash
# 鍙戝竷銆屽皝闈㈢缉鐣ュ浘 + 缂撳瓨澶淬€嶈繖涓€鐗堬細鏂?release 鐩綍 鈫?鍒囪蒋閾?鈫?鑷 鈫?澶辫触鑷姩鍥炴粴
set -euo pipefail
APP=/opt/tea-site-beta1
SERVICE=tea-site-beta1
HOST=beta1.tea-kompeito.com
RELEASE="covers-$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$APP/releases/$RELEASE"
NODE=$(command -v node)

echo "== 瑙ｅ寘 $RELEASE =="
install -d -m 0755 "$DEST"
tar --extract --gzip --no-same-owner --no-same-permissions \
    --file=/tmp/tea-covers-release.tar.gz --directory="$DEST"
"$NODE" --check "$DEST/server.mjs"
"$NODE" --check "$DEST/server/content.mjs"
install -d -m 0755 -o tea-beta1 -g tea-beta1 "$DEST/site/assets/uploads"

OLD=$(readlink "$APP/current")
echo "褰撳墠 release: $OLD"

rollback() {
    code=$?
    if [ "$code" -ne 0 ]; then
        echo "!! 鑷澶辫触锛屽洖婊氬埌 $OLD" >&2
        systemctl stop "$SERVICE" || true
        rm -f "$APP/current.next"
        ln -s "$OLD" "$APP/current.next"
        mv -Tf "$APP/current.next" "$APP/current"
        systemctl start "$SERVICE"
    fi
}
trap rollback EXIT

echo "== 鍋滄湇銆佹惉 uploads銆佸垏杞摼 =="
systemctl stop "$SERVICE"
cp -a "$APP/current/site/assets/uploads/." "$DEST/site/assets/uploads/" 2>/dev/null || true
ln -s "releases/$RELEASE" "$APP/current.next"
mv -Tf "$APP/current.next" "$APP/current"
systemctl start "$SERVICE"

echo "== 鑷 =="
for i in $(seq 1 20); do
    if curl -fsS --noproxy '*' --max-time 5 -H "Host: $HOST" \
        http://127.0.0.1:8781/api/content -o /tmp/content.json 2>/dev/null; then break; fi
    sleep 0.5
done
"$NODE" -e '
const content = require("/tmp/content.json").content;
if (!content.works.length) { console.error("浣滃搧涓虹┖"); process.exit(1); }
const withThumb = content.works.filter((work) => work.thumb);
console.log("浣滃搧", content.works.length, "甯︾缉鐣ュ浘", withThumb.length);
if (!withThumb.length) process.exit(1);
'
test -s "$APP/current/site/assets/catalog-covers/$(ls -1 "$APP/current/site/assets/catalog-covers" | head -n 1)"
systemctl is-active "$SERVICE"
trap - EXIT
rm -f /tmp/tea-covers-release.tar.gz /tmp/content.json
echo "宸插垏鎹㈠埌 $RELEASE"
