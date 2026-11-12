#!/usr/bin/env bash
# 验证后台封面上传会真的进七牛：直接用发布目录里的模块跑一次上传 → HEAD → 删掉
set -euo pipefail
cd /opt/tea-site-beta1/current
set -a
. /etc/tea-site/qiniu.env
set +a

node --input-type=module -e '
import { qiniuConfigured, uploadImage } from "/opt/tea-site-beta1/current/server/qiniu.mjs";

console.log("qiniuConfigured:", qiniuConfigured());
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const url = await uploadImage(png, "png", "image/png");
console.log("uploaded:", url);
const head = await fetch(url, { method: "HEAD" });
console.log("HEAD:", head.status, "cache-control=", head.headers.get("cache-control"), "type=", head.headers.get("content-type"));
const bad = await uploadImage(Buffer.from("not an image"), "png", "image/png").then(() => false).catch(() => true);
console.log("非图片内容会被拒绝之外的错误处理由调用方判断（这里只确认上传函数会抛错）:", bad);
const key = url.split("/uploads/")[1];
await fetch("https://img.tea-kompeito.com/", { method: "GET" });
const { createHmac, createHash } = await import("node:crypto");
const b64 = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const entry = b64(Buffer.from(process.env.QINIU_BUCKET + ":" + "uploads/" + key));
const sign = b64(createHmac("sha1", process.env.QINIU_SK).update(entry).digest());
const del = await fetch("https://rs.qiniu.com/delete/" + entry, {
  method: "POST",
  headers: { Authorization: "QBox " + process.env.QINIU_AK + ":" + sign },
});
console.log("cleanup delete:", del.status, (await del.text()).slice(0, 80));
' 2>&1
