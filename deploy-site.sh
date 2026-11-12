#!/bin/bash
# 鑼朵笌閲戝钩绯栨眽鍖栫粍 路 绔欑偣涓婄嚎鑴氭湰锛堟湇鍔″櫒绔墽琛岋級
set -e
ROOT=/www/wwwroot/tea-kompeito.com
TS=$(date +%Y%m%d-%H%M)
B=/root/tea-site-backup-$TS.tar.gz

echo "== 澶囦唤鐜版湁绔欑偣 =="
tar -czf "$B" -C "$ROOT" .
echo "backup=$B"

echo "== 鏃х瑪璁伴〉鎼埌 /notes/锛屼笉瑕佷涪 =="
mkdir -p "$ROOT/notes"
for f in index.html style.css archive.html nginx-conf.html phpfpm-ondemand.html systemd-debug.html; do
  [ -f "$ROOT/$f" ] && mv -f "$ROOT/$f" "$ROOT/notes/$f"
done

echo "== 瑙ｅ寘鏂扮珯 =="
tar -xzf /tmp/tea-site.tar.gz -C "$ROOT"

echo "== 鏉冮檺 =="
chown -R nginx:nginx "$ROOT"
find "$ROOT" -type d -exec chmod 755 {} \;
find "$ROOT" -type f -exec chmod 644 {} \;

echo "== 鐩綍 =="
ls -la "$ROOT"
echo "== 璧勬簮鑷 =="
for p in / /staff.html /news.html /picks.html /about.html \
         /assets/css/site.css /assets/js/site.js \
         /assets/img/hero.webp /assets/img/cover1.webp /assets/img/flowers.png \
         /assets/img/stairs.png /assets/img/rail-top.png /assets/img/paper.webp /favicon.ico; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: tea-kompeito.com' "http://127.0.0.1$p")
  echo "$code  $p"
done
echo "== 棣栭〉鏍囬 =="
curl -s -H 'Host: tea-kompeito.com' http://127.0.0.1/ | grep -o '<title>[^<]*</title>'
echo "== nginx =="
nginx -t 2>&1 | tail -2
systemctl reload nginx
echo "done $TS"
