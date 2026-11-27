"""The README's link strip under the banner: one picture per link (GitHub can't underline or colour a picture), joined
into one strip as wide as the banner (980 px). It is more of the banner's floor: each link a concrete slab in the
floor's tones and grain (2 px pixels), the slabs parted by the floor's own joint. The icons are the headings' own
(assets/icons/h). Under it a lower row of the same floor: the language switch and what the badges said (the release, the
Obsidian it needs, the licence), each with a pixel square in its old badge colour. Writes assets/nav/<lang>-<name>.svg
for English and Traditional Chinese.

    python3 scripts/readme-nav.py
"""
import os
import random
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "assets", "icons", "h")
OUT = os.path.join(ROOT, "assets", "nav")

SLABS = ["#1B1C24", "#1D1E26", "#1A1B22"]          # the banner's floor (scripts/readme-banner.py, floor())
DARK, LIGHT, JOINT, JOINTL, TEXT = "#191A21", "#20212A", "#15161C", "#22232C", "#E6E3DC"
WIDTH, ACCENT = 980, None   # ACCENT: a colour for a line along the bottom, or None
FONT = "-apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif"
H, SIZE, GAP = 36, 14, 7

LINKS = {
    "en": ["Why Vellum", "Install", "Quick start", "With your agent", "File format", "Shortcuts", "FAQ"],
    "zh": ["為何選 Vellum", "安裝", "快速開始", "搭配 agent", "檔案格式", "快捷鍵", "常見問題"],
}
ICON_OF = ["star", "download", "play", "robot", "braces", "keyboard", "question"]
# the lower row: (file name, label, square colour; None: a language, the one shown is orange text)
META = {
    "en": [("lang-en", "English", None), ("lang-zh", "繁體中文", None), ("release", "Latest release", "#E9892B"), ("obsidian", "Obsidian 1.6.6+", "#7C3AED"), ("license", "MIT license", "#A3CF7E")],
    "zh": [("lang-en", "English", None), ("lang-zh", "繁體中文", None), ("release", "最新版本", "#E9892B"), ("obsidian", "Obsidian 1.6.6 以上", "#7C3AED"), ("license", "MIT 授權", "#A3CF7E")],
}
META_H, META_SIZE, DIM, ORANGE = 28, 12, "#96969B", "#E9892B"

# advance widths (of 1000) of a semibold sans, enough to size a segment; CJK is one em
NARROW, WIDE = set("fijlrt "), {"m": 833, "w": 722, "W": 944}


def text_width(t: str, size: int = SIZE) -> float:
    w = 0
    for c in t:
        if ord(c) > 0x2E80: w += 1000
        elif c in NARROW: w += 278
        elif c in WIDE: w += WIDE[c]
        elif c.isupper(): w += 667
        else: w += 556
    return w * size / 1000 * 1.07


def icon(name: str, x: int, y: int):
    svg = open(os.path.join(ICONS, name + ".svg"), encoding="utf-8").read()
    vw, vh = map(int, re.search(r'viewBox="0 0 (\d+) (\d+)"', svg).groups())
    rects = re.findall(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#\w+)"/>', svg)
    body = "".join(f'<rect x="{x + int(a)}" y="{y + int(b)}" width="{w}" height="{h}" fill="{f}"/>' for a, b, w, h, f in rects)
    return body, vw, vh


def content_width(name: str, label: str) -> float:
    return icon(name, 0, 0)[1] + GAP + text_width(label)


def slab(W: int, H: int, i: int, last: bool, seed: int) -> str:
    """the floor's tone and grain in 2 px pixels, its joint on the right (none on the last)"""
    rnd = random.Random(seed)
    base = SLABS[(i * 7) % 3]
    body = f'<rect width="{W}" height="{H}" fill="{base}"/>'
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            n = rnd.random()
            if n < 0.06: body += f'<rect x="{x}" y="{y}" width="2" height="2" fill="{DARK}"/>'
            elif n > 0.965: body += f'<rect x="{x}" y="{y}" width="2" height="2" fill="{LIGHT}"/>'
    if not last: body += f'<rect x="{W - 4}" width="2" height="{H}" fill="{JOINT}"/><rect x="{W - 2}" width="2" height="{H}" fill="{JOINTL}"/>'
    if ACCENT: body += f'<rect y="{H - 2}" width="{W}" height="2" fill="{ACCENT}"/>'
    return body


def segment(name: str, label: str, W: int, i: int, last: bool, seed: int) -> str:
    body = slab(W, H, i, last, seed)
    _, iw, ih = icon(name, 0, 0)
    x0 = round((W - (2 if not last else 0) - content_width(name, label)) / 2)
    ic, _, _ = icon(name, x0, (H - ih) // 2)
    text = f'<text x="{x0 + iw + GAP}" y="{H / 2 + SIZE * 0.35:.1f}" font-family="{FONT}" font-size="{SIZE}" font-weight="600" fill="{TEXT}">{label}</text>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" shape-rendering="crispEdges">{body}{ic}{text}</svg>\n'


def meta_segment(label: str, square, shown: bool, W: int, i: int, last: bool, seed: int) -> str:
    body = slab(W, META_H, i, last, seed)
    x0 = round((W - (2 if not last else 0) - meta_width(label, square)) / 2)
    if square: body += f'<rect x="{x0}" y="{META_H // 2 - 3}" width="6" height="6" fill="{square}"/>'
    tx = x0 + (12 if square else 0)
    colour = ORANGE if shown else TEXT if square else DIM
    text = f'<text x="{tx}" y="{META_H / 2 + META_SIZE * 0.35:.1f}" font-family="{FONT}" font-size="{META_SIZE}" font-weight="600" fill="{colour}">{label}</text>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{META_H}" viewBox="0 0 {W} {META_H}" shape-rendering="crispEdges">{body}{text}</svg>\n'


def meta_width(label: str, square) -> float:
    return (12 if square else 0) + text_width(label, META_SIZE)


def widths(need: list) -> list:
    """the banner's width shared out: each its own width plus an equal share of the rest, in even pixels"""
    extra = (WIDTH - sum(need)) / len(need)
    ws = [int(round((w + extra) / 2)) * 2 for w in need]
    ws[-1] += WIDTH - sum(ws)
    return ws


def main():
    os.makedirs(OUT, exist_ok=True)
    for lang, labels in LINKS.items():
        for i, (name, label, w) in enumerate(zip(ICON_OF, labels, widths([content_width(n, l) for n, l in zip(ICON_OF, labels)]))):
            path = os.path.join(OUT, f"{lang}-{name}.svg")
            open(path, "w", encoding="utf-8").write(segment(name, label, w, i, i == len(labels) - 1, 11 + i))
            print(path, w)
        meta = META[lang]
        for i, ((name, label, sq), w) in enumerate(zip(meta, widths([meta_width(l, q) for _, l, q in meta]))):
            path = os.path.join(OUT, f"{lang}-{name}.svg")
            shown = name == f"lang-{lang}"
            open(path, "w", encoding="utf-8").write(meta_segment(label, sq, shown, w, i + 1, i == len(meta) - 1, 41 + i))
            print(path, w)


if __name__ == "__main__":
    main()
