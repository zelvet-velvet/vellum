import { setIcon } from "obsidian";
import { axes, Item } from "./model";

// The look a doc is drawn in: named colours and fonts (an item's colour / font is one of these names, or a CSS value).
export interface Theme { colors: Record<string, string>; fonts: Record<string, string> }
export interface Kind { id: string; name: string; color: string; icon?: string }

export const BASE_THEME: Theme = {
    colors: {
        paper: "var(--background-primary)", text: "var(--text-normal)", dim: "var(--text-muted)", line: "var(--background-modifier-border)",
        tile: "var(--background-secondary)", loud: "var(--color-red)", accent: "var(--interactive-accent)",
    },
    fonts: { ui: "var(--font-interface)", display: "var(--font-interface)", mono: "var(--font-monospace)" },
};
// the editor's own UI colours, by what they colour: each sets these variables on the editor (the Settings' Editor theme card)
export const UI_COLORS: { id: string; name: string; group: string; vars: string[]; follow?: string }[] = [
    { id: "panels", name: "Panels", group: "Surfaces", vars: ["--background-primary"] },
    { id: "side", name: "Side areas", group: "Surfaces", vars: ["--background-secondary"] },
    { id: "hover", name: "Hover", group: "Surfaces", vars: ["--background-modifier-hover"] },
    { id: "device", name: "Device area", group: "Surfaces", vars: ["--vlu-device"], follow: "var(--background-secondary)" },   // under the screens list; side areas until set
    { id: "field", name: "Input boxes", group: "Surfaces", vars: ["--background-modifier-form-field"] },
    { id: "border", name: "Borders", group: "Lines", vars: ["--background-modifier-border"] },
    { id: "borderh", name: "Borders on hover", group: "Lines", vars: ["--background-modifier-border-hover"] },
    { id: "text", name: "Text", group: "Text", vars: ["--text-normal"] },
    { id: "muted", name: "Secondary text", group: "Text", vars: ["--text-muted"] },
    { id: "faint", name: "Faint text", group: "Text", vars: ["--text-faint"] },
    { id: "onaccent", name: "Text on accent", group: "Text", vars: ["--text-on-accent"] },
    { id: "accent", name: "Accent", group: "Accent", vars: ["--interactive-accent"] },
    { id: "accenth", name: "Accent hover", group: "Accent", vars: ["--interactive-accent-hover"] },
    { id: "red", name: "Warnings", group: "Signals", vars: ["--color-red", "--text-error"] },
    { id: "guide", name: "Snap guides", group: "Signals", vars: ["--vlu-guide"], follow: "var(--color-pink, #e93147)" },   // its own variable: block kinds use Obsidian's pink too
    { id: "measure", name: "Measure", group: "Signals", vars: ["--vlu-measure"], follow: "var(--interactive-accent)" },   // M + drag: the area, frames, gaps and sizes
    { id: "mock", name: "Mock screens", group: "Signals", vars: ["--vlu-mock"], follow: "var(--color-orange, #ec7500)" },   // a proposal's frame, tag and name, everywhere it shows
    { id: "changed", name: "Changed screens", group: "Signals", vars: ["--vlu-changed"], follow: "var(--color-cyan, #00bfbc)" },   // a screen the agent changed, waiting for Keep or Undo
];

