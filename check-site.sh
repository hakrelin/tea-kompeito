#!/bin/bash
H=(-H "Host: tea-kompeito.com")
for p in / /staff.html /news.html /picks.html /about.html /notes/index.html \
         /assets/css/site.css /assets/js/site.js /assets/img/hero.webp \
         /assets/img/cover1.webp /assets/img/cover6.webp /assets/img/flowers.png \
         /assets/img/stairs.png /assets/img/rail-top.png /assets/img/paper.webp; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" "${H[@]}" "https://127.0.0.1$p")
  size=$(curl -sk -o /dev/null -w "%{size_download}" "${H[@]}" "https://127.0.0.1$p")
  echo "$code  ${size}B  $p"
done
echo "--- 棣栭〉鏍囬 ---"
curl -sk "${H[@]}" https://127.0.0.1/ | grep -o "<title>[^<]*</title>"
echo "--- 绔彛 ---"
ss -lntp | grep -E ":80\b|:443\b"
echo "--- 纾佺洏 ---"
du -sh /www/wwwroot/tea-kompeito.com
