"""从作品页设计稿提取站点素材。用法：python work/build_assets.py <作品页设计稿.png>"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

OUT = Path(__file__).resolve().parents[1] / "site" / "assets" / "img"
RED = np.array([144, 69, 70], dtype=np.float32)


def crop(image, box, size=None):
    x, y = image.width / 1824, image.height / 1370
    left, top, right, bottom = box
    art = image.crop((round(left * x), round(top * y), round(right * x), round(bottom * y)))
    return art.resize(size, Image.Resampling.LANCZOS) if size else art


def save_transparent(image, alpha, name):
    image.putalpha(Image.fromarray(np.round(alpha * 255).astype(np.uint8)))
    image.save(OUT / name, lossless=True, optimize=True)


def build_assets(image):
    crop(image, (0, 0, 1824, 351), (2560, 493)).save(OUT / "hero.webp", quality=92, method=6)
    crop(image, (1433, 610, 1727, 1028), (588, 836)).save(
        OUT / "work-cover.webp", quality=92, method=6
    )
    crop(image, (0, 510, 257, 567), (514, 114)).save(OUT / "rail-top.png", optimize=True)

    title = crop(image, (20, 368, 814, 486), (1191, 177))
    pixels = np.asarray(title, dtype=np.float32)
    alpha = np.clip((pixels[:, :, 1] - RED[1]) / 82, 0, 1)
    unblended = (pixels - RED * (1 - alpha[:, :, None])) / np.maximum(alpha[:, :, None], 0.01)
    title = Image.fromarray(np.clip(unblended, 0, 255).astype(np.uint8))
    save_transparent(title, alpha, "brand.webp")

    paper = crop(image, (450, 1230, 1210, 1316), (760, 86))
    texture = Image.new("RGB", (1520, 172))
    texture.paste(paper)
    texture.paste(ImageOps.mirror(paper), (760, 0))
    texture.paste(ImageOps.flip(texture.crop((0, 0, 1520, 86))), (0, 86))
    texture.save(OUT / "paper.webp", quality=94, method=6)

    stairs = crop(image, (0, 1030, 274, 1370), (548, 680))
    pixels = np.asarray(stairs, dtype=np.float32)
    alpha = np.clip((pixels[:, :, 1] - 91) / 105, 0, 1)
    # The original paper panel enters the crop at x=517, above the last step.
    alpha[:628, 514:] = 0
    save_transparent(stairs, alpha, "stairs.png")

    flowers = crop(image, (1490, 1148, 1824, 1370), (668, 444))
    mask = Image.new("L", flowers.size)
    outlines = (
        [(15, 180), (18, 165), (34, 168), (39, 155), (45, 158), (48, 145), (56, 151),
         (60, 143), (69, 148), (73, 142), (80, 149), (84, 161), (91, 165), (94, 177),
         (87, 187), (88, 197), (78, 209), (68, 204), (61, 210), (54, 203), (47, 209),
         (36, 203), (27, 201)],
        [(173, 184), (178, 174), (190, 175), (193, 154), (200, 155), (209, 164),
         (216, 155), (222, 157), (226, 176), (235, 186), (232, 193), (239, 207),
         (232, 213), (221, 208), (213, 211), (206, 205), (196, 215), (185, 211),
         (177, 201), (176, 192)],
        [(259, 194), (266, 185), (276, 187), (276, 176), (289, 176), (296, 167),
         (305, 174), (314, 169), (320, 175), (325, 187), (331, 193), (326, 204),
         (332, 216), (329, 222), (273, 222), (268, 213)],
        [(263, 126), (268, 113), (273, 107), (272, 97), (280, 93), (289, 99),
         (296, 91), (299, 98), (311, 96), (315, 100), (327, 105), (328, 112),
         (334, 119), (331, 126), (334, 132), (325, 140), (328, 149), (318, 157),
         (308, 156), (302, 162), (293, 156), (284, 161), (278, 154), (279, 146),
         (267, 137)],
        [(271, 47), (275, 36), (282, 30), (281, 21), (290, 22), (294, 12),
         (304, 18), (309, 11), (318, 15), (323, 9), (330, 14), (334, 23),
         (334, 67), (328, 65), (321, 60), (315, 67), (307, 78), (298, 81),
         (294, 73), (287, 64), (286, 54), (274, 54)],
    )
    draw = ImageDraw.Draw(mask)
    for outline in outlines:
        draw.polygon([(x * 2, y * 2) for x, y in outline], fill=255)
    pixels = np.asarray(flowers, dtype=np.float32)
    keep = np.clip((38 - (pixels[:, :, 0] - pixels[:, :, 2])) / 12, 0, 1)
    # The ivory flower has warm petals. Its polygon alone protects their color.
    keep[:, :200] = 1
    alpha = np.asarray(mask.filter(ImageFilter.GaussianBlur(0.75)), dtype=np.float32) / 255
    save_transparent(flowers, alpha * keep, "flowers.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("draft", type=Path)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with Image.open(args.draft) as draft:
        build_assets(draft.convert("RGB"))
