"""The README's link strip under the banner: one picture per link (GitHub can't underline or colour a picture), joined
into one dark toolbar with thin dividers and an orange line along the bottom. The icons are the headings' own
(assets/icons/h). Writes assets/nav/<lang>-<icon>.svg for English and Traditional Chinese.

    python3 scripts/readme-nav.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "assets", "icons", "h")
OUT = os.path.join(ROOT, "assets", "nav")

GROUND, TOP, SEAM, ORANGE, TEXT = "#1C1D26", "#2C2E3B", "#3A3C4A", "#E9892B", "#EFEBE1"
FONT = "-apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif"
H, SIZE, PAD, GAP = 34, 14, 14, 7

LINKS = {
    "en": ["Why Vellum", "Install", "Quick start", "With your agent", "File format", "Shortcuts", "FAQ"],
    "zh": ["為何選 Vellum", "安裝", "快速開始", "搭配 agent", "檔案格式", "快捷鍵", "常見問題"],
}
ICON_OF = ["star", "download", "play", "robot", "braces", "keyboard", "question"]

# advance widths (of 1000) of a semibold sans, enough to size a segment; CJK is one em
NARROW, WIDE = set("fijlrt "), {"m": 833, "w": 722, "W": 944}


def text_width(t: str) -> float:
    w = 0
    for c in t:
        if ord(c) > 0x2E80: w += 1000
        elif c in NARROW: w += 278
        elif c in WIDE: w += WIDE[c]
        elif c.isupper(): w += 667
        else: w += 556
    return w * SIZE / 1000 * 1.07


def icon(name: str, x: int, y: int):
    svg = open(os.path.join(ICONS, name + ".svg"), encoding="utf-8").read()
    vw, vh = map(int, re.search(r'viewBox="0 0 (\d+) (\d+)"', svg).groups())
    rects = re.findall(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#\w+)"/>', svg)
    body = "".join(f'<rect x="{x + int(a)}" y="{y + int(b)}" width="{w}" height="{h}" fill="{f}"/>' for a, b, w, h, f in rects)
    return body, vw, vh


def segment(name: str, label: str, last: bool) -> str:
    _, iw, ih = icon(name, 0, 0)
    W = round(PAD + iw + GAP + text_width(label) + PAD)
    body = f'<rect width="{W}" height="{H}" fill="{GROUND}"/><rect width="{W}" height="1" fill="{TOP}"/><rect y="{H - 2}" width="{W}" height="2" fill="{ORANGE}"/>'
    if not last: body += f'<rect x="{W - 1}" y="8" width="1" height="{H - 16}" fill="{SEAM}"/>'
    ic, _, _ = icon(name, PAD, (H - ih) // 2)
    text = f'<text x="{PAD + iw + GAP}" y="{H / 2 + SIZE * 0.35:.1f}" font-family="{FONT}" font-size="{SIZE}" font-weight="600" fill="{TEXT}">{label}</text>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" shape-rendering="crispEdges">{body}{ic}{text}</svg>\n'


def main():
    os.makedirs(OUT, exist_ok=True)
    for lang, labels in LINKS.items():
        for i, (name, label) in enumerate(zip(ICON_OF, labels)):
            path = os.path.join(OUT, f"{lang}-{name}.svg")
            open(path, "w", encoding="utf-8").write(segment(name, label, i == len(labels) - 1))
            print(path, re.search(r'width="(\d+)"', open(path, encoding="utf-8").read()).group(1))


if __name__ == "__main__":
    main()
