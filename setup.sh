#!/usr/bin/env bash
# =============================================================
#  tea-kompeito.com 服务器基础配置（幂等，可重复执行）
#  目标: Alibaba Cloud Linux 4 / 2C1.6G
#  做: Nginx + PHP-FPM8.3 + 站点目录 + vhost + 日志 + 自启
#  不改: 宝塔面板、已有 redis/postfix/jusic 服务
# =============================================================
set -uo pipefail
LOG=/root/bootstrap-tea.log
exec > >(tee -a "$LOG") 2>&1
echo "=========== $(date -Is) bootstrap start ==========="
SITE=tea-kompeito.com
ROOT=/www/wwwroot/$SITE
SRC=$(dirname "$0")

# 0) 去掉可能的 CRLF，避免 nginx 报 unexpected "}"
for f in "$SRC"/*.conf "$SRC"/index.html; do sed -i 's/\r$//' "$f" 2>/dev/null; done

# 1) 安装 Nginx：系统仓库没有 nginx（宝塔还 exclude 了），nginx.org el9 包又要
#    OpenSSL 3.2/3.5，本机 3.0.12 → 走源码编译（布局与官方 RPM 一致）
if [ ! -x /usr/sbin/nginx ]; then
  echo "--- 编译安装 nginx ---"
  bash "$SRC/build-nginx.sh" || { echo "!! nginx 安装失败"; exit 1; }
fi
nginx -v 2>&1

# 2) 安装 PHP-FPM 8.3 + 常用扩展
if ! rpm -q php-fpm >/dev/null 2>&1; then
  echo "--- 安装 php-fpm 8.3 ---"
  dnf install -y --disableexcludes=main php-fpm php-cli php-mbstring php-xml php-gd php-mysqlnd php-opcache php-bcmath php-curl php-zip \
    || dnf install -y --disableexcludes=main php-fpm php-cli php-mbstring php-xml php-gd php-mysqlnd
fi
php -v 2>&1 | head -1

# 3) 站点目录 + 文件权限
mkdir -p "$ROOT"/{uploads,downloads} /www/wwwlogs
if [ ! -f "$ROOT/index.html" ] || grep -q "Nginx 占位页" "$ROOT/index.html" 2>/dev/null; then
  cp -f "$SRC/index.html" "$ROOT/index.html"
fi
chown -R nginx:nginx "$ROOT"
find "$ROOT" -type d -exec chmod 755 {} \;
find "$ROOT" -type f -exec chmod 644 {} \;

# 4) vhost 配置
mkdir -p /etc/nginx/conf.d
install -m 644 "$SRC/00-default.conf"        /etc/nginx/conf.d/00-default.conf
install -m 644 "$SRC/tea-kompeito.com.conf"  /etc/nginx/conf.d/tea-kompeito.com.conf
[ -f /etc/nginx/conf.d/default.conf ] && mv -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak
# 删掉 nginx.org 那份装不上的源，免得以后 dnf 报错
rm -f /etc/yum.repos.d/nginx-stable.repo

# 5) PHP-FPM 调优
install -m 644 "$SRC/zz-custom.conf" /etc/php-fpm.d/zz-custom.conf

# 6) 启动 + 自启
nginx -t || { echo "!! nginx 配置语法错误"; exit 1; }
systemctl enable --now nginx
systemctl enable --now php-fpm
systemctl restart php-fpm
systemctl reload nginx

# 7) 防火墙放行（云侧安全组另配，见交付说明）
firewall-cmd --permanent --add-service=http  >/dev/null 2>&1
firewall-cmd --permanent --add-service=https >/dev/null 2>&1
firewall-cmd --reload >/dev/null 2>&1

# 8) 自检
echo "--- 自检 ---"
curl -s -o /dev/null -w "本机IP直连 http://127.0.0.1  -> %{http_code}\n" http://127.0.0.1/
curl -s -o /dev/null -w "带域名Host              -> %{http_code}\n" -H "Host: $SITE" http://127.0.0.1/
echo "<?php echo 'PHPOK '.PHP_VERSION; ?>" > "$ROOT/__probe.php"
chown nginx:nginx "$ROOT/__probe.php"
sleep 1
curl -s -H "Host: $SITE" "http://127.0.0.1/__probe.php"; echo " <- PHP 连通性"
rm -f "$ROOT/__probe.php"

echo "--- 服务状态 ---"
systemctl is-active nginx php-fpm
ss -lntp | grep -E ':80\b|:443\b' || true
echo "=========== $(date -Is) bootstrap done ==========="
