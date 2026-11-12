#!/usr/bin/env bash
# 把作品封面搬到对象存储（OSS），并把内容里的地址改成 OSS 域名。
#
# 前置：本机或服务器装了 aliyun CLI 且已配置有 OSS 权限的 AccessKey
#       （aliyun configure；或 /root/.aliyun/config.json）。
#       这台账号目前建桶返回 UserDisable，需要先在 OSS 控制台开通服务。
#
# 用法：
#   BUCKET=tea-kompeito-img BASE=https://img.example.com \
#     bash work/publish-covers-to-oss.sh /opt/tea-site-beta1/current
#
#   BUCKET      桶名（必须已存在）
#   BASE        对外访问前缀：绑定的自定义域名，或 https://<桶>.<地域>.aliyuncs.com
#   PREFIX      桶内目录，默认 catalog-covers
#   SITE        站点目录（含 site/ 和 content-default.js），默认 $1
#
# 做完后：把改动过的 content-default.js 部署上去，并清掉浏览器缓存里的旧封面。
set -euo pipefail

SITE="${1:-/opt/tea-site-beta1/current}"
BUCKET="${BUCKET:?需要 BUCKET=桶名}"
BASE="${BASE:?需要 BASE=https://<域名或 OSS 外网地址>}"
PREFIX="${PREFIX:-catalog-covers}"
CACHE="max-age=2592000"
COVERS="$SITE/site/assets/catalog-covers"

[ -d "$COVERS" ] || { echo "找不到封面目录：$COVERS" >&2; exit 1; }

echo "== 上传 $(find "$COVERS" -name '*.webp' | wc -l) 张封面到 oss://$BUCKET/$PREFIX/ =="
aliyun oss cp "$COVERS/" "oss://$BUCKET/$PREFIX/" \
    --recursive --force --acl public-read --meta "Cache-Control:$CACHE" |
    tail -n 3

echo "== 抽查一张能否公开访问 =="
SAMPLE=$(find "$COVERS" -name '*-t.webp' | head -n 1 | xargs -n1 basename)
curl -fsS -o /dev/null -w "  $BASE/$PREFIX/$SAMPLE -> %{http_code} %{size_download}B\n" \
    "$BASE/$PREFIX/$SAMPLE"

echo "== 改写 content-default.js 里的封面地址 =="
node - "$SITE/content-default.js" "$BASE/$PREFIX/" <<'NODE'
const fs = require("node:fs");
const [file, base] = process.argv.slice(2);
const text = fs.readFileSync(file, "utf8");
const head = text.slice(0, text.indexOf("=") + 1);
const content = JSON.parse(text.slice(text.indexOf("=") + 1).trim().replace(/;\s*$/, ""));

let changed = 0;
const toRemote = (value) => {
  if (!value || !value.startsWith("assets/catalog-covers/")) return value;
  changed += 1;
  return base + value.slice("assets/catalog-covers/".length);
};

for (const work of content.works) {
  work.cover = toRemote(work.cover);
  work.thumb = toRemote(work.thumb);
}

fs.writeFileSync(file + ".bak", text);
fs.writeFileSync(file, head + " " + JSON.stringify(content, null, 2) + ";\n");
console.log(`  改写 ${changed} 个地址，原文件备份为 ${file}.bak`);
NODE

echo "== 完成 =="
echo "  下一步：部署 $SITE/content-default.js；若刚切域名，确认 DNS CNAME 与 OSS 自定义域名已生效。"
echo "  回滚：mv content-default.js.bak content-default.js"
