// Vellum: a page layout tool for designing screens together with an AI agent. Knows no app.
// A ```vellum block holds a doc: a device and pages; a page has blocks (what each part of the screen is, its kind); a block
// has items (text, shapes, rows / columns of items) placed by gravity. Small JSON, one page per line, so git diffs and the
// agent read exactly what changed.

export type Gravity = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";
export type Size = number | "hug" | "fill";
export type ItemType = "text" | "rect" | "ellipse" | "line" | "row" | "col" | "group" | "img" | "icon";

export interface Item {
    id: string; type: ItemType; note?: string;
    lock?: boolean;         // drawn, but a click on the screen goes through it (chosen from the panel's lists)
    g?: Gravity;            // the block's point the item keeps (default tl); ignored inside a row / column
    dx?: number; dy?: number;   // offset from that point, inward (px)
    w?: Size; h?: Size;     // fixed px, hug the content, fill the block (or the row's room)
    // text
    // a text can have a box of its own (fill, stroke, sw, r, pad below): a chip, a tile, a button
    v?: string; size?: number; wt?: number; font?: string; color?: string; ls?: number; lh?: number; upper?: boolean;
    // shapes (rect, ellipse, line)
    // r: one radius for every corner, or four, clockwise from the top left ([tl, tr, br, bl], as CSS border-radius)
    fill?: string; stroke?: string; sw?: number; r?: number | number[]; op?: number;
    // img: a picture by address (https://…) or a vault path; fit as CSS object-fit, pos as CSS object-position
    src?: string; fit?: "cover" | "contain" | "fill"; pos?: string;
    // icon: a Lucide icon by name (Obsidian's set), drawn size × size in color (sw: its stroke width, else the theme's)
    name?: string;
    // row / col (items stacked, in flow); group (items each placed in the group's box by its own gravity / offset, moved as one)
    gap?: number; pad?: number; items?: Item[]; cross?: "start" | "center" | "end"; main?: "start" | "center" | "end" | "between";
}
// bleed: it may go into the safe areas (under the status bar, the home strip); else drags keep it inside them
// fill / stroke / sw / r / sides: the block's own look (a card's background, an outline, a separator on chosen sides:
// "t", "b", "tb"…); drawn by the block itself, so no rectangle under its items is needed
// lock: drawn, but a click, a drag or an area on the screen goes through it to what is under it (chosen from the lists)
export interface Block { id: string; name: string; kind: string; x: number; y: number; w: number; h: number; bleed?: boolean; lock?: boolean; fill?: string; stroke?: string; sw?: number; r?: number | number[]; sides?: string; note?: string; items: Item[] }
// a mark: a note on a screen for the people (and the agent) designing it, never part of the design. note: a pin at x, y
// with its text; area: a box x, y, w, h with a label, and a composition guide drawn in it if wanted; line: a guide line
// across (axis y, at y) or down (axis x, at x) with a label. Drags snap to lines and areas. by: who wrote it ("agent")
export type Guide = "thirds" | "phi" | "spiral" | "diag" | "center";
// size: its text's size (11 if not set); a note's w: its bubble's width (else as wide as its text, up to 200)
export interface Mark { id: string; kind: "note" | "area" | "line"; x: number; y: number; w?: number; h?: number; size?: number; axis?: "x" | "y"; text?: string; color?: string; guide?: Guide; corner?: "tl" | "tr" | "bl" | "br"; land?: boolean; by?: string }
// parent: the page it is opened from (none = a main page, a tab); link: how you get there ("tap a row"); the map draws the tree
// inherit: the parent is its frame (a layout template): the parent's blocks are drawn under its own, a block of its own with
// the same id as one of the frame's takes that one's place (an override); the page keeps only its own blocks
export interface Page { id: string; name: string; note?: string; parent?: string; link?: string; inherit?: boolean; device?: string; side?: boolean; land?: Block[]; mock?: boolean; bg?: string; marks?: Mark[]; blocks: Block[] }   // bg: the screen colour (a theme name or #hex), default paper
// safe / safeLand: the safe areas set for this doc (each side optional), upright and sideways; else the device's own
export type Insets = { top: number; bottom: number; left: number; right: number };
// radius: the screen's corner for every screen (0: square), else the device's. bar: the status bar drawn over the top safe
// area: iOS (the default), Android (clock left, signal and battery right, on its own fill / ink) or none
export interface Bar { style?: "ios" | "android" | "none"; fill?: string; ink?: string; time?: string }
// colors: this app's own screen colours over Settings → Vellum (names left out follow the settings); themes: named palettes
// over those (light, dark…), theme: the one the app opens in ("auto": light or dark as Obsidian is); none: the Obsidian colours
export type Palette = Record<string, string>;
export interface Doc { id: string; device: string; safe?: Partial<Insets>; safeLand?: Partial<Insets>; radius?: number; bar?: Bar; colors?: Palette; themes?: Record<string, Palette>; theme?: string; pages: Page[] }
// the doc's frame fields as read from a file (only what can be drawn)
export const frameOfDoc = (v: { radius?: unknown; bar?: unknown }, doc: Doc) => {
    if (typeof v.radius === "number" && v.radius >= 0) doc.radius = v.radius;
    const b = v.bar as Record<string, unknown> | undefined;
    if (b && typeof b === "object") {
        const bar: Bar = {};
        if (b.style === "ios" || b.style === "android" || b.style === "none") bar.style = b.style;
        for (const k of ["fill", "ink", "time"] as const) if (typeof b[k] === "string" && b[k]) bar[k] = b[k];
        if (Object.keys(bar).length) doc.bar = bar;
    }
};

