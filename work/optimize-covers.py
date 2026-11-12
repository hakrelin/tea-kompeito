#!/usr/bin/env python3
"""把作品封面压到适合网页的尺寸，并额外生成一张网格用缩略图。

- 原图：等比缩到宽 ≤ 480px，webp q=74（详情栏最大约 290 CSS px，1.6x 屏够用）
- 缩略图：宽 ≤ 300px，webp q=68，文件名 <id>-t.webp（首页网格只有约 230 CSS px）

重复执行是幂等的：已经是目标尺寸且缩略图已存在时跳过。
用法：python work/optimize-covers.py [封面目录]
"""
import sys
from pathlib import Path

from PIL import Image

FULL_MAX_WIDTH = 480
FULL_QUALITY = 74
THUMB_MAX_WIDTH = 240
THUMB_QUALITY = 62


def resize_to(im, max_width):
    if im.width <= max_width:
        return im
    height = round(im.height * max_width / im.width)
    return im.resize((max_width, height), Image.Resampling.LANCZOS)


def main():
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else "site/assets/catalog-covers")
    covers = sorted(p for p in directory.glob("*.webp") if not p.stem.endswith("-t"))
    if not covers:
        raise SystemExit(f"没有找到封面：{directory}")

    before = after = 0
    for path in covers:
        thumb_path = path.with_name(path.stem + "-t.webp")
        with Image.open(path) as opened:
            image = opened.convert("RGB")

        before += path.stat().st_size
        if image.width > FULL_MAX_WIDTH or not thumb_path.exists():
            resize_to(image, FULL_MAX_WIDTH).save(path, "WEBP", quality=FULL_QUALITY, method=6)
        after += path.stat().st_size

        if not thumb_path.exists():
            resize_to(image, THUMB_MAX_WIDTH).save(thumb_path, "WEBP", quality=THUMB_QUALITY, method=6)

    full = sum(p.stat().st_size for p in covers)
    thumbs = sum(p.with_name(p.stem + "-t.webp").stat().st_size for p in covers)
    print(f"封面 {len(covers)} 张：原 {before / 1048576:.2f} MB → 现在 {full / 1048576:.2f} MB")
    print(f"缩略图合计 {thumbs / 1048576:.2f} MB（平均 {thumbs / len(covers) / 1024:.1f} KB）")
    print(f"网格首屏 16 张缩略图约 {16 * thumbs / len(covers) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
