#!/usr/bin/env python3
"""The README's banner: a factory line, seen from above. Drafts of an app's screens ride a belt from the left, are
built block by block (the agent carries the last part in), and the finished screen waits at the belt's end; the name
and slogan on the right. Pixel art on a 2x grid, written as crisp SVG.

Run from the repo root: python3 scripts/readme-banner.py   (writes assets/banner.svg)"""
import importlib.util, math, os, random

spec = importlib.util.spec_from_file_location("art", os.path.join(os.path.dirname(__file__), "readme-art.py"))
art = importlib.util.module_from_spec(spec); spec.loader.exec_module(art)

W, H = 560, 152                     # drawn on a wider canvas, then cropped to its margins
OUT, K = "#0E0F13", "#0B0C10"
TEXT, TEXTL, TEXTS, MUTED = "#E6E3DC", "#FFFBF0", "#B5B0A6", "#96969B"
OR, ORL, ORS = "#FF5C38", "#FFA070", "#C23A22"
YE, GR, BL = "#F2C94C", "#5DD39E", "#7FA6FF"
PAPER = "#EFEBE1"
DG, DGD, DGH = "#5DD39E", "#2E5A44", "#24352D"      # the draft: its lines, its blocks, its hatch
YEL = ("#F2C94C", "#FFF0B8", "agent", "#0B0C10")
ARW = ["E.......", "EE......", "ELE.....", "ELFE....", "ELFFE...", "ELFFFE..", "ELFFFFE.", "ELFFFFFE", "ELFFEEEE", "ELFE....", "ELE.....", "EE......", "E......."]
USER = ("#FF5C38", "#B83A1F", "#FFA27F", "user", "#FFFFFF")
AGT = ("#F2C94C", "#A8821C", "#FFF0B8", "agent", "#0B0C10")
NONPAPER = lambda c: c not in (PAPER, "#16161A", "#DCD6C9", "#E6E0D2", "#FFFBF0")
KERN = {("V", "e"): 1, ("e", "l"): 3, ("l", "l"): 4, ("l", "u"): 4, ("u", "m"): 4}   # the name, spaced by eye
GAPX = 22                           # the text's margin, left and right
LOW = {   # the small face, 4 x 7 with descenders: only the letters the banner uses
    ' ': '..|..|..|..|..|..|..|..|..',
    ',': '.|.|.|.|.|.|#|#|.',
    '.': '.|.|.|.|.|.|#|.|.',
    'D': '###.|#..#|#..#|#..#|#..#|#..#|###.|....|....',
    'M': '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#|.....|.....',
    'O': '.##.|#..#|#..#|#..#|#..#|#..#|.##.|....|....',
    'S': '.###|#...|#...|.##.|...#|...#|###.|....|....',
    'a': '....|....|.##.|...#|.###|#..#|.###|....|....',
    'b': '#...|#...|###.|#..#|#..#|#..#|###.|....|....',
    'c': '...|...|.##|#..|#..|#..|.##|...|...',
    'd': '...#|...#|.###|#..#|#..#|#..#|.###|....|....',
    'e': '....|....|.##.|#..#|####|#...|.###|....|....',
    'f': '.##|#..|###|#..|#..|#..|#..|...|...',
    'g': '....|....|.###|#..#|#..#|#..#|.###|...#|.##.',
    'h': '#...|#...|###.|#..#|#..#|#..#|#..#|....|....',
    'i': '#|.|#|#|#|#|#|.|.',
    'n': '....|....|###.|#..#|#..#|#..#|#..#|....|....',
    'o': '....|....|.##.|#..#|#..#|#..#|.##.|....|....',
    'p': '....|....|###.|#..#|#..#|#..#|###.|#...|#...',
    'r': '...|...|#.#|##.|#..|#..|#..|...|...',
    's': '....|....|.###|#...|.##.|...#|###.|....|....',
    't': '.#.|.#.|###|.#.|.#.|.#.|..#|...|...',
    'u': '....|....|#..#|#..#|#..#|#..#|.###|....|....',
    'w': '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.|.....|.....',
    'y': '....|....|#..#|#..#|#..#|#..#|.###|...#|.##.'
}
g = [["#1C1D26"] * W for _ in range(H)]