export const GRAVITIES: Gravity[] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
export const uid = () => Math.random().toString(36).slice(2, 8);

export const parseDoc = (source: string): { doc: Doc; error?: string } => {
    const empty: Doc = { id: uid(), device: "iphone-16-pro", pages: [] };
    if (!source.trim()) return { doc: empty };
    try {
        const v = JSON.parse(source) as Partial<Doc>;
        if (!v || typeof v !== "object" || !Array.isArray(v.pages)) return { doc: empty, error: "A vellum block is a JSON object with a pages list." };
        const ok = (list: Block[]) => list.filter((b) => b && typeof b.x === "number").map((b) => ({ ...b, items: Array.isArray(b.items) ? b.items : [] }));
        const pages = v.pages.filter((p) => p && typeof p.id === "string" && Array.isArray(p.blocks)).map((p) => {
            const q: Page = { ...p, name: String(p.name ?? "Page"), blocks: ok(p.blocks) };
            if (Array.isArray(p.land)) q.land = ok(p.land); else delete q.land;
            // older docs: a screen drawn sideways only (side: true) is a landscape layout with no portrait one
            if (q.side) { if (!q.land) { q.land = q.blocks; q.blocks = []; } delete q.side; }
            if (q.inherit !== true) delete q.inherit;
            // marks: only those that can be drawn (a kind and a place)
            if (Array.isArray(p.marks)) { q.marks = p.marks.filter((m) => m && typeof m.id === "string" && ["note", "area", "line"].includes(m.kind) && typeof m.x === "number" && typeof m.y === "number"); if (!q.marks.length) delete q.marks; } else delete q.marks;
            return q;
        });
        const doc: Doc = { id: typeof v.id === "string" ? v.id : uid(), device: typeof v.device === "string" ? v.device : empty.device, pages };
        const sf = insetsOf(v.safe), sl = insetsOf(v.safeLand);
        if (sf) doc.safe = sf; if (sl) doc.safeLand = sl;
        frameOfDoc(v, doc); coloursOfDoc(v, doc);
        return { doc };
    } catch (e) {
        return { doc: empty, error: `The vellum JSON could not be read: ${(e as Error).message}` };
    }
};
// one page per line: a change to a page is one line in git
export const serialiseDoc = (d: Doc) => `{"id": ${JSON.stringify(d.id)}, "device": ${JSON.stringify(d.device)}, ` + (d.safe ? `"safe": ${JSON.stringify(d.safe)}, ` : "") + (d.safeLand ? `"safeLand": ${JSON.stringify(d.safeLand)}, ` : "") + (d.radius !== undefined ? `"radius": ${d.radius}, ` : "") + (d.bar ? `"bar": ${JSON.stringify(d.bar)}, ` : "") + (d.colors ? `"colors": ${JSON.stringify(d.colors)}, ` : "") + (d.themes ? `"themes": ${JSON.stringify(d.themes)}, ` : "") + (d.theme ? `"theme": ${JSON.stringify(d.theme)}, ` : "") + `"pages": [\n` + d.pages.map((p) => "  " + JSON.stringify(p)).join(",\n") + "\n]}";

