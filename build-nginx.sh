#!/usr/bin/env bash
# =============================================================
#  源码编译安装 Nginx（用系统 OpenSSL 3.0，避免 nginx.org el9 包
#  要求 OpenSSL 3.2/3.5 的 ABI 冲突）
#  安装布局与官方 RPM 一致：/usr/sbin/nginx、/etc/nginx、/var/log/nginx
# =============================================================
set -euo pipefail
V="${NGINX_VERSION:-1.30.6}"
SRC=/usr/local/src

# 单实例锁：避免重复触发时多个 make 并发把源码树搅坏
exec 9>/run/nginx-build.lock
flock -n 9 || { echo "ANOTHER_BUILD_RUNNING"; exit 0; }

echo "=== [1/5] 依赖检查 ==="
for p in gcc make pcre2-devel zlib-devel openssl-devel; do
  rpm -q "$p" >/dev/null 2>&1 || dnf install -y --disableexcludes=main "$p"
done

echo "=== [2/5] 下载 nginx $V ==="
cd "$SRC"
if [ ! -f "nginx-$V.tar.gz" ]; then
  curl -fsSL -o "nginx-$V.tar.gz" "https://nginx.org/download/nginx-$V.tar.gz"
fi
rm -rf "nginx-$V"
tar xzf "nginx-$V.tar.gz"
cd "nginx-$V"

echo "=== [3/5] configure ==="
./configure \
  --prefix=/etc/nginx \
  --sbin-path=/usr/sbin/nginx \
  --modules-path=/usr/lib64/nginx/modules \
  --conf-path=/etc/nginx/nginx.conf \
  --error-log-path=/var/log/nginx/error.log \
  --http-log-path=/var/log/nginx/access.log \
  --http-client-body-temp-path=/var/lib/nginx/tmp/client_body \
  --http-proxy-temp-path=/var/lib/nginx/tmp/proxy \
  --http-fastcgi-temp-path=/var/lib/nginx/tmp/fastcgi \
  --http-uwsgi-temp-path=/var/lib/nginx/tmp/uwsgi \
  --http-scgi-temp-path=/var/lib/nginx/tmp/scgi \
  --pid-path=/run/nginx.pid \
  --lock-path=/run/lock/subsys/nginx \
  --user=nginx --group=nginx \
  --with-compat --with-file-aio --with-threads \
  --with-http_addition_module --with-http_auth_request_module --with-http_dav_module \
  --with-http_gunzip_module --with-http_gzip_static_module --with-http_mp4_module \
  --with-http_random_index_module --with-http_realip_module --with-http_secure_link_module \
  --with-http_slice_module --with-http_ssl_module --with-http_stub_status_module \
  --with-http_sub_module --with-http_v2_module \
  --with-mail --with-mail_ssl_module \
  --with-stream --with-stream_realip_module --with-stream_ssl_module --with-stream_ssl_preread_module \
  --with-cc-opt='-O2 -g -pipe -Wall -Wp,-D_FORTIFY_SOURCE=2 -fexceptions -fstack-protector-strong -m64 -mtune=generic' \
  --with-ld-opt='-Wl,-z,relro -Wl,-z,now -Wl,-E'

echo "=== [4/5] 编译安装 ==="
make -j"$(nproc)"
make install

echo "=== [5/5] 目录/用户/unit ==="
id nginx >/dev/null 2>&1 || useradd -r -s /sbin/nologin -d /var/cache/nginx -M -c "nginx web server" nginx
mkdir -p /var/lib/nginx/tmp/{client_body,proxy,fastcgi,uwsgi,scgi} /var/cache/nginx /var/log/nginx /etc/nginx/conf.d
chown -R nginx:nginx /var/lib/nginx /var/cache/nginx /var/log/nginx

cat > /usr/lib/systemd/system/nginx.service <<'UNIT'
[Unit]
Description=nginx - high performance web server
Documentation=https://nginx.org/en/docs/
After=network-online.target remote-fs.target nss-lookup.target
Wants=network-online.target

[Service]
Type=forking
PIDFile=/run/nginx.pid
ExecStartPre=/usr/sbin/nginx -t -c /etc/nginx/nginx.conf
ExecStart=/usr/sbin/nginx -c /etc/nginx/nginx.conf
ExecReload=/bin/sh -c "/bin/kill -s HUP $(/bin/cat /run/nginx.pid)"
ExecStop=/bin/sh -c "/bin/kill -s TERM $(/bin/cat /run/nginx.pid)"
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
nginx -v
echo "=== NGINX_BUILD_OK ==="
