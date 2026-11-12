#!/usr/bin/env bash
# beta1 绔欑偣锛氶潤鎬佽祫婧愪氦缁?nginx 鐩存帴浠庣鐩樺嚭锛屽浘鐗囬暱缂撳瓨锛涢『渚挎墦寮€ gzip
set -euo pipefail
CONF=/etc/nginx/conf.d/zz-tea-site-beta1.conf
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
cp -a "$CONF" "/etc/nginx/conf.d/zz-tea-site-beta1.conf.bak-$STAMP"

cat > "$CONF" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name beta1.tea-kompeito.com;
    return 308 https://beta1.tea-kompeito.com$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name beta1.tea-kompeito.com;

    ssl_certificate     /etc/nginx/ssl/tea-kompeito.com/fullchain.crt;
    ssl_certificate_key /etc/nginx/ssl/tea-kompeito.com/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=86400" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    access_log /var/log/nginx/tea-site-beta1.access.log;
    error_log  /var/log/nginx/tea-site-beta1.error.log warn;
    client_max_body_size 128m;

    # 鏂囨湰鍘嬬缉锛氶〉闈㈢殑 content 鏄?JSON锛屽帇缂╁悗鑳藉皬涓€澶ф埅
    gzip on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_types text/css text/javascript application/javascript application/json image/svg+xml;

    # 鍥剧墖锛堝皝闈€佸垏鍥撅級鐩存帴浠庣鐩樺嚭锛?0 澶╃紦瀛橈紝涓嶇┛ Node
    location /assets/img/ {
        alias /opt/tea-site-beta1/current/site/assets/img/;
        expires 30d;
        access_log off;
    }
    location /assets/catalog-covers/ {
        alias /opt/tea-site-beta1/current/site/assets/catalog-covers/;
        expires 30d;
        access_log off;
    }
    location /assets/uploads/ {
        alias /opt/tea-site-beta1/current/site/assets/uploads/;
        expires 7d;
        access_log off;
    }
    # 鑴氭湰/鏍峰紡/瀛椾綋锛氶潬 ?v= 鐗堟湰鍙峰け鏁堬紝鐭紦瀛?    location /assets/ {
        alias /opt/tea-site-beta1/current/site/assets/;
        expires 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:8781;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache off;
        proxy_read_timeout 120s;
    }
}
NGINX

nginx -t
systemctl reload nginx
echo "== 鑷锛堣蛋 nginx锛岃В鏋愬埌鏈満锛?="
for path in \
    /assets/catalog-covers/$(ls -1 /opt/tea-site-beta1/current/site/assets/catalog-covers | head -n 1) \
    /assets/css/site.css \
    /api/content ; do
    curl -sS --noproxy '*' --resolve beta1.tea-kompeito.com:443:127.0.0.1 \
        -o /dev/null -H 'Accept-Encoding: gzip' \
        -w "%{http_code}  enc=%{content_type}  %{size_download}B  $path\n" \
        "https://beta1.tea-kompeito.com$path"
done
echo "== 缂撳瓨澶?=="
curl -sSI --noproxy '*' --resolve beta1.tea-kompeito.com:443:127.0.0.1 \
    "https://beta1.tea-kompeito.com/assets/catalog-covers/$(ls -1 /opt/tea-site-beta1/current/site/assets/catalog-covers | head -n 1)" \
    | grep -iE 'HTTP/|cache-control|content-length'
echo "== gzip锛坅pi/content锛?="
curl -sSI --noproxy '*' --resolve beta1.tea-kompeito.com:443:127.0.0.1 \
    -H 'Accept-Encoding: gzip' "https://beta1.tea-kompeito.com/api/content" \
    | grep -iE 'HTTP/|content-encoding|cache-control'