// the doc's own colours as read from a file: names to strings only; a palette with none is left out
const paletteOf = (v: unknown): Palette | undefined => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const out: Palette = {};
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) if (k && typeof c === "string" && c.trim()) out[k] = c.trim();
    return Object.keys(out).length ? out : undefined;
};
export const coloursOfDoc = (v: { colors?: unknown; themes?: unknown; theme?: unknown }, doc: Doc) => {
    const c = paletteOf(v.colors); if (c) doc.colors = c;
    if (v.themes && typeof v.themes === "object" && !Array.isArray(v.themes)) {
        const t: Record<string, Palette> = {};
        for (const [k, p] of Object.entries(v.themes as Record<string, unknown>)) if (k && p && typeof p === "object" && !Array.isArray(p)) t[k] = paletteOf(p) ?? {};   // an empty theme stays (every name from the settings)
        if (Object.keys(t).length) doc.themes = t;
    }
    if (typeof v.theme === "string" && v.theme) doc.theme = v.theme;
};
// the theme on show: the one asked for (the editor's switch; "" the Obsidian colours), else the doc's; "auto" is dark or
// light as Obsidian is, when the doc has both. None (the Obsidian colours: Settings → Vellum, then the doc's colors) when
// none is set or the name is not one of its themes
export const themeOn = (doc: Doc, dark: boolean, pick?: string): string | undefined => {
    const t = doc.themes; if (!t) return undefined;
    let n = pick ?? doc.theme;
    if (!n) return undefined;
    if (n === "auto") n = dark ? "dark" : "light";
    return n in t ? n : undefined;
};
export const hasAuto = (doc: Doc) => !!doc.themes?.light && !!doc.themes?.dark;
// the doc's colours on show: its own, then the theme's over them
export const docColours = (doc: Doc, theme?: string): Palette => ({ ...doc.colors, ...(theme ? doc.themes?.[theme] : undefined) });

// safe area overrides as read: only numbers 0–400 on the four sides, none = undefined
export const insetsOf = (v: unknown): Partial<Insets> | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const out: Partial<Insets> = {};
    for (const k of ["top", "bottom", "left", "right"] as const) { const n = (v as Record<string, unknown>)[k]; if (typeof n === "number" && n >= 0 && n <= 400) out[k] = n; }
    return Object.keys(out).length ? out : undefined;
};
// gravity as its two axes: -1 start, 0 middle, 1 end
export const axes = (g: Gravity = "tl"): [number, number] => [g.includes("l") ? -1 : g.includes("r") ? 1 : 0, g.includes("t") ? -1 : g.includes("b") ? 1 : 0];
export const gravityOf = (x: number, y: number): Gravity => GRAVITIES[(y + 1) * 3 + (x + 1)];

// every item, nested ones too, with its parent list (to select, move up / down, delete)
export const findItem = (items: Item[], id: string): { item: Item; list: Item[] } | null => {
    for (const it of items) {
        if (it.id === id) return { item: it, list: items };
        if (it.items) { const f = findItem(it.items, id); if (f) return f; }
    }
    return null;
};
// the item an item sits in (a row, a column, a group), none at the top of its block
export const parentOf = (items: Item[], id: string, up: Item | null = null): Item | null | undefined => {
    for (const it of items) {
        if (it.id === id) return up;
        if (it.items) { const f = parentOf(it.items, id, it); if (f !== undefined) return f; }
    }
    return undefined;
};
export const cloneItem = (it: Item): Item => ({ ...(JSON.parse(JSON.stringify(it)) as Item), id: uid(), ...(it.items ? { items: it.items.map(cloneItem) } : {}) });

