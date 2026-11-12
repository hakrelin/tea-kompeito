#!/usr/bin/env python3
"""把作品封面（原图 + 缩略图）传上七牛，并可选地批量核对公开访问。

用法：
  python work/qiniu-upload.py upload    # 上传 site/assets/catalog-covers 下全部 webp
  python work/qiniu-upload.py verify    # 逐个 HEAD 校验 https://img.tea-kompeito.com/covers/<name>
"""
import base64
import os
import concurrent.futures
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

AK = os.environ.get("QINIU_AK", "")
SK = os.environ.get("QINIU_SK", "")
BUCKET = "tea-kompeito"
BASE = "https://img.tea-kompeito.com"
PREFIX = "covers"
LOCAL = Path(__file__).resolve().parents[1] / "site" / "assets" / "catalog-covers"
CACHE = "public, max-age=2592000"


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode()


def upload_token(key, ttl=3600):
    policy = {"scope": f"{BUCKET}:{key}", "deadline": int(time.time()) + ttl, "insertOnly": 0}
    encoded = b64(json.dumps(policy, separators=(",", ":")).encode())
    return AK + ":" + b64(hmac.new(SK.encode(), encoded.encode(), hashlib.sha1).digest()) + ":" + encoded


def upload(path):
    key = PREFIX + "/" + path.name
    boundary = "----tea" + hashlib.sha1(path.name.encode()).hexdigest()[:12]
    body = b""
    for name, value in [("token", upload_token(key)), ("key", key),
                        ("x-qn-meta-Cache-Control", CACHE)]:
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
             f"Content-Type: image/webp\r\n\r\n").encode()
    body += path.read_bytes() + b"\r\n" + f"--{boundary}--\r\n".encode()
    request = urllib.request.Request("https://upload-z0.qiniup.com/", data=body, method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return path.name, response.status, ""
        except urllib.error.HTTPError as error:
            return path.name, error.code, error.read().decode("utf-8", "replace")[:160]
        except Exception as error:  # 超时/连接重置：重试
            if attempt == 2:
                return path.name, 0, str(error)[:120]
            time.sleep(2)
    return path.name, 0, "retries exhausted"


def head(url):
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return url, response.status, response.headers.get("Cache-Control", "")
    except urllib.error.HTTPError as error:
        return url, error.code, ""


mode = sys.argv[1] if len(sys.argv) > 1 else "upload"
files = sorted(LOCAL.glob("*.webp"))

if mode == "upload":
    print(f"== 上传 {len(files)} 个文件到 oss://{BUCKET}/{PREFIX}/ ==")
    started = time.time()
    ok = fail = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for name, status, detail in pool.map(upload, files):
            if status == 200:
                ok += 1
            else:
                fail += 1
                print("  失败", name, status, detail)
    print(f"  成功 {ok}，失败 {fail}，用时 {time.time() - started:.1f}s")
else:
    print(f"== 校验 {len(files)} 个公开地址 ==")
    bad = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for url, status, cache in pool.map(head, [f"{BASE}/{PREFIX}/{p.name}" for p in files]):
            if status != 200:
                bad += 1
                print("  ", status, url)
    print(f"  非 200 的数量：{bad}")
    sample = f"{BASE}/{PREFIX}/{files[0].name}"
    print("  样例:", *head(sample))
