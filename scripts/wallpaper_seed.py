#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Windows 壁纸提取主题种子色（算法验证用，与 Rust 侧实现保持一致）。

思路：解码 → 缩小 → 逐像素转 OkLCh → 按色相分桶累积（彩度加权）
     → 选加权最高的桶 → 桶内取代表色 → 返回其色相与彩度。
"""
import colorsys
import math
import sys
from collections import defaultdict

from PIL import Image

WALLPAPER = sys.argv[1] if len(sys.argv) > 1 else r"E:\Downloads\1786363942783.jpeg"


# ---------- sRGB <-> OkLab ----------

def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def rgb_to_oklab(r: float, g: float, b: float):
    lr, lg, lb = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
    m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
    s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
    l_, m_, s_ = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def oklab_to_rgb(L: float, a: float, b: float):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return linear_to_srgb(lr), linear_to_srgb(lg), linear_to_srgb(lb)


def rgb_to_oklch(r, g, b):
    L, a, bb = rgb_to_oklab(r, g, b)
    C = math.hypot(a, bb)
    H = math.degrees(math.atan2(bb, a)) % 360
    return L, C, H


def oklch_to_rgb(L, C, H):
    hr = math.radians(H)
    return oklab_to_rgb(L, C * math.cos(hr), C * math.sin(hr))


def in_gamut(r, g, b, eps=1e-4):
    return all(-eps <= v <= 1 + eps for v in (r, g, b))


def clip_rgb(r, g, b):
    return tuple(min(1.0, max(0.0, v)) for v in (r, g, b))


def max_chroma(L, H):
    """二分求该亮度/色相下 sRGB 内可达的最大彩度。"""
    lo, hi = 0.0, 0.4
    for _ in range(18):
        mid = (lo + hi) / 2
        if in_gamut(*oklch_to_rgb(L, mid, H)):
            lo = mid
        else:
            hi = mid
    return lo


def to_hex(r, g, b):
    r, g, b = clip_rgb(r, g, b)
    return "#{:02X}{:02X}{:02X}".format(round(r * 255), round(g * 255), round(b * 255))


# ---------- 主色提取 ----------

def extract_seed(path: str):
    img = Image.open(path).convert("RGB")
    img.thumbnail((160, 160), Image.LANCZOS)

    bins = defaultdict(float)
    stats = defaultdict(lambda: [0.0, 0.0, 0.0])  # 累计 C, a, b
    total = 0
    for px in img.getdata():
        r, g, b = (v / 255 for v in px)
        L, C, H = rgb_to_oklch(r, g, b)
        total += 1
        if not (0.16 <= L <= 0.92):
            continue
        if C < 0.035:                      # 近灰像素不参与
            continue
        weight = C ** 1.6
        idx = int(H // 15) % 24
        bins[idx] += weight
        acc = stats[idx]
        acc[0] += C * weight
        acc[1] += math.cos(math.radians(H)) * weight
        acc[2] += math.sin(math.radians(H)) * weight

    if not bins:
        return None
    best = max(bins, key=lambda k: bins[k])
    acc = stats[best]
    w = bins[best]
    meanC = acc[0] / w
    meanH = math.degrees(math.atan2(acc[2], acc[1])) % 360
    return {
        "bucket": best,
        "weight": w,
        "totalPixels": total,
        "coverage": w / total,
        "chroma": meanC,
        "hue": meanH,
    }


def build_palette(hue: float, chroma: float):
    """按 MD3 的 tone 分布生成 11 级色调板（L 固定、C 按可达上限缩放）。"""
    max_c = max(chroma * 1.15, 0.06)
    tones = []
    for L in [0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0]:
        if L <= 0.001:
            tones.append("#000000")
            continue
        if L >= 0.999:
            tones.append("#FFFFFF")
            continue
        c = min(max_c, max_chroma(L, hue))
        tones.append(to_hex(*oklch_to_rgb(L, c, hue)))
    return tones


def main():
    seed = extract_seed(WALLPAPER)
    print("wallpaper:", WALLPAPER)
    print("seed:", seed)
    if not seed:
        return
    hue, chroma = seed["hue"], seed["chroma"]
    print("hue=%.1f chroma=%.4f" % (hue, chroma))
    print("primary tones:", build_palette(hue, chroma))

    # 对比：直接用 Python 标准库取 HSV 主色（老式做法），用于评估差异
    img = Image.open(WALLPAPER).convert("RGB")
    img.thumbnail((80, 80))
    hsv_bins = defaultdict(float)
    for px in img.getdata():
        h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in px))
        if s < 0.15 or v < 0.12:
            continue
        hsv_bins[int(h * 24) % 24] += s * v
    if hsv_bins:
        best = max(hsv_bins, key=lambda k: hsv_bins[k])
        print("hsv dominant hue bucket:", best * 15, "deg")


if __name__ == "__main__":
    main()
