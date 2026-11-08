// Vellum: a page layout tool for designing screens together with an AI agent. Knows no app.
// A ```vellum block holds a doc: a device and pages; a page has blocks (what each part of the screen is, its kind); a block
// has items (text, shapes, rows / columns of items) placed by gravity. Small JSON, one page per line, so git diffs and the
// agent read exactly what changed.

export type Gravity = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";
export type Size = number | "hug" | "fill";
export type ItemType = "text" | "rect" | "ellipse" | "line" | "row" | "col";

export interface Item {
    id: string; type: ItemType; note?: string;
    g?: Gravity;            // the block's point the item keeps (default tl); ignored inside a row / column
    dx?: number; dy?: number;   // offset from that point, inward (px)
    w?: Size; h?: Size;     // fixed px, hug the content, fill the block (or the row's room)
    // text
    v?: string; size?: number; wt?: number; font?: string; color?: string; ls?: number; lh?: number; upper?: boolean;
    // shapes (rect, ellipse, line)
    fill?: string; stroke?: string; sw?: number; r?: number; op?: number;
    // row / col
    gap?: number; pad?: number; items?: Item[]; cross?: "start" | "center" | "end"; main?: "start" | "center" | "end" | "between";
}
export interface Block { id: string; name: string; kind: string; x: number; y: number; w: number; h: number; note?: string; items: Item[] }
// parent: the page it is opened from (none = a main page, a tab); link: how you get there ("tap a row"); the map draws the tree
export interface Page { id: string; name: string; note?: string; parent?: string; link?: string; device?: string; side?: boolean; mock?: boolean; bg?: string; blocks: Block[] }   // bg: the screen colour (a theme name or #hex), default paper
export interface Doc { id: string; device: string; pages: Page[] }

export const GRAVITIES: Gravity[] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
export const uid = () => Math.random().toString(36).slice(2, 8);

export const parseDoc = (source: string): { doc: Doc; error?: string } => {
    const empty: Doc = { id: uid(), device: "iphone-16-pro", pages: [] };
    if (!source.trim()) return { doc: empty };
    try {
        const v = JSON.parse(source) as Partial<Doc>;
        if (!v || typeof v !== "object" || !Array.isArray(v.pages)) return { doc: empty, error: "A vellum block is a JSON object with a pages list." };
        const pages = v.pages.filter((p) => p && typeof p.id === "string" && Array.isArray(p.blocks)).map((p) => ({
            ...p, name: String(p.name ?? "Page"),
            blocks: p.blocks.filter((b) => b && typeof b.x === "number").map((b) => ({ ...b, items: Array.isArray(b.items) ? b.items : [] })),
        }));
        return { doc: { id: typeof v.id === "string" ? v.id : uid(), device: typeof v.device === "string" ? v.device : empty.device, pages } };
    } catch (e) {
        return { doc: empty, error: `The vellum JSON could not be read: ${(e as Error).message}` };
    }
};
// one page per line: a change to a page is one line in git
export const serialiseDoc = (d: Doc) => `{"id": ${JSON.stringify(d.id)}, "device": ${JSON.stringify(d.device)}, "pages": [\n` + d.pages.map((p) => "  " + JSON.stringify(p)).join(",\n") + "\n]}";

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
export const cloneItem = (it: Item): Item => ({ ...JSON.parse(JSON.stringify(it)), id: uid(), ...(it.items ? { items: it.items.map(cloneItem) } : {}) });

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
