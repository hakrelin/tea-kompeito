#!/usr/bin/env python3
"""鍦ㄦ湇鍔″櫒涓婅窇锛氭妸鐜版湁娉涘煙鍚嶈瘉涔︿紶鍒颁竷鐗涳紝鍐嶇粰 img 鍩熷悕寮€鍚?HTTPS銆?
鐢ㄦ硶锛堟湇鍔″櫒锛夛細
  python3 qiniu-https-server.py /etc/nginx/ssl/tea-kompeito.com/fullchain.crt /etc/nginx/ssl/tea-kompeito.com/private.key
"""
import base64
import os
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

AK = os.environ.get("QINIU_AK", "")
SK = os.environ.get("QINIU_SK", "")
DOMAIN = "img.tea-kompeito.com"


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode()


def send(method, path, body=None, host="api.qiniu.com", scheme="qiniu"):
    text = json.dumps(body, separators=(",", ":"), ensure_ascii=False) if body is not None else ""
    request = urllib.request.Request(f"https://{host}{path}",
                                     data=text.encode() if body is not None else None, method=method)
    request.add_header("Host", host)
    if scheme == "qbox":
        request.add_header("Authorization", "QBox " + AK + ":" +
                           b64(hmac.new(SK.encode(), (path + "\n").encode(), hashlib.sha1).digest()))
    else:
        lines = [f"{method} {path}", f"Host: {host}"]
        if text:
            lines.append("Content-Type: application/json")
        date = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        lines.append("X-Qiniu-Date: " + date)
        data = "\n".join(lines) + "\n\n" + text
        request.add_header("Authorization", "Qiniu " + AK + ":" +
                           b64(hmac.new(SK.encode(), data.encode(), hashlib.sha1).digest()))
        request.add_header("X-Qiniu-Date", date)
    if text:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


cert_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/nginx/ssl/tea-kompeito.com/fullchain.crt")
key_path = Path(sys.argv[2] if len(sys.argv) > 2 else "/etc/nginx/ssl/tea-kompeito.com/private.key")
cert, key = cert_path.read_text(), key_path.read_text()

status, text = send("GET", "/sslcert?marker=&limit=10", host="fusion.qiniuapi.com", scheme="qbox")
print("璇佷功鍒楄〃:", status, text[:300])

cert_id = ""
for field in ("pri", "key"):
    body = {"name": "wildcard-tea-kompeito-" + time.strftime("%Y%m%d%H%M"),
            "common_name": DOMAIN, "ca": "letsencrypt", "cert": cert, field: key}
    status, text = send("POST", "/sslcert", body, host="fusion.qiniuapi.com", scheme="qbox")
    print(f"涓婁紶璇佷功({field}):", status, text[:300])
    if status == 200:
        try:
            data = json.loads(text)
            cert_id = data.get("certID") or data.get("certId") or ""
        except Exception:
            pass
        if cert_id:
            break

if cert_id:
    status, text = send("PUT", f"/domain/{DOMAIN}/sslize",
                        {"certId": cert_id, "forceHttps": False, "http2Enable": True})
    print("sslize:", status, text[:300])
else:
    print("娌℃湁鎷垮埌 certId锛屽仠姝?)
