#!/usr/bin/env python3
"""七牛域名接入四步：取校验信息 → （外部加 TXT）→ 校验 → 创建域名 → 打印 CNAME。

用法：
  python work/qiniu-domain-flow.py info      # 打印需要加的 TXT 记录
  python work/qiniu-domain-flow.py check     # 校验 + 创建域名 + 查 CNAME
"""
import base64
import os
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

AK = os.environ.get("QINIU_AK", "")
SK = os.environ.get("QINIU_SK", "")
BUCKET = "tea-kompeito"
DOMAIN = "img.tea-kompeito.com"


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode()


def qbox(path_query):
    return "QBox " + AK + ":" + b64(hmac.new(SK.encode(), (path_query + "\n").encode(), hashlib.sha1).digest())


def qiniu_auth(method, path, body_text=""):
    lines = [f"{method} {path}", "Host: api.qiniu.com"]
    if body_text:
        lines.append("Content-Type: application/json")
    date = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    lines.append("X-Qiniu-Date: " + date)
    data = "\n".join(lines) + "\n\n" + body_text
    return "Qiniu " + AK + ":" + b64(hmac.new(SK.encode(), data.encode(), hashlib.sha1).digest()), date


def send(method, path, body=None, scheme="qbox"):
    url = "https://api.qiniu.com" + path
    text = json.dumps(body, separators=(",", ":"), ensure_ascii=False) if body is not None else ""
    request = urllib.request.Request(url, data=text.encode() if body is not None else None, method=method)
    request.add_header("Host", "api.qiniu.com")
    if scheme == "qbox":
        request.add_header("Authorization", qbox(path))
    else:
        token, date = qiniu_auth(method, path, text)
        request.add_header("Authorization", token)
        request.add_header("X-Qiniu-Date", date)
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


phase = sys.argv[1] if len(sys.argv) > 1 else "info"

if phase == "info":
    status, text = send("GET", f"/domain/{DOMAIN}/verify/info?product=cdn")
    print("verify info:", status, text)
elif phase == "check":
    status, text = send("POST", f"/domain/{DOMAIN}/verify/check", {"type": "dns", "product": "cdn"})
    print("verify check:", status, text)

    body = {
        "type": "normal", "platform": "web", "geoCover": "china", "protocol": "http",
        "source": {"sourceType": "qiniuBucket", "sourceQiniuBucket": BUCKET, "testURLPath": "/probe/hello.txt"},
        "cache": {"cacheControls": [{"time": 7, "timeunit": 0, "type": "all", "rule": "*"}]},
    }
    status, text = send("POST", f"/domain/{DOMAIN}", body, scheme="qiniu")
    print("create domain:", status, text)

    status, text = send("GET", f"/domain/{DOMAIN}", scheme="qiniu")
    print("domain info:", status, text)
