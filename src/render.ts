import { axes, Item } from "./model";

// The look a doc is drawn in: named colours and fonts (an item's colour / font is one of these names, or a CSS value).
export interface Theme { colors: Record<string, string>; fonts: Record<string, string> }
export interface Kind { id: string; name: string; color: string }

export const BASE_THEME: Theme = {
    colors: {
        paper: "var(--background-primary)", text: "var(--text-normal)", dim: "var(--text-muted)", line: "var(--background-modifier-border)",
        tile: "var(--background-secondary)", loud: "var(--color-red)", accent: "var(--interactive-accent)",
    },
    fonts: { ui: "var(--font-interface)", display: "var(--font-interface)", mono: "var(--font-monospace)" },
};
export const BASE_KINDS: Kind[] = [
    { id: "hero", name: "summary / number", color: "var(--color-blue)" },
    { id: "nav", name: "title / nav", color: "var(--text-faint)" },
    { id: "card", name: "card", color: "var(--color-purple)" },
    { id: "list", name: "list", color: "var(--color-yellow)" },
    { id: "tiles", name: "tiles / grid", color: "var(--color-green)" },
    { id: "action", name: "input / action", color: "var(--color-pink)" },
    { id: "float", name: "floating", color: "var(--color-cyan)" },
];

export const colorOf = (t: Theme, c?: string) => (!c || c === "none" ? "transparent" : t.colors[c] ?? c);
const fontOf = (t: Theme, f?: string) => (f ? t.fonts[f] ?? f : t.fonts.ui);
const px = (v: number) => `${Math.round(v * 100) / 100}px`;

// an item placed by gravity with CSS only (no measuring): start = left / top + offset, end = right / bottom + offset,
// middle = 50 % and a translate; fill = both edges at the offset; hug = the content's own size
const place = (el: HTMLElement, it: Item) => {
    const [ax, ay] = axes(it.g);
    const dx = it.dx ?? 0, dy = it.dy ?? 0, s = el.style;
    let tx = "0", ty = "0";
    if (it.w === "fill") { s.left = px(Math.abs(dx)); s.right = px(Math.abs(dx)); }
    else {
        if (ax < 0) s.left = px(dx); else if (ax > 0) s.right = px(dx); else { s.left = "50%"; tx = `calc(-50% + ${px(dx)})`; }
        if (typeof it.w === "number") s.width = px(it.w);
    }
    if (it.h === "fill") { s.top = px(Math.abs(dy)); s.bottom = px(Math.abs(dy)); }
    else {
        if (ay < 0) s.top = px(dy); else if (ay > 0) s.bottom = px(dy); else { s.top = "50%"; ty = `calc(-50% + ${px(dy)})`; }
        if (typeof it.h === "number") s.height = px(it.h);
    }
    if (tx !== "0" || ty !== "0") s.transform = `translate(${tx}, ${ty})`;
};
// inside a row / column: the size rules on the main axis are flex, on the cross axis a stretch
const flow = (el: HTMLElement, it: Item, dir: "row" | "col") => {
    const main = dir === "row" ? it.w : it.h, cross = dir === "row" ? it.h : it.w, s = el.style;
    if (main === "fill") s.flex = "1 1 0"; else if (typeof main === "number") s[dir === "row" ? "width" : "height"] = px(main);
    if (cross === "fill") s.alignSelf = "stretch"; else if (typeof cross === "number") s[dir === "row" ? "height" : "width"] = px(cross);
    s.flexShrink = main === "fill" ? "1" : "0";
};

// draw an item into its parent (a block, or a row / column); every element gets data-id, the top-level one data-top
export const drawItem = (t: Theme, parent: HTMLElement, it: Item, inFlow?: "row" | "col", lineUp: "left" | "center" | "right" = "left"): HTMLElement => {
    const el = parent.createDiv({ cls: `vl-it vl-i-${it.type}`, attr: { "data-id": it.id } });
    if (inFlow) flow(el, it, inFlow); else { el.addClass("is-abs"); place(el, it); }
    const s = el.style;
    if (it.op !== undefined && it.op < 100) s.opacity = String(it.op / 100);
    switch (it.type) {
        case "text": {
            el.setText(it.v ?? "");
            s.fontFamily = fontOf(t, it.font);
            s.fontSize = px(it.size ?? 15);
            if (it.wt) s.fontWeight = String(it.wt);
            s.color = colorOf(t, it.color ?? "text");
            // wrapped lines line up with the item's gravity (in a column: with the column's alignment); no separate setting
            const ax = axes(it.g)[0];
            s.textAlign = inFlow ? lineUp : ax < 0 ? "left" : ax > 0 ? "right" : "center";
            if (it.ls) s.letterSpacing = `${it.ls}em`;
            s.lineHeight = String(it.lh ?? 1.2);
            if (it.upper) s.textTransform = "uppercase";
            s.whiteSpace = typeof it.w === "number" || it.w === "fill" ? "pre-wrap" : "pre";
            break;
        }
        case "rect": case "ellipse": {
            s.background = colorOf(t, it.fill);
            if (it.sw) s.border = `${px(it.sw)} solid ${colorOf(t, it.stroke ?? "line")}`;
            s.borderRadius = it.type === "ellipse" ? "50%" : px(it.r ?? 0);
            if (it.w === "hug" || it.w === undefined) s.width = "40px";
            if (it.h === "hug" || it.h === undefined) s.height = "40px";
            break;
        }
        case "line": {
            s.background = colorOf(t, it.fill ?? "line");
            if (it.h === "hug" || it.h === undefined) s.height = "1px";
            if (it.w === "hug" || it.w === undefined) s.width = "40px";
            break;
        }
        case "row": case "col": {
            s.display = "flex";
            s.flexDirection = it.type === "row" ? "row" : "column";
            s.gap = px(it.gap ?? 0);
            if (it.pad) s.padding = px(it.pad);
            s.alignItems = { start: "flex-start", center: "center", end: "flex-end" }[it.cross ?? "start"];
            s.justifyContent = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" }[it.main ?? "start"];
            if (it.fill) s.background = colorOf(t, it.fill);
            if (it.sw) s.border = `${px(it.sw)} solid ${colorOf(t, it.stroke ?? "line")}`;
            if (it.r) s.borderRadius = px(it.r);
            const up = it.type === "col" ? ({ start: "left", center: "center", end: "right" } as const)[it.cross ?? "start"] : "left";
            for (const c of it.items ?? []) drawItem(t, el, c, it.type, up);
            break;
        }
    }
    if (!inFlow) el.setAttr("data-top", "1");
    return el;
};