// the editor themes Vellum starts with (Settings → Editor theme), beside Obsidian's own: Light and Dark, Ledgerline's warm
// paper and charcoal with its one loud colour, as in the README's pictures. Colours a theme leaves out follow the Obsidian chip
export const EDITOR_THEMES: Record<string, Record<string, string>> = {
    Light: {
        panels: "#ECE9E1", side: "#E3DFD5", hover: "#1C1B1914", device: "#E3DFD5", field: "#F6F3EC",
        border: "#D5D1C7", borderh: "#6D6A63", text: "#1C1B19", muted: "#6D6A63", faint: "#8C887F", onaccent: "#F6F3EC",
        accent: "#E8461F", accenth: "#D13C17", red: "#C4314B",
    },
    Dark: {
        panels: "#1F1F22", side: "#18181B", hover: "#E6E3DC14", device: "#18181B", field: "#18181B",
        border: "#36363B", borderh: "#96969B", text: "#E6E3DC", muted: "#96969B", faint: "#77777C", onaccent: "#1F1F22",
        accent: "#FF5C38", accenth: "#FF7552", red: "#E5484D",
    },
};
// Obsidian works these out from its own colours once, on the page: with a theme of Vellum's they are worked out again on
// the editor, from the theme's
export const UI_DERIVED: Record<string, string> = {
    "--background-primary-alt": "var(--background-secondary)", "--background-secondary-alt": "var(--background-secondary)",
    "--interactive-normal": "color-mix(in srgb, var(--text-normal) 7%, var(--background-primary))",
    "--interactive-hover": "color-mix(in srgb, var(--text-normal) 12%, var(--background-primary))",
    "--background-modifier-active-hover": "color-mix(in srgb, var(--interactive-accent) 15%, transparent)",
    "--icon-color": "var(--text-muted)", "--icon-color-hover": "var(--text-normal)", "--icon-color-active": "var(--interactive-accent)", "--icon-color-focused": "var(--text-normal)",
    "--text-accent": "var(--interactive-accent)", "--text-accent-hover": "var(--interactive-accent-hover)",
    "--text-selection": "color-mix(in srgb, var(--interactive-accent) 30%, transparent)",
    "--scrollbar-bg": "transparent", "--scrollbar-thumb-bg": "color-mix(in srgb, var(--text-normal) 16%, transparent)",
    "--scrollbar-active-thumb-bg": "color-mix(in srgb, var(--text-normal) 28%, transparent)",
    "--background-modifier-border-focus": "var(--text-muted)", "--caret-color": "var(--text-normal)",
};
// light or dark, by how bright a theme's panels are (a colour not in hex: unknown)
export const modeOf = (ui: Record<string, string>): "light" | "dark" | undefined => {
    const m = /^#([0-9a-f]{6})/i.exec(ui.panels ?? ""); if (!m) return undefined;
    const n = parseInt(m[1], 16), y = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return y < 128 ? "dark" : "light";
};

export const BASE_KINDS: Kind[] = [
    { id: "hero", icon: "hash", name: "summary / number", color: "var(--color-blue)" },
    { id: "nav", icon: "heading", name: "title / nav", color: "var(--text-faint)" },
    { id: "card", icon: "square", name: "card", color: "var(--color-purple)" },
    { id: "list", icon: "list", name: "list", color: "var(--color-yellow)" },
    { id: "tiles", icon: "layout-grid", name: "tiles / grid", color: "var(--color-green)" },
    { id: "action", icon: "pointer", name: "input / action", color: "var(--color-pink)" },
    { id: "float", icon: "layers", name: "floating", color: "var(--color-cyan)" },
];

export const colorOf = (t: Theme, c?: string) => (!c || c === "none" ? "transparent" : t.colors[c] ?? c);
const fontOf = (t: Theme, f?: string) => (f ? t.fonts[f] ?? f : t.fonts.ui);
// a picture's address: https:// (and data:, app:) as it is; anything else is a vault path (the plugin sets how it resolves)
let resolve = (src: string) => src;
export const setPictureResolver = (fn: (src: string) => string) => { resolve = fn; };
export const pictureUrl = (src?: string) => { const s = (src ?? "").trim(); return !s ? "" : /^(https?|data|app|blob|file):/i.test(s) ? s : resolve(s.replace(/^\/+/, "")); };
const loaded = new Set<string>();
// a box's own look: its fill, a radius, an outline all round or on some sides only ("t" "r" "b" "l"), drawn inside it
// (nothing in it moves). All round: an inset shadow. Some sides: a stripe along each, under the fill's colour layer; an
// inset shadow with an offset leaves hairlines on the other sides once the phone is scaled
export const applyLook = (t: Theme, s: CSSStyleDeclaration, o: { fill?: string; stroke?: string; sw?: number; r?: number | number[]; sides?: string }) => {
    const fill = o.fill && o.fill !== "none" ? colorOf(t, o.fill) : "";
    if (fill) s.background = fill;
    if (o.r) s.borderRadius = radiusOf(o.r);
    if (o.sw) {
        const c = colorOf(t, o.stroke ?? "line"), w = px(o.sw), sd = o.sides || "trbl";
        if (["t", "r", "b", "l"].every((x) => sd.includes(x))) { s.boxShadow = `inset 0 0 0 ${w} ${c}`; return; }
        const at = { t: `top / 100% ${w}`, b: `bottom / 100% ${w}`, l: `left / ${w} 100%`, r: `right / ${w} 100%` } as const;
        const lines = (["t", "b", "l", "r"] as const).filter((x) => sd.includes(x)).map((x) => `linear-gradient(${c}, ${c}) ${at[x]} no-repeat`);
        s.background = [...lines, fill].filter(Boolean).join(", ");
    }
};   // pictures already shown once: drawn again (a drag, a redraw) without the tile flashing
// a corner radius: one number, or four (top left, top right, bottom right, bottom left)
export const radiusOf = (r?: number | number[]) => (Array.isArray(r) ? [0, 1, 2, 3].map((i) => px(Number(r[i] ?? r[0]) || 0)).join(" ") : px(r ?? 0));
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

