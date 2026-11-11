#!/usr/bin/env python3
"""Turn rectangles drawn as frames into what they frame, in a folder of Vellum screens.

Agents often draw a card's background, a separator or a tile under a text as a `rect` item. Vellum has looks for that:
a block's own fill / stroke / sw / r / sides, and a text's own box (fill / stroke / sw / r / pad, its text centred when
it has a height). For every block (portrait and landscape), top-level items only, this:

  1. a rect covering the whole block, at the back        -> the block's look
  2. a thin rect (<= 2 pt) along the block's top / bottom -> the block's outline on that side
  3. a rect (or two stacked halves, a flip tile) under exactly one text and nothing else -> that text's box

Only rects with a known place (anchored top left, sizes in points) are touched; anything unsure is left as it is.

    python3 scripts/convert-frames.py <screens folder>            # a dry run: prints what it would change
    python3 scripts/convert-frames.py <screens folder> --write    # writes the screens (one file per screen)
"""
import json
import sys
from pathlib import Path


def box(it, bw, bh):
    """an item's box (left, top, width, height) in its block, or None when its place is not plain"""
    if (it.get("g") or "tl") != "tl":
        return None
    dx, dy, w, h = it.get("dx", 0), it.get("dy", 0), it.get("w"), it.get("h")
    if w == "fill":
        w, dx = bw - 2 * abs(dx), abs(dx)
    if h == "fill":
        h, dy = bh - 2 * abs(dy), abs(dy)
    if not all(isinstance(v, (int, float)) for v in (dx, dy, w, h)):
        return None
    return dx, dy, w, h


def text_box(it):
    """a text's rough box (its anchor and an estimated size: no fonts here)"""
    if (it.get("g") or "tl") != "tl" or it.get("type") != "text":
        return None
    size, lh = it.get("size", 15), it.get("lh") or 1.2
    v = str(it.get("v", "")).split("\n")[0]
    w = it["w"] if isinstance(it.get("w"), (int, float)) else max(1, len(v)) * size * 0.6
    return it.get("dx", 0), it.get("dy", 0), w, size * lh


def inside(px, py, b):
    return b[0] - 0.5 <= px <= b[0] + b[2] + 0.5 and b[1] - 0.5 <= py <= b[1] + b[3] + 0.5


def look_of(r):
    out = {}
    if r.get("fill") and r["fill"] != "none":
        out["fill"] = r["fill"]
    if r.get("sw"):
        out["sw"], out["stroke"] = r["sw"], r.get("stroke", "line")
    if r.get("r"):
        out["r"] = r["r"]
    return out


