#!/usr/bin/env python3
"""把当前 nginx 证书同步到七牛 CDN（换证书 / 续期后自动调用）。

用法：
  qiniu_cdn_cert.py [fullchain.crt] [private.key]

- 读 /etc/tea-site/qiniu.env 取 AK/SK 与 CDN 域名（文件 600，只有 root 可读）
- 先比对 CDN 上已绑定的证书与本机是否一致，一致就直接退出（可反复调用）
- 不一致则：私钥转 PKCS#8 → POST /sslcert 拿 certID → PUT /domain/<域名>/httpsconf → 删旧证书
失败会以非 0 退出，但不影响 nginx 已经生效的新证书。
"""
import base64
import hashlib
import hmac
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
from pathlib import Path
import urllib.request

ENV_FILE = Path("/etc/tea-site/qiniu.env")
DEFAULT_CERT = Path("/etc/nginx/ssl/tea-kompeito.com/fullchain.crt")
DEFAULT_KEY = Path("/etc/nginx/ssl/tea-kompeito.com/private.key")


def log(message):
    print(f"[qiniu-cert] {time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}", flush=True)


def read_env():
    values = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode()


def qbox(path, env):
    raw = (path + "\n").encode()
    signature = hmac.new(env["QINIU_SK"].encode(), raw, hashlib.sha1).digest()
    return "QBox " + env["QINIU_AK"] + ":" + b64(signature)


def qiniu_auth(method, path, body_text, env):
    lines = [f"{method} {path}", "Host: api.qiniu.com"]
    if body_text:
        lines.append("Content-Type: application/json")
    date = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    lines.append("X-Qiniu-Date: " + date)
    data = "\n".join(lines) + "\n\n" + body_text
    signature = hmac.new(env["QINIU_SK"].encode(), data.encode(), hashlib.sha1).digest()
    return "Qiniu " + env["QINIU_AK"] + ":" + b64(signature), date


def call(method, host, path, env, body=None, scheme="qiniu"):
    text = json.dumps(body, separators=(",", ":"), ensure_ascii=False) if body is not None else ""
    request = urllib.request.Request(f"https://{host}{path}",
                                     data=text.encode() if body is not None else None, method=method)
    request.add_header("Host", host)
    if scheme == "qbox":
        request.add_header("Authorization", qbox(path, env))
    else:
        token, date = qiniu_auth(method, path, text, env)
        request.add_header("Authorization", token)
        request.add_header("X-Qiniu-Date", date)
    if text:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


def normalize_pem(text):
    return "".join(line.strip() for line in (text or "").splitlines()
                   if line.strip() and not line.startswith("-----"))


def main():
    args = [item for item in sys.argv[1:] if not item.startswith("--")]
    force = "--force" in sys.argv
    cert_path = Path(args[0]) if len(args) > 0 else DEFAULT_CERT
    key_path = Path(args[1]) if len(args) > 1 else DEFAULT_KEY
    if not cert_path.exists() or not key_path.exists():
        log(f"证书文件不存在：{cert_path} / {key_path}")
        return 1

    env = read_env()
    for name in ("QINIU_AK", "QINIU_SK", "CDN_DOMAIN"):
        if not env.get(name):
            log(f"{ENV_FILE} 缺少 {name}")
            return 1
    domain = env["CDN_DOMAIN"]
    chain = cert_path.read_text(encoding="utf-8")

    # 1) CDN 上现在绑的是哪张证书
    status, text = call("GET", "api.qiniu.com", f"/domain/{domain}", env)
    if status != 200:
        log(f"查询域名失败 {status} {text[:160]}")
        return 1
    current_id = (json.loads(text).get("https") or {}).get("certId") or ""

    if current_id:
        status, text = call("GET", "fusion.qiniuapi.com", f"/sslcert/{current_id}", env, scheme="qbox")
        if status == 200:
            try:
                existing = json.loads(text)["cert"].get("ca", "")
            except Exception:
                existing = ""
            if existing and normalize_pem(existing) == normalize_pem(chain) and not force:
                log(f"CDN 证书已是最新（certId {current_id}），跳过")
                return 0

    # 2) 私钥转 PKCS#8 后上传
    with tempfile.NamedTemporaryFile("w+", suffix=".pem", delete=False) as handle:
        key8_path = handle.name
    subprocess.run(["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", str(key_path), "-out", key8_path],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    key8 = Path(key8_path).read_text(encoding="utf-8")
    try:
        Path(key8_path).unlink()
    except OSError:
        pass

    name = f"{domain}-{time.strftime('%Y%m%d')}-{hashlib.sha1(chain.encode()).hexdigest()[:8]}"
    status, text = call("POST", "fusion.qiniuapi.com", "/sslcert", env,
                        {"name": name, "pri": key8, "ca": chain}, scheme="qbox")
    if status != 200:
        log(f"上传证书失败 {status} {text[:200]}")
        return 1
    cert_id = json.loads(text).get("certID", "")
    if not cert_id:
        log(f"上传证书没有返回 certID：{text[:200]}")
        return 1

    # 3) 绑到 CDN 域名
    status, text = call("PUT", "api.qiniu.com", f"/domain/{domain}/httpsconf", env,
                        {"certId": cert_id, "forceHttps": False, "http2Enable": True})
    if status != 200:
        log(f"绑定证书失败 {status} {text[:200]}")
        return 1
    log(f"已换绑 certId {cert_id}（旧 {current_id or '无'}）")

    # 4) 清理旧证书：CDN 换绑要 5-10 分钟生效，过早删会报「证书已绑定域名」，
    #    所以只清理一天前的、且不是当前绑定的证书。
    status, text = call("GET", "fusion.qiniuapi.com", "/sslcert?marker=&limit=50", env, scheme="qbox")
    if status == 200:
        cutoff = time.time() - 24 * 3600
        try:
            certs = json.loads(text).get("certs") or []
        except Exception:
            certs = []
        for item in certs:
            cert_id_old = item.get("certid") or ""
            if not cert_id_old or cert_id_old == cert_id:
                continue
            if (item.get("create_time") or 0) > cutoff:
                continue
            code, detail = call("DELETE", "fusion.qiniuapi.com", f"/sslcert/{cert_id_old}", env, scheme="qbox")
            log(f"清理旧证书 {cert_id_old}: {code} {detail[:100]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