// new items as the + buttons make them
export const newItem = (type: ItemType): Item => {
    const id = uid();
    switch (type) {
        case "text": return { id, type, v: "Text", size: 15, g: "tl", dx: 16, dy: 16 };
        case "rect": return { id, type, g: "tl", dx: 16, dy: 16, w: 80, h: 48, fill: "tile", r: 8 };
        case "ellipse": return { id, type, g: "tl", dx: 16, dy: 16, w: 48, h: 48, fill: "tile" };
        case "line": return { id, type, g: "t", dx: 0, dy: 16, w: "fill", h: 1, fill: "line" };
        case "row": return { id, type, g: "tl", dx: 16, dy: 16, gap: 8, cross: "center", items: [{ id: uid(), type: "text", v: "One", size: 13 }, { id: uid(), type: "text", v: "Two", size: 13 }] };
        case "col": return { id, type, g: "tl", dx: 16, dy: 16, gap: 4, items: [{ id: uid(), type: "text", v: "Line one", size: 15 }, { id: uid(), type: "text", v: "Line two", size: 13, color: "dim" }] };
        case "img": return { id, type, g: "tl", dx: 16, dy: 16, w: 120, h: 80, src: "", fit: "cover", r: 8 };
        case "icon": return { id, type, g: "tl", dx: 16, dy: 16, name: "sparkles", size: 20 };
        case "group": return { id, type, g: "tl", dx: 16, dy: 16, w: 80, h: 48, items: [] };
    }
};

// the app's structure as a tree: main pages (no parent, or a parent that is gone) and each page's sub pages, in doc order
export const childrenOf = (pages: Page[], id?: string) => pages.filter((p) => (id ? p.parent === id : !p.parent || !pages.some((q) => q.id === p.parent)));
// a page and every page under it (a parent can not be one of these: no loops)
export const subtreeOf = (pages: Page[], id: string): Set<string> => {
    const out = new Set<string>([id]);
    for (let grew = true; grew;) { grew = false; for (const p of pages) if (p.parent && out.has(p.parent) && !out.has(p.id)) { out.add(p.id); grew = true; } }
    return out;
};

// a page's blocks as drawn, bottom first: its frame's (inherit: the parent's, as that one is drawn) with its own overrides in
// their places, then its own other blocks on top. from: the page an inherited block belongs to (where it is edited);
// over: an own block that takes the place of one of the frame's, and the page that one belongs to
export interface Layer { block: Block; from?: string; over?: string }
export const frameOf = (pages: Page[], p: Page) => (p.inherit && p.parent ? pages.find((q) => q.id === p.parent && q.id !== p.id) : undefined);
export const layersOf = (pages: Page[], p: Page, land: boolean, seen = new Set<string>()): Layer[] => {
    const own = (land ? p.land : p.blocks) ?? [], par = frameOf(pages, p);
    if (!par || seen.has(p.id)) return own.map((block) => ({ block }));   // seen: a loop of frames (a hand-made file) ends here
    seen.add(p.id);
    const base = layersOf(pages, par, land, seen).map((l) => ({ block: l.block, from: l.from ?? par.id }));
    const mine = new Map(own.map((b) => [b.id, b]));
    const out: Layer[] = base.map((l) => { const b = mine.get(l.block.id); return b ? { block: b, over: l.from } : l; });
    for (const b of own) if (!base.some((l) => l.block.id === b.id)) out.push({ block: b });
    return out;
};
export const drawnBlocks = (pages: Page[], p: Page, land: boolean) => layersOf(pages, p, land).map((l) => l.block);
// the screen colour: its own, else its frame's
export const bgOf = (pages: Page[], p: Page, seen = new Set<string>()): string | undefined => {
    if (p.bg || seen.has(p.id)) return p.bg;
    seen.add(p.id);
    const f = frameOf(pages, p);
    return f ? bgOf(pages, f, seen) : undefined;
};
