import { createHash, createHmac } from "node:crypto";

// 七牛对象存储上传（后台上传的公开封面直接进对象存储，不再落主服务器）
// 需要的环境变量：QINIU_AK / QINIU_SK，可选 QINIU_BUCKET / QINIU_PUBLIC_BASE / QINIU_UPLOAD_HOST
function config() {
  const ak = process.env.QINIU_AK;
  const sk = process.env.QINIU_SK;
  if (!ak || !sk) return null;
  return {
    ak,
    sk,
    bucket: process.env.QINIU_BUCKET || "tea-kompeito",
    base: (process.env.QINIU_PUBLIC_BASE || "https://img.tea-kompeito.com").replace(/\/+$/, ""),
    host: process.env.QINIU_UPLOAD_HOST || "upload-z0.qiniup.com",
    prefix: (process.env.QINIU_UPLOAD_PREFIX || "uploads").replace(/^\/+|\/+$/g, ""),
  };
}

export const qiniuConfigured = () => Boolean(config());

const urlsafe = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

function uploadToken(cfg, key) {
  const policy = JSON.stringify({
    scope: cfg.bucket + ":" + key,
    deadline: Math.floor(Date.now() / 1000) + 600,
    insertOnly: 0,
  });
  const encoded = urlsafe(Buffer.from(policy, "utf8"));
  const signature = urlsafe(createHmac("sha1", cfg.sk).update(encoded).digest());
  return cfg.ak + ":" + signature + ":" + encoded;
}

/** 上传一张图片，返回可公开访问的 URL；未配置七牛时返回 null 交给调用方回落本地。 */
export async function uploadImage(bytes, extension, mime) {
  const cfg = config();
  if (!cfg) return null;
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const name = digest + "." + extension;
  const key = cfg.prefix ? cfg.prefix + "/" + name : name;

  const form = new FormData();
  form.set("token", uploadToken(cfg, key));
  form.set("key", key);
  form.set("x-qn-meta-Cache-Control", "public, max-age=2592000");
  form.set("file", new Blob([bytes], { type: mime }), name);

  const response = await fetch("https://" + cfg.host + "/", { method: "POST", body: form });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 160);
    throw new Error("七牛上传失败：" + response.status + " " + detail);
  }
  return cfg.base + "/" + key;
}
