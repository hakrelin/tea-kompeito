#!/usr/bin/env bash
cd /www/wwwroot/tea-kompeito.com || exit 1
echo "== 文件 =="
ls -l *.html style.css
echo "== md5 =="
md5sum *.html style.css
echo "== 标题 =="
grep -h -o '<title>[^<]*</title>' *.html
echo "== 残留统计（静态页面/个人主页/联系我/我是） =="
grep -c '静态页面' *.html || true
echo "== 页脚 =="
tail -8 index.html
echo "== HTTP =="
for u in / /archive.html /nginx-conf.html /systemd-debug.html /phpfpm-ondemand.html /style.css; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1$u")
  echo "$u $code"
done
