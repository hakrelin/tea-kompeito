#!/usr/bin/env bash
# 把 zjz.* 的四个分散配置文件合并进 zz-jusic-domains.conf
# 失败自动回滚
set -uo pipefail
D=/etc/nginx/conf.d
B=/root/nginx-merge-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$B"

for f in zz-zjz-northwind-443.conf zz-zjz-northwind-80.conf zz-zjz-tea-sugar-443.conf zz-zjz-tea-sugar-80.conf; do
  if [ -f "$D/$f" ]; then
    cp -a "$D/$f" "$B/"
    rm -f "$D/$f"
    echo "removed $f"
  fi
done
echo "backup -> $B"

if nginx -t 2>&1; then
  systemctl reload nginx && echo RELOADED
  systemctl show nginx -p MainPID -p ActiveEnterTimestamp --no-pager
else
  echo "!! nginx -t failed -> restoring"
  cp -a "$B"/. "$D"/
  nginx -t 2>&1 && systemctl reload nginx && echo ROLLED_BACK
  exit 1
fi
