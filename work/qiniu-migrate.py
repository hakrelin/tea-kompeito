#!/usr/bin/env python3
"""把站点图片迁到七牛 CDN，并把引用改成 https://img.tea-kompeito.com/...

用法：
  python work/qiniu-migrate.py upload   # 上传站点切图（封面已另外传过）
  python work/qiniu-migrate.py rewrite  # 改写 content-default.js / index.html / content-view.js
  python work/qiniu-migrate.py live <content.js>  # 服务器上改写线上 content.js
"""
import base64
import os
import hashlib
import hmac
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

AK = os.environ.get("QINIU_AK", "")
SK = os.environ.get("QINIU_SK", "")
BUCKET = "tea-kompeito"
BASE = "https://img.tea-kompeito.com"
ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "site" / "assets" / "img"
SITE_IMAGES = ["hero.webp", "brand.webp", "work-cover.webp", "flowers.png", "stairs.png", "rail-top.png"]
CACHE = "public, max-age=2592000"
PREFIX = "window.TEA_CONTENT = "


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode()


def token(key):
    policy = {"scope": f"{BUCKET}:{key}", "deadline": int(time.time()) + 3600, "insertOnly": 0}
    encoded = b64(json.dumps(policy, separators=(",", ":")).encode())
    return AK + ":" + b64(hmac.new(SK.encode(), encoded.encode(), hashlib.sha1).digest()) + ":" + encoded


def upload(path):
    key = "site/" + path.name
    boundary = "----tea" + hashlib.sha1(key.encode()).hexdigest()[:12]
    body = b""
    for name, value in [("token", token(key)), ("key", key), ("x-qn-meta-Cache-Control", CACHE)]:
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    mime = "image/png" if path.suffix == ".png" else "image/webp"
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
             f"Content-Type: {mime}\r\n\r\n").encode()
    body += path.read_bytes() + b"\r\n" + f"--{boundary}--\r\n".encode()
    request = urllib.request.Request("https://upload-z0.qiniup.com/", data=body, method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return path.name, response.status, ""
    except urllib.error.HTTPError as error:
        return path.name, error.code, error.read().decode("utf-8", "replace")[:160]


def migrate_content(path, dry=False):
    text = path.read_text(encoding="utf-8")
    start = text.index(PREFIX) + len(PREFIX)
    body = text[start:].strip()
    if body.endswith(";"):
        body = body[:-1]
    content = json.loads(body)
    changed = 0

    def cdn(remote_dir, value):
        match = re.match(r"^assets/(?:catalog-covers|img)/(.+)$", value or "")
        if not match:
            return value
        directory = "covers" if remote_dir == "covers" else "site"
        return f"{BASE}/{directory}/{match.group(1)}"

    for work in content["works"]:
        for field in ("cover", "thumb"):
            before = work.get(field) or ""
            after = cdn("covers", before)
            if after != before:
                work[field] = after
                changed += 1
    for field in ("brand", "banner"):
        before = content["settings"].get(field) or ""
        after = cdn("site", before)
        if after != before:
            content["settings"][field] = after
            changed += 1

    if changed and not dry:
        path.with_suffix(path.suffix + ".bak").write_text(text, encoding="utf-8")
        path.write_text(PREFIX + json.dumps(content, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(f"{path.name}: 改写 {changed} 处" + ("（预览，未写盘）" if dry else ""))


def migrate_html(dry=False):
    changed = 0
    targets = {"index.html": SITE_IMAGES, "assets/js/content-view.js": ["work-cover.webp"]}
    for relative, names in targets.items():
        path = ROOT / "site" / relative
        text = path.read_text(encoding="utf-8")
        for name in names:
            text, count = re.subn(rf'"/assets/img/{re.escape(name)}"', f'"{BASE}/site/{name}"', text)
            text, count2 = re.subn(rf'"(?:\.\./)?img/{re.escape(name)}"', f'"{BASE}/site/{name}"', text)
            text, count3 = re.subn(rf'"assets/img/{re.escape(name)}"', f'"{BASE}/site/{name}"', text)
            changed += count + count2 + count3
        if not dry:
            path.write_text(text, encoding="utf-8")
    print(f"站点页面与脚本: 改写 {changed} 处" + ("（预览，未写盘）" if dry else ""))


mode = sys.argv[1] if len(sys.argv) > 1 else "rewrite"

if mode == "upload":
    print(f"== 上传 {len(SITE_IMAGES)} 张站点切图 ==")
    for name in SITE_IMAGES:
        path = IMG / name
        if not path.exists():
            print("  跳过（不存在）", name)
            continue
        print("  ", *upload(path))
elif mode == "rewrite":
    migrate_content(ROOT / "content-default.js")
    migrate_html()
elif mode == "live":
    migrate_content(Path(sys.argv[2]))
