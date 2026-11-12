#!/bin/bash
# 鎶婄嚎涓婄珯鐐瑰垏鍥炰笂绾垮墠鐨勯偅涓€鐗堬紙鎾ら攢 20261111-2022 閭ｆ鍙戝竷锛?set -e
ROOT=/www/wwwroot/tea-kompeito.com
BAK=/root/tea-site-backup-20261111-2022.tar.gz
WIP=/root/tea-wip

echo "== 澶囦唤鏄惁瀛樺湪 =="
ls -l "$BAK"

echo "== 鏂扮珯鏂囦欢鎸嚭绔欑偣鐩綍 =="
mkdir -p "$WIP"
for f in index.html staff.html news.html picks.html about.html assets; do
  [ -e "$ROOT/$f" ] && mv -f "$ROOT/$f" "$WIP/" && echo "moved $f -> $WIP/"
done

echo "== 鍒犳帀涓存椂鎸繃鍘荤殑 notes =="
rm -rf "$ROOT/notes"

echo "== 鐢ㄥ浠借繕鍘?=="
tar -xzf "$BAK" -C "$ROOT"

echo "== 鏉冮檺 =="
chown -R nginx:nginx "$ROOT"
find "$ROOT" -type d -exec chmod 755 {} \;
find "$ROOT" -type f -exec chmod 644 {} \;

echo "== 鐜板湪绔欑偣鐩綍 =="
ls -la "$ROOT"

echo "== 绾夸笂鑷 =="
echo -n "root title: "
curl -sk -H 'Host: tea-kompeito.com' https://127.0.0.1/ | grep -o '<title>[^<]*</title>'
for p in / /style.css /notes/ /staff.html /assets/css/site.css; do
  printf '%s  %s\n' "$(curl -sk -o /dev/null -w '%{http_code}' -H 'Host: tea-kompeito.com' "https://127.0.0.1$p")" "$p"
done

echo "== 鏆傚瓨浣嶇疆 =="
du -sh "$WIP"; ls "$WIP"
