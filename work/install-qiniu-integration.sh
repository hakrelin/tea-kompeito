#!/usr/bin/env bash
# 安装：七牛环境变量文件、证书同步脚本、systemd 环境、续期钩子
set -euo pipefail

umask 077
: "${QINIU_AK:?需要 QINIU_AK 环境变量}"
: "${QINIU_SK:?需要 QINIU_SK 环境变量}"
BUCKET=${QINIU_BUCKET:-tea-kompeito}
BASE=${QINIU_PUBLIC_BASE:-https://img.tea-kompeito.com}
UPHOST=${QINIU_UPLOAD_HOST:-upload-z0.qiniup.com}
PREFIX=${QINIU_UPLOAD_PREFIX:-uploads}
DOMAIN=${CDN_DOMAIN:-img.tea-kompeito.com}

install -d -m 0700 /etc/tea-site
umask 077
{
  printf '# 七牛对象存储 / CDN（root 独占，600），由 install-qiniu-integration.sh 生成\n'
  printf 'QINIU_AK=%s\nQINIU_SK=%s\n' "$QINIU_AK" "$QINIU_SK"
  printf 'QINIU_BUCKET=%s\nQINIU_PUBLIC_BASE=%s\n' "$BUCKET" "$BASE"
  printf 'QINIU_UPLOAD_HOST=%s\nQINIU_UPLOAD_PREFIX=%s\n' "$UPHOST" "$PREFIX"
  printf 'CDN_DOMAIN=%s\n' "$DOMAIN"
} > /etc/tea-site/qiniu.env
chmod 600 /etc/tea-site/qiniu.env

install -m 0755 /tmp/qiniu-cdn-cert.py /usr/local/bin/qiniu-cdn-cert.py

# 服务用同一份密钥给后台上传用
install -d -m 0755 /etc/systemd/system/tea-site-beta1.service.d
cat > /etc/systemd/system/tea-site-beta1.service.d/qiniu.conf <<'UNIT'
[Service]
EnvironmentFile=/etc/tea-site/qiniu.env
UNIT
systemctl daemon-reload

# 续期脚本里加钩子：nginx 换完证书后同步到 CDN
RENEW=/opt/acme-kompeito/renew.sh
if ! grep -q 'qiniu-cdn-cert.py' "$RENEW"; then
    cp -a "$RENEW" "$RENEW.bak-$(date +%Y%m%d-%H%M%S)"
    python3 - "$RENEW" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
hook = (
    '\n# 同步到七牛 CDN（失败只记日志，不影响 nginx 已生效的新证书）\n'
    'if [ -x /usr/local/bin/qiniu-cdn-cert.py ] || [ -f /usr/local/bin/qiniu-cdn-cert.py ]; then\n'
    '  if ! python3 /usr/local/bin/qiniu-cdn-cert.py >>"$LOG" 2>&1; then\n'
    '    echo "$(date -Is) [warn] 七牛 CDN 证书同步失败，稍后可手动跑 qiniu-cdn-cert.py" >>"$LOG"\n'
    '  fi\n'
    'fi\n\n'
)
marker = 'echo "===== $(date -Is) end =====" >>"$LOG"'
if marker not in text:
    raise SystemExit("找不到写入点")
text = text.replace(marker, hook + marker, 1)
path.write_text(text, encoding="utf-8")
print("已插入七牛同步钩子")
PY
else
    echo "钩子已存在，跳过"
fi

printf '=== 环境变量文件 ===\n'
ls -l /etc/tea-site/qiniu.env
printf '=== systemd override ===\n'
systemctl cat tea-site-beta1 | grep -A2 EnvironmentFile
printf '=== renew.sh 尾部 ===\n'
tail -n 12 /opt/acme-kompeito/renew.sh