def convert_block(b, log, where):
    bw, bh, items = b["w"], b["h"], b["items"]
    gone = set()
    # 1 · a rect covering the block, behind everything else -> the block's look
    for i, it in enumerate(items):
        if it.get("type") != "rect" or id(it) in gone or it.get("op") not in (None, 100):
            continue
        bx = box(it, bw, bh)
        if not bx or abs(bx[0]) > 0.5 or abs(bx[1]) > 0.5 or abs(bx[2] - bw) > 0.5 or abs(bx[3] - bh) > 0.5:
            continue
        if any(items[j].get("type") != "rect" for j in range(i)) or any(k in b for k in ("fill", "stroke", "sw")):
            continue
        b.update(look_of(it))
        gone.add(id(it))
        log.append(f"{where}: block look ← rect {it.get('id', '?')}")
    # 2 · a thin rect along the top or bottom edge -> the block's outline on that side
    for it in items:
        if it.get("type") != "rect" or id(it) in gone or not it.get("fill"):
            continue
        bx = box(it, bw, bh)
        if not bx or bx[3] > 2 or abs(bx[0]) > 0.5 or abs(bx[2] - bw) > 0.5:
            continue
        side = "t" if abs(bx[1]) < 0.5 else "b" if abs(bx[1] + bx[3] - bh) < 0.5 else None
        if not side or (b.get("stroke") not in (None, it["fill"])) or (b.get("sw") not in (None, bx[3])):
            continue
        sides = b.get("sides") or ("" if not b.get("sw") else "trbl")
        b["stroke"], b["sw"] = it["fill"], bx[3]
        new = "".join(s for s in "trbl" if s in sides + side)
        if new == "trbl":
            b.pop("sides", None)
        else:
            b["sides"] = new
        gone.add(id(it))
        log.append(f"{where}: block outline {side} ← rect {it.get('id', '?')}")
    # 3 · a rect (or two stacked halves) under exactly one text -> the text's box
    rects = [it for it in items if it.get("type") == "rect" and id(it) not in gone and it.get("fill") and box(it, bw, bh)]
    used = set()
    for r in rects:
        if id(r) in used:
            continue
        rb = box(r, bw, bh)
        parts = [r]
        for u in rects:   # the lower half of a flip tile: same column, touching, same fill
            ub = box(u, bw, bh)
            if u is not r and id(u) not in used and abs(ub[0] - rb[0]) < 0.5 and abs(ub[2] - rb[2]) < 0.5 and abs(ub[1] - (rb[1] + rb[3])) < 0.5 and u.get("fill") == r.get("fill"):
                parts.append(u)
                rb = (rb[0], rb[1], rb[2], rb[3] + ub[3])
                break
        on = []
        for it in items:
            if id(it) in gone or any(it is p for p in parts):
                continue
            tb = text_box(it) if it.get("type") == "text" else box(it, bw, bh)
            if tb and inside(tb[0] + tb[2] / 2, tb[1] + tb[3] / 2, rb):
                on.append(it)
        if len(on) != 1 or on[0].get("type") != "text" or any(k in on[0] for k in ("fill", "sw")):
            continue
        t, tb = on[0], text_box(on[0])
        look = look_of(r)
        if isinstance(look.get("r"), (int, float)) and len(parts) == 2:
            pass   # the top half's radius rounds the whole tile now
        t.update(look)
        centred = abs((tb[0] + tb[2] / 2) - (rb[0] + rb[2] / 2)) < 3
        t["w"], t["h"], t["dy"] = round(rb[2], 2), round(rb[3], 2), round(rb[1], 2)
        if centred:
            t["g"], t["dx"] = "t", round(rb[0] + rb[2] / 2 - bw / 2, 2)
        else:
            t["g"], t["dx"] = "tl", round(rb[0], 2)
            pad = round(tb[0] - rb[0])
            if pad > 0:
                t["pad"] = pad
        for p in parts:
            gone.add(id(p))
            used.add(id(p))
        log.append(f"{where}: text box ← {'tile' if len(parts) == 2 else 'rect'} under \"{str(t.get('v', ''))[:16]}\"")
    b["items"] = [it for it in items if id(it) not in gone]
    return len(gone)


def tidy(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: tidy(x) for k, x in v.items()}
    if isinstance(v, list):
        return [tidy(x) for x in v]
    return v


def page_text(p):
    """a screen's file as Vellum writes it: its own fields on the first line, then one block per line"""
    meta = {k: v for k, v in p.items() if k not in ("blocks", "land")}
    def js(v):   # as JavaScript's JSON.stringify writes it: compact, whole numbers without ".0"
        return json.dumps(tidy(v), ensure_ascii=False, separators=(",", ":"))
    def lst(l):
        return "[\n" + ",\n".join("  " + js(b) for b in l) + "\n]" if l else "[]"
    head = js(meta)[:-1]
    return f'{head}, "blocks": {lst(p["blocks"])}' + (f', "land": {lst(p["land"])}' if "land" in p else "") + "}\n"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    folder, write = Path(sys.argv[1]), "--write" in sys.argv
    total, log = 0, []
    for f in sorted(folder.glob("*.json")):
        if f.name == "_doc.json":
            continue
        p = json.loads(f.read_text(encoding="utf-8"))
        n = 0
        for layout in ("blocks", "land"):
            for b in p.get(layout) or []:
                n += convert_block(b, log, f"{f.stem} · {b.get('name', b['id'])}")
        total += n
        if n and write:
            f.write_text(page_text(p), encoding="utf-8")
        if n:
            print(f"{f.name}: {n} rects")
    print("\n".join(log))
    print(f"\n{total} rects {'converted' if write else 'would be converted (dry run; --write to write)'}")


if __name__ == "__main__":
    main()
