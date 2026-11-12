#!/usr/bin/env bash
# beta1锛氶潤鎬佸浘鐗囦氦缁?nginx 鐩存帴浠庣鐩樺嚭锛堥暱缂撳瓨锛夛紝骞跺紑鍚?gzip
set -euo pipefail
CONF=/etc/nginx/conf.d/zz-tea-site-beta1.conf
ls -la /etc/nginx/conf.d/ | grep -E 'zz-tea-site-beta1' || true

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

    gzip on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_types text/css text/javascript application/javascript application/json image/svg+xml;

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

    location /assets/ {
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

echo "== verify =="
FIRST=$(ls -1 /opt/tea-site-beta1/current/site/assets/catalog-covers | head -n 1)
for path in "/assets/catalog-covers/$FIRST" /assets/css/site.css /api/content; do
    curl -sS --noproxy '*' --resolve beta1.tea-kompeito.com:443:127.0.0.1 \
        -o /dev/null -H 'Accept-Encoding: gzip' \
        -w "%{http_code}  %{size_download}B  $path\n" \
        "https://beta1.tea-kompeito.com$path"
done

echo "== image headers =="
curl -sSI --noproxy '*' --resolve beta1.tea-kompeito.com:443:127.0.0.1 \
    "https://beta1.tea-kompeito.com/assets/catalog-covers/$FIRST" |
    grep -iE 'HTTP/|cache-control|content-length|content-type'

echo "== gzip on api =="
curl -sSI --noproxy '*' --resolve beta1.tea-kompeito.com:443:127.0.0.1 \
    -H 'Accept-Encoding: gzip' "https://beta1.tea-kompeito.com/api/content" |
    grep -iE 'HTTP/|content-encoding|cache-control'