// draw an item into its parent (a block, a row / column, a group); every element gets data-id, the top-level one data-top
// (an item in a group is placed as in a block, in the group's box, but is not top-level: data-in-group)
export const drawItem = (t: Theme, parent: HTMLElement, it: Item, inFlow?: "row" | "col", lineUp: "left" | "center" | "right" = "left", inGroup = false): HTMLElement => {
    const el = parent.createDiv({ cls: `vl-it vl-i-${it.type}` + (it.lock ? " is-lock" : ""), attr: { "data-id": it.id } });
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
            // its own box: fill, outline, radius, padding; with a set height the text sits in the middle of it
            if (it.fill || it.sw || it.pad) {
                applyLook(t, s, it);
                if (it.pad) s.padding = px(it.pad);
                if (typeof it.h === "number" || it.h === "fill") { s.display = "flex"; s.alignItems = "center"; s.justifyContent = s.textAlign === "center" ? "center" : s.textAlign === "right" ? "flex-end" : "flex-start"; }
            }
            break;
        }
        case "rect": case "ellipse": {
            s.background = colorOf(t, it.fill);
            if (it.sw) s.border = `${px(it.sw)} solid ${colorOf(t, it.stroke ?? "line")}`;
            s.borderRadius = it.type === "ellipse" ? "50%" : radiusOf(it.r);
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
        case "img": {
            // a soft tile with an image icon while the picture loads, or when it can not be loaded; never a broken glyph
            s.borderRadius = radiusOf(it.r);
            if (it.w === "hug" || it.w === undefined) s.width = "80px";
            if (it.h === "hug" || it.h === undefined) s.height = "80px";
            setIcon(el.createDiv({ cls: "vl-imgph" }), "image");
            const url = pictureUrl(it.src);
            if (!url) break;
            const im = el.createEl("img", { attr: { alt: "", draggable: "false", decoding: "async" } });
            im.style.objectFit = it.fit ?? "cover";
            im.style.objectPosition = it.pos?.trim() || "center";
            const ok = () => { loaded.add(url); el.addClass("is-loaded"); };
            const bad = () => { loaded.delete(url); im.remove(); el.removeClass("is-loaded"); el.addClass("is-broken"); const ph = el.querySelector<HTMLElement>(".vl-imgph"); if (ph) { ph.empty(); setIcon(ph, "image-off"); } };
            im.addEventListener("load", ok, { once: true });
            im.addEventListener("error", bad, { once: true });
            if (loaded.has(url)) el.addClass("is-loaded");
            im.src = url;
            if (im.complete && im.naturalWidth) ok();
            break;
        }
        case "icon": {
            // a Lucide icon by name (Obsidian's set); an unknown name is a small "?" box, not nothing
            const sz = px(it.size ?? 20);
            s.width = sz; s.height = sz;
            s.color = colorOf(t, it.color ?? "text");
            s.setProperty("--icon-size", sz);
            if (it.sw) s.setProperty("--icon-stroke", px(it.sw));
            const name = (it.name ?? "").trim();
            if (name) setIcon(el, name);
            if (!el.querySelector("svg")) { el.empty(); el.addClass("is-unknown"); el.setText("?"); }
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
            if (it.r) s.borderRadius = radiusOf(it.r);
            const up = it.type === "col" ? ({ start: "left", center: "center", end: "right" } as const)[it.cross ?? "start"] : "left";
            for (const c of it.items ?? []) drawItem(t, el, c, it.type, up);
            break;
        }
        case "group": {
            // its box is the room its items are placed in (by gravity, as in a block); nothing of its own is drawn
            if (typeof it.w !== "number" && it.w !== "fill") s.width = "40px";
            if (typeof it.h !== "number" && it.h !== "fill") s.height = "40px";
            for (const c of it.items ?? []) drawItem(t, el, c, undefined, "left", true);
            break;
        }
    }
    if (inGroup) el.setAttr("data-in-group", "1");
    else if (!inFlow) el.setAttr("data-top", "1");
    return el;
};