def p(x, y, c):
    if 0 <= x < W and 0 <= y < H: g[y][x] = c


def r(x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w): p(xx, yy, c)


def box(x, y, w, h, k=1):
    """a rounded box: k <= 2 a stepped corner, bigger k a real quarter circle drawn in pixels"""
    out = set()
    for b in range(h):
        for a in range(w):
            cx, cy = min(a, w - 1 - a), min(b, h - 1 - b)
            if k <= 2:
                if cx + cy < k: continue
            elif cx < k and cy < k and (k - cx - 0.5) ** 2 + (k - cy - 0.5) ** 2 > k * k: continue
            out.add((x + a, y + b))
    return out


def fill(m, c):
    for q in m: p(*q, c)


def edge(m, c):
    for (x, y) in m:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in m: p(x + dx, y + dy, c)


def dshadow(m, d=3):
    for (x, y) in m:
        q = (x + d, y + d)
        if q not in m and (q[0] + q[1]) % 2 == 0: p(*q, "#0C0D11")


def mixc(a, b, t):
    a = [int(a[i:i+2], 16) for i in (1, 3, 5)]; b = [int(b[i:i+2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x*(1-t)+y*t):02X}" for x, y in zip(a, b))


def small(t, x, y, c):
    for ch in t:
        rows = LOW[ch].split("|")
        for b, row in enumerate(rows):
            for a, q in enumerate(row):
                if q == "#": p(x + a, y + b, c)
        x += len(rows[0]) + 1
    return x


def swidth(t): return sum(len(LOW[ch].split("|")[0]) + 1 for ch in t) - 1


def ring(x, y, w, h, t):
    outer = box(x, y, w, h, min(w, h) // 2 - 1); inner = box(x + t, y + t, w - 2 * t, h - 2 * t, max(1, min(w, h) // 2 - t - 1))
    return outer - inner


def glyphs():
    G = {}
    s, xh, cap = 4, 15, 22
    top = cap - xh
    V = set()
    for yy in range(cap):
        d = round(yy / (cap - 1) * 6.5)
        for k in range(s + 1): V.add((d + k, yy)); V.add((18 - d - k, yy))
    G["V"] = (V, 19)
    e = ring(0, top, 15, xh, s)
    e = {q for q in e if not (q[0] >= 9 and top + 8 <= q[1] <= top + 10)}
    e |= {(a, top + 6 + b) for a in range(2, 13) for b in range(3)}
    G["e"] = (e, 15)
    G["l"] = ({(a, b) for a in range(s) for b in range(cap)}, s)
    u = {q for q in ring(0, top - 6, 15, xh + 6, s) if q[1] >= top + 4}
    u |= {(a, b) for a in range(s) for b in range(top, top + 8)} | {(a, b) for a in range(11, 15) for b in range(top, top + xh)}
    G["u"] = (u, 15)
    m = {(a, b) for a in range(s) for b in range(top, cap)}
    for ox in (0, 9):
        arch = {q for q in ring(ox, top, 13, 14, s) if q[1] <= top + 6}
        m |= arch | {(a, b) for a in range(ox + 9, ox + 13) for b in range(top + 5, cap)}
    G["m"] = (m, 22)
    return G


def tracing_word(x, y):
    G = glyphs(); pts, pos, prev = set(), 0, None
    for ch in "Vellum":
        if prev: pos += KERN[(prev, ch)]
        m, w = G[ch]; pts |= {(pos + a, b) for a, b in m}; pos += w; prev = ch
    pts = {(a + x, b + y) for a, b in pts}
    random.seed(3)
    under = {q: g[q[1]][q[0]] for q in pts}
    for (a, b) in pts:
        t = 0.82
        if (a, b - 1) not in pts or (a - 1, b) not in pts: t = 0.94
        elif (a, b + 1) not in pts or (a + 1, b) not in pts: t = 0.68
        elif random.random() < 0.06: t = 0.74
        p(a, b, mixc(under[(a, b)], "#F4EEE2", t))
    return pos


def word_width():
    G = glyphs(); pos, prev = 0, None
    for ch in "Vellum":
        if prev: pos += KERN[(prev, ch)]
        pos += G[ch][1]; prev = ch
    return pos


def phone(x, y, w, h):
    body = box(x, y, w, h, 9); dshadow(body, 3)
    fill(body, "#2B2B31")
    for (a, b) in body:
        if (a - 1, b) not in body or (a, b - 1) not in body: p(a, b, "#4A4A53")
    edge(body, OUT)
    scr = box(x + 3, y + 3, w - 6, h - 6, 6)
    fill(scr, PAPER)
    r(x + w // 2 - 7, y + 6, 14, 4, "#16161A")
    return x + 3, y + 3, w - 6, h - 6


def mini(x, y, w, h, kind):
    body = box(x, y, w, h, 5); dshadow(body, 2); fill(body, "#2B2B31")
    for (a, b) in body:
        if (a - 1, b) not in body or (a, b - 1) not in body: p(a, b, "#4A4A53")
    edge(body, OUT)
    sx, sy, sw, sh = x + 2, y + 2, w - 4, h - 4
    fill(box(sx, sy, sw, sh, 3), PAPER); r(sx + sw // 2 - 4, sy + 1, 8, 2, "#16161A")
    if kind == "list":
        r(sx + 4, sy + 8, 18, 3, "#141414")
        for i in range(4):
            yy = sy + 16 + i * 9
            fill({(a, b) for a in range(sx + 4, sx + 10) for b in range(yy, yy + 6) if (a - sx - 6.5) ** 2 + (b - yy - 2.5) ** 2 <= 9}, [BL, GR, YE, OR][i])
            r(sx + 13, yy + 1, sw - 18, 2, "#141414"); r(sx + 13, yy + 4, sw - 24, 1, "#A8A296")
    if kind == "detail":
        r(sx + 3, sy + 8, sw - 6, 20, "#9CC3F0"); r(sx + 3, sy + 22, sw - 6, 6, "#5DBE8A")
        r(sx + 4, sy + 32, 20, 3, "#141414"); r(sx + 4, sy + 38, sw - 8, 1, "#A8A296"); r(sx + 4, sy + 41, sw - 12, 1, "#A8A296")
        r(sx + 3, sy + sh - 12, sw - 6, 7, OR)
    return sx, sy, sw, sh


def screen_base(x, y, w, h, kind, dim=0.0):
    sx, sy, sw, sh = mini(x, y, w, h, "none")
    if kind == "list":
        r(sx + 4, sy + 9, 20, 4, "#141414"); r(sx + 4, sy + 16, sw - 8, 7, "#E6E0D2")
        for i in range(5):
            yy = sy + 28 + i * 11
            fill({(a, b) for a in range(sx + 4, sx + 11) for b in range(yy, yy + 7) if (a - sx - 7) ** 2 + (b - yy - 3) ** 2 <= 10}, [BL, GR, YE, OR, BL][i])
            r(sx + 14, yy + 1, sw - 20, 2, "#141414"); r(sx + 14, yy + 5, sw - 28, 1, "#A8A296")
    if kind == "cards":
        r(sx + 4, sy + 9, 24, 4, "#141414")
        cw = (sw - 11) // 2
        for i in range(6):
            cx, cy = sx + 4 + (i % 2) * (cw + 3), sy + 17 + (i // 2) * 24
            r(cx, cy, cw, 21, ["#FFE3D9", "#DDE8FF", "#DDF5E9", "#FFF1CC", "#DDE8FF", "#FFE3D9"][i])
            r(cx + 3, cy + 3, 7, 7, [OR, BL, GR, YE, BL, OR][i]); r(cx + 3, cy + 13, cw - 7, 2, "#141414")
    if kind == "hero":
        r(sx + 3, sy + 8, sw - 6, 40, "#9CC3F0")
        fill({(a, b) for a in range(sx + sw - 16, sx + sw - 7) for b in range(sy + 13, sy + 22) if (a - sx - sw + 11.5) ** 2 + (b - sy - 17.5) ** 2 <= 18}, YE)
        for a in range(sx + 3, sx + sw - 3):
            hgt = round(9 * max(0, 1 - abs(a - (sx + 16)) / 15)) + round(6 * max(0, 1 - abs(a - (sx + sw - 14)) / 12))
            for b in range(sy + 44 - hgt, sy + 48): p(a, b, "#5DBE8A" if b < sy + 44 else "#3E9E6E")
        r(sx + 5, sy + 54, 34, 5, "#141414"); r(sx + 5, sy + 63, sw - 10, 2, "#A8A296"); r(sx + 5, sy + 68, sw - 18, 2, "#A8A296")
        r(sx + 5, sy + 76, sw - 10, 1, "#DCD6C9")
        for i in range(2):
            if sy + 82 + i * 8 + 6 < sy + sh - 17: r(sx + 5, sy + 82 + i * 8, 8, 5, [OR, BL][i]); r(sx + 16, sy + 83 + i * 8, sw - 24, 2, "#141414")
        r(sx + 5, sy + sh - 15, sw - 10, 9, OR); r(sx + sw // 2 - 8, sy + sh - 12, 16, 3, "#FFFFFF")
    if dim:
        for yy in range(max(0, y - 1), min(H, y + h + 4)):
            for xx in range(max(0, x - 1), min(W, x + w + 4)):
                g[yy][xx] = mixc(g[yy][xx], "#1C1D26", dim)
    return sx, sy, sw, sh


def screen_chart(x, y, w, h, kind, dim=0.0):
    if kind not in ("profile", "chart"): return screen_base(x, y, w, h, kind, dim)
    sx, sy, sw, sh = mini(x, y, w, h, "none")
    cx = sx + sw // 2
    if kind == "profile":
        av = {(a, b) for a in range(cx - 10, cx + 11) for b in range(sy + 10, sy + 31) if (a - cx) ** 2 + (b - sy - 20) ** 2 <= 100}
        fill(av, "#F2B8A0"); fill({q for q in av if q[1] >= sy + 23}, OR)                  # a face and shoulders
        fill({(a, b) for a in range(cx - 4, cx + 5) for b in range(sy + 13, sy + 22) if (a - cx) ** 2 + (b - sy - 17) ** 2 <= 16}, "#E39B7E")
        r(cx - 14, sy + 35, 28, 4, "#141414"); r(cx - 9, sy + 42, 18, 2, "#A8A296")
        for i in range(3):
            bx = sx + 5 + i * ((sw - 10) // 3)
            r(bx + 2, sy + 50, (sw - 10) // 3 - 4, 4, "#141414"); r(bx + 3, sy + 57, (sw - 10) // 3 - 6, 2, "#A8A296")
        r(sx + 5, sy + 64, (sw - 13) // 2, 9, OR); r(sx + 8 + (sw - 13) // 2, sy + 64, (sw - 13) // 2, 9, "#E6E0D2")
        tw_ = (sw - 14) // 3
        for i in range(3): r(sx + 5 + i * (tw_ + 2), sy + 78, tw_, tw_, [BL, GR, YE][i])
    if kind == "chart":
        r(sx + 5, sy + 9, 22, 4, "#141414")
        r(sx + 4, sy + 17, sw - 8, 34, "#DDE8FF")
        pts = [(0, 20), (6, 14), (12, 17), (18, 8), (24, 11), (30, 4), (36, 6), (sw - 14, 2)]
        for (a0, b0), (a1, b1) in zip(pts, pts[1:]):
            for t in range(0, 20):
                a = round(a0 + (a1 - a0) * t / 20); b = round(b0 + (b1 - b0) * t / 20)
                p(sx + 7 + a, sy + 22 + b, BL); p(sx + 7 + a, sy + 23 + b, BL)
        cw = (sw - 11) // 2
        for i in range(2): r(sx + 4 + i * (cw + 3), sy + 55, cw, 17, ["#FFE3D9", "#DDF5E9"][i]); r(sx + 7 + i * (cw + 3), sy + 59, 10, 4, "#141414"); r(sx + 7 + i * (cw + 3), sy + 66, cw - 8, 2, [OR, GR][i])
        for i in range(2): r(sx + 5, sy + 78 + i * 9, 6, 6, [YE, BL][i]); r(sx + 14, sy + 79 + i * 9, sw - 20, 2, "#141414")
    return sx, sy, sw, sh


def screen_at(x, y, w, h, kind, dim=0.0):
    if kind != "profile": return screen_chart(x, y, w, h, kind, dim)
    sx, sy, sw, sh = mini(x, y, w, h, "none")
    r(sx + 4, sy + 8, 16, 3, "#141414"); r(sx + sw - 9, sy + 8, 5, 3, "#A8A296")                 # title, a menu
    av = {(a, b) for a in range(sx + 4, sx + 18) for b in range(sy + 16, sy + 30) if (a - sx - 10.5) ** 2 + (b - sy - 22.5) ** 2 <= 44}
    fill(av, "#F2B8A0"); fill({q for q in av if q[1] >= sy + 26}, OR)
    fill({(a, b) for a in range(sx + 8, sx + 14) for b in range(sy + 18, sy + 24) if (a - sx - 10.5) ** 2 + (b - sy - 20.5) ** 2 <= 7}, "#E39B7E")
    r(sx + 21, sy + 19, 20, 3, "#141414"); r(sx + 21, sy + 25, 14, 2, "#A8A296")                  # name, handle
    cw = (sw - 12) // 3
    for i in range(3):                                                                         # stats
        bx = sx + 4 + i * (cw + 2)
        r(bx, sy + 35, cw, 14, "#E9E4D8"); r(bx + 3, sy + 38, cw - 8, 3, "#141414"); r(bx + 3, sy + 44, cw - 6, 2, "#A8A296")
    r(sx + 4, sy + 53, sw - 8, 9, "#E9E4D8"); r(sx + 5, sy + 54, (sw - 10) // 2, 7, "#FFFFFF"); r(sx + 9, sy + 57, 10, 2, "#141414"); r(sx + sw // 2 + 6, sy + 57, 10, 2, "#A8A296")
    tw_ = (sw - 10) // 3                                                                       # photos
    for i in range(6):
        tx, ty = sx + 4 + (i % 3) * (tw_ + 1), sy + 65 + (i // 3) * (tw_ + 1)
        r(tx, ty, tw_, tw_, ["#9CC3F0", "#F2C94C", "#5DBE8A", "#FFB59E", "#B8C9F5", "#9BEAC4"][i])
    return sx, sy, sw, sh


def parts_base(sx, sy, sw, sh, kind):
    if kind == "hero":
        return [(sy, sy + 49), (sy + 52, sy + 72), (sy + 76, sy + sh - 18), (sy + sh - 17, sy + sh)]
    if kind == "list":
        return [(sy, sy + 24)] + [(sy + 26 + i * 11, sy + 36 + i * 11) for i in range(5)] + [(sy + 81, sy + sh)]
    if kind == "cards":
        return [(sy, sy + 15)] + [(sy + 16 + i * 24, sy + 40 + i * 24) for i in range(3)] + [(sy + 88, sy + sh)]


def parts_chart(sx, sy, sw, sh, kind):
    if kind == "profile": return [(sy, sy + 33), (sy + 34, sy + 46), (sy + 48, sy + 61), (sy + 63, sy + 75), (sy + 76, sy + sh)]
    if kind == "chart": return [(sy, sy + 15), (sy + 16, sy + 53), (sy + 54, sy + 74), (sy + 76, sy + sh)]
    return parts_base(sx, sy, sw, sh, kind)


def parts(sx, sy, sw, sh, kind):
    if kind == "profile": return [(sy, sy + 13), (sy + 14, sy + 32), (sy + 33, sy + 51), (sy + 52, sy + 63), (sy + 64, sy + sh)]
    return parts_chart(sx, sy, sw, sh, kind)


def step(x, y, w, h, kind, done, frame):
    keep = [row[:] for row in g]
    sx, sy, sw, sh = screen_at(x, y, w, h, kind)
    rendered = {(a, b): g[b][a] for a in range(x, x + w) for b in range(y, y + h)}
    for yy in range(H): g[yy] = keep[yy][:]
    body = box(x, y, w, h, 9); scr = box(sx, sy, sw, sh, 6)
    if frame >= 0.6:
        for (a, b) in body:
            q = (a + 3, b + 3)
            if q not in body and 0 <= q[0] < W and 0 <= q[1] < H: p(*q, mixc(g[q[1]][q[0]], "#000000", 0.5 * frame))
    for (a, b) in body - scr:                              # the frame, fading in
        if frame > 0: p(a, b, mixc(g[b][a], rendered[(a, b)], frame))
    for (a, b) in scr:                                      # the draft
        p(a, b, DGH if (a + b) % 6 < 2 else "#1A221E")
    inside = box(sx + 1, sy + 1, sw - 2, sh - 4, 3)
    for (a, b) in inside:
        c = rendered.get((a, b))
        if c and NONPAPER(c): p(a, b, DG if c == "#141414" else DGD)
    for (a, b) in scr:                                      # its dotted edge
        if any((a + dx, b + dy) not in scr for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))) and (a + b) % 2 == 0: p(a, b, DG)
    P = parts(sx, sy, sw, sh, kind)
    for i in done:                                          # the finished parts, solid on the draft
        y0, y1 = P[i]
        pts = [(a, b) for (a, b) in inside if y0 <= b < y1 and NONPAPER(rendered[(a, b)])]
        if not pts: continue
        ax0, ax1 = min(a for a, _ in pts) - 2, max(a for a, _ in pts) + 3
        by0, by1 = min(b for _, b in pts) - 2, max(b for _, b in pts) + 3
        for b in range(by0, by1):
            for a in range(ax0, ax1):
                if (a, b) in scr: p(a, b, rendered[(a, b)])
    solid = {(a, b): rendered[(a, b)] for (a, b) in rendered}
    return sx, sy, sw, sh, P, solid


def lifted(solid, sx, sw, y0, y1, dx, dy):
    """a part picked up: a copy of it, moved, with a soft shadow"""
    pts = [(a, b) for a in range(sx, sx + sw) for b in range(y0, y1)]
    for (a, b) in pts:
        q = (a + dx + 2, b + dy + 3)
        if (a + b) % 2 == 0: p(*q, mixc(g[q[1]][q[0]], "#000000", 0.45))
    for (a, b) in pts:
        p(a + dx, b + dy, solid[(a, b)])
    for a in range(sx + dx - 1, sx + sw + dx + 1): p(a, y0 + dy - 1, YEL[0]); p(a, y1 + dy, YEL[0])
    for b in range(y0 + dy - 1, y1 + dy + 1): p(sx + dx - 1, b, YEL[0]); p(sx + sw + dx, b, YEL[0])


def cur(x, y, body, edgec, light, label, fg):
    for b, row in enumerate(ARW):
        for a, q in enumerate(row):
            if q == "E": p(x + a, y + b, edgec)
            elif q == "L": p(x + a, y + b, light)
            elif q == "F": p(x + a, y + b, body)
    w = swidth(label) + 10
    m = box(x + 6, y + 11, w, 15, 3); fill(m, body)
    for (a, b) in m:
        if (a, b + 1) not in m or (a + 1, b) not in m: p(a, b, edgec)
    small(label, x + 11, y + 14, fg)


def floor():
    random.seed(11)
    for y in range(H):
        for x in range(W):
            slab = ((x // 160) * 7) % 3
            base = ["#1B1C24", "#1D1E26", "#1A1B22"][slab]
            n = random.random()
            g[y][x] = "#191A21" if n < 0.06 else "#20212A" if n > 0.965 else base
    for y in range(H):
        for x in range(W):
            if x % 160 == 0: g[y][x] = "#15161C"
            elif x % 160 == 1: g[y][x] = "#22232C"


def belt8(x0, x1, y0, y1, R=6):
    """the head end, worked out from the geometry. xa: the roller's axle, under the crest. The roller spans xa - R to
    xa + R; its ends show in the rail lanes (same lanes, same thickness as the rails). The rails run up to xa - R and
    meet it. The belt is flat to xa, then wraps the roller's far half (xa .. xa + R), darkening as it turns away. Seen
    a little from the near (bottom) side: the far (top) edge curves down as it wraps, the near (bottom) edge stays
    straight under the near rail."""
    xa = x1 - R
    bh = y1 - y0
    global TEXT_FROM, TEXT_MID
    TEXT_FROM, TEXT_MID = x1 + 4, (y0 + y1) // 2
    global RAIL_TOP, RAIL_BOT
    RAIL_TOP, RAIL_BOT = y0 - 4, y1 + 3

    for yy in range(y0, y1):
        for xx in range(x0, xa): p(xx, yy, "#2B2D36")
    x = x0 + 3
    while x <= xa - 1:
        for yy in range(y0, y1):
            j = 2 if bh // 3 <= yy - y0 < 2 * bh // 3 else 0
            p(x + j, yy, "#1D1E25"); p(x + j + 1, yy, "#373944")
            if yy - y0 in (bh // 3, 2 * bh // 3): p(x + 1, yy, "#1D1E25"); p(x + 2, yy, "#1D1E25")
        x += 7
    r(x0, y0, xa - x0, 1, "#15161B"); r(x0, y1 - 1, xa - x0, 1, "#15161B")
    # the wrap: brightness falls as the surface turns from facing up to facing away (cos of the angle round the roller)
    for i in range(R):
        ang = math.asin(min(1.0, (i + 0.5) / R))                 # how far round the roller this column is
        lit = math.cos(ang)
        c = mixc("#0A0A0D", "#2B2D36", lit ** 1.4)
        for yy in range(y0, y1): p(xa + i, yy, c)
    for i in range(3):                                           # past the roller: the dark gap down to the floor
        for yy in range(y0, y1): p(x1 + i, yy, ["#0A0B0D", "#0E0F12", "#131419"][i])
    # rails, in their lanes, up to the roller
    x_last = x0 + 3 + 7 * ((xa - 1 - (x0 + 3)) // 7)            # the right-most belt line; the roller starts there
    STEEL3 = ["#55576A", "#3E404B", "#2E3039"]                 # rails three pixels thick: a lit top, the face, the shade
    for fy in (y0 - 3, y1):
        for i, c in enumerate(STEEL3): r(x0, fy + i, x_last + 1 - x0, 1, c)
        r(x0, fy - 1, x1 - x0, 1, K); r(x0, fy + 3, x1 - x0, 1, K)
        # the roller's end in the same lane, the same steel, a little darker toward its edges
        for xx in range(x_last + 1, x1):
            t = 2 * (xx - x_last - 1 + 0.5) / (x1 - 1 - x_last) - 1
            lit = math.cos(math.asin(max(-1.0, min(1.0, t))))
            for k in range(3): p(xx, fy + k, mixc(STEEL3[k], "#0B0C10", 0.45 * (1 - lit)))
        r(x_last, fy, 1, 3, "#22232A")
        r(x1, fy, 1, 3, K)                                        # its end; no corner pixel on the side away from the belt
        p(x1, fy + 3 if fy < y0 else fy - 1, K)


def text_right(_x, _l1, _l2, _foot):
    global TEXT_X, TEXT_W
    lines = [("Drafts in.", "#FF9C78"), ("Screens out.", TEXT)]   # a light tint of the orange, then cream
    about = ["Map your app with your agent,", "right in Obsidian."]
    bw = max([word_width()] + [swidth(t) for t, _ in lines] + [swidth(t) for t in about])
    x = TEXT_FROM + GAPX
    H_WORD, GAP1, LINE, LEAD, GAP2 = 22, 15, 7, 5, 12
    total = H_WORD + GAP1 + 2 * LINE + LEAD + GAP2 + 2 * LINE + LEAD
    y = TEXT_MID - total // 2
    tracing_word(x, y)
    ry = y + H_WORD + GAP1 // 2
    # the line under the name: orange where it starts, dithering out into the grey as it runs (a pixel gradient,
    # no blend colours), a lit pixel above its start
    G_ = glyphs(); x_e = x + G_["V"][1] + KERN[("V", "e")]           # the line starts under the name's e
    ww_ = x + bw - x_e                                            # and runs to the text's right edge
    for i in range(ww_ - 5):
        t = 1 - i / (ww_ - 1)                                     # orange at the right end, fading left into grey
        if t < 0.22: c = OR
        elif t < 0.55:
            k = (t - 0.22) / 0.33
            c = OR if ((i * 7) % 10) / 10 >= k else "#3A3C46"
        else: c = "#3A3C46"
        p(x_e + i, ry, c)
    cx_, cy_ = x_e + ww_ - 2, ry                                  # its end: a small diamond, a node, a pixel apart
    for dx, dy in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)): p(cx_ + dx, cy_ + dy, OR)
    y += H_WORD + GAP1
    for t, c in lines: small(t, x, y, c); y += LINE + LEAD
    y += GAP2 - LEAD
    w0 = swidth(about[0])
    for t in about:                                               # the second line ends where the first does
        small(t, x + w0 - swidth(t), y, MUTED); y += LINE + LEAD
    TEXT_X, TEXT_W = x, bw

def banner():
    global g
    g = [["#1C1D26"] * W for _ in range(H)]
    floor()
    SW_, SH_, GAP_ = 56, 102, 16
    BY0, BY1 = 23, 23 + SH_ + 10
    XEND = 316
    xs = [XEND - 16 - SW_ - i * (SW_ + GAP_) for i in range(4)][::-1]
    belt8(-20, XEND + 12, BY0, BY1)
    sy = BY0 + 5
    step(xs[0], sy, SW_, SH_, "chart", [], 0.0)                     # a draft: no phone yet
    step(xs[1], sy, SW_, SH_, "profile", [0, 1], 0.35)              # started: the frame fading in
    sx, sy2, sw, sh, P, solid = step(xs[2], sy, SW_, SH_, "hero", [0, 2, 3], 0.7)
    y0, y1 = P[1]; lifted(solid, sx + 2, sw - 4, y0, y1 - 2, 8, 7)  # the agent carrying the last part in
    agent_at = (sx + sw - 2, y0 + 12)
    screen_at(xs[3], sy, SW_, SH_, "cards")                          # finished, at the belt's end
    cur(xs[3] + 34, sy + 82, *USER)
    cur(*agent_at, *AGT)
    text_right(None, None, None, None)
    # crop: the same gap above the top rail and below the bottom one; on the right, the text's own margin again
    PAD, LEFT = 12, 12
    top, bot = RAIL_TOP - PAD, RAIL_BOT + PAD
    right = TEXT_X + TEXT_W + GAPX
    return [row[LEFT:right] for row in g[top:bot + 1]]


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "assets/banner.svg"
    grid = banner()
    open(out, "w").write(art.svg(grid, 2, radius=6))
    print(f"{out}: {2 * len(grid[0])} x {2 * len(grid)}")
