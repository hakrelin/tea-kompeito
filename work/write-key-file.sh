#!/usr/bin/env bash
# 在服务器上生成 /root/key.txt（600，仅 root 可读），内容从 /etc/tea-site/qiniu.env 取
set -euo pipefail

SRC=/etc/tea-site/qiniu.env
DST=/root/key.txt
[ -f "$SRC" ] || { echo "缺少 $SRC" >&2; exit 1; }

umask 077
{
    echo "# 七牛云密钥（茶与金平糖站点：对象存储 tea-kompeito / CDN img.tea-kompeito.com）"
    echo "# 生成时间：$(date -Is)"
    echo "# 权限 600，仅 root 可读；服务实际读取的是 $SRC，改密钥请两边一起改"
    echo
    grep -E '^(QINIU_AK|QINIU_SK)=' "$SRC"
    echo
    echo "# 其它参数"
    grep -E '^(QINIU_BUCKET|QINIU_PUBLIC_BASE|QINIU_UPLOAD_HOST|QINIU_UPLOAD_PREFIX|CDN_DOMAIN)=' "$SRC"
} > "$DST"
chown root:root "$DST"
chmod 600 "$DST"

echo "=== 文件信息 ==="
ls -l "$DST"
echo "=== 内容（SK 打码显示）==="
sed -E 's/^(QINIU_SK=)(.{6}).*/\1\2……/' "$DST"
echo "=== 确认不在网站目录里、也不能通过 HTTP 取到 ==="
curl -sk -o /dev/null -w 'https://beta1.tea-kompeito.com/key.txt -> %{http_code}\n' \
    --resolve beta1.tea-kompeito.com:443:127.0.0.1 https://beta1.tea-kompeito.com/key.txt
curl -sk -o /dev/null -w 'https://img.tea-kompeito.com/key.txt -> %{http_code}\n' \
    https://img.tea-kompeito.com/key.txt
