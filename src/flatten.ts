import { axes, Block, gravityOf, Item } from "./model";
import { drawItem, Theme } from "./render";

// Ungroup: a row's, a column's or a group's items become items of what holds it (the block, or a group), each where it
// is drawn. A row's or column's own look (fill, outline, radius) stays behind them as a shape with its id, so nothing
// moves. Measured from the items as drawn (flex spacing, text widths), in a copy of the block drawn out of sight.

const isFlow = (it: Item) => it.type === "row" || it.type === "col";
const r2 = (v: number) => Math.round(v * 100) / 100;
// the offset from gravity's point, inward, as place() in render.ts reads it
const off = (a: number, L: number, W: number, room: number) => r2(a < 0 ? L : a > 0 ? room - L - W : L + W / 2 - room / 2);

// what can be ungrouped: a row, column or group right in the block or in a group (an item in a row stays in its flow)
export const canUngroup = (it: Item, holder: Item | null | undefined) => (isFlow(it) || it.type === "group") && (!holder || holder.type === "group");
// the rows and columns left in a block, at a level ungroup can reach (in the block, or in its groups)
const flowsIn = (items: Item[]): number => items.reduce((n, it) => n + (isFlow(it) ? 1 : it.type === "group" ? flowsIn(it.items ?? []) : 0), 0);

// one copy of the block at its own size (1 px a point), out of sight; removed once measured
const drawOff = (t: Theme, doc: Document, b: Block) => {
    const host = doc.body.createDiv({ cls: "vl-measure" });
    const el = host.createDiv({ cls: "vl-block" });
    el.setCssStyles({ width: `${b.w}px`, height: `${b.h}px` });
    for (const it of b.items) drawItem(t, el, it);
    return { host, el };
};

// a holder's items with the chosen ones (pick) replaced by what is in them; box: the holder's element, room its size
const spread = (list: Item[], box: HTMLElement, W: number, H: number, pick: (it: Item) => boolean): number => {
    let n = 0;
    const br = box.getBoundingClientRect();
    for (const c of [...list]) {
        const cEl = box.querySelector<HTMLElement>(`:scope > [data-id="${c.id}"]`);
        if (!cEl) continue;
        if (!pick(c)) {
            // a group not taken apart: the rows in it can be
            if (c.type === "group" && c.items) n += spread(c.items, cEl, cEl.offsetWidth, cEl.offsetHeight, pick);
            continue;
        }
        const at = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { L: r.left - br.left, T: r.top - br.top, W: r.width, H: r.height }; };
        const out: Item[] = [], flow = isFlow(c);
        // the row's own look, a shape behind its items, placed as the row was (its gravity, a fill width kept)
        if (flow && ((c.fill && c.fill !== "none") || c.sw)) {
            const r = at(cEl), [ax, ay] = axes(c.g);
            const s: Item = { id: c.id, type: "rect", g: gravityOf(c.w === "fill" ? -1 : ax, c.h === "fill" ? -1 : ay) };
            s.dx = c.w === "fill" ? c.dx ?? 0 : off(ax, r.L, r.W, W); s.dy = c.h === "fill" ? c.dy ?? 0 : off(ay, r.T, r.H, H);
            s.w = c.w === "fill" ? "fill" : r2(r.W); s.h = c.h === "fill" ? "fill" : r2(r.H);
            if (c.fill) s.fill = c.fill;
            if (c.sw) { s.sw = c.sw; if (c.stroke) s.stroke = c.stroke; }
            if (c.r) s.r = c.r;
            if (c.op !== undefined) s.op = c.op;
            if (c.note) s.note = c.note;
            out.push(s);
        }
        for (const k of c.items ?? []) {
            const kEl = cEl.querySelector<HTMLElement>(`:scope > [data-id="${k.id}"]`);
            if (!kEl) continue;
            const r = at(kEl);
            // a text's lines line up with its gravity: keep the side they lined up on (in a column, its Line up)
            let [ax, ay] = c.type === "group" ? axes(k.g) : [-1, -1];
            if (k.type === "text" && c.type === "col") ax = c.cross === "center" ? 0 : c.cross === "end" ? 1 : -1;
            k.g = gravityOf(ax, ay); k.dx = off(ax, r.L, r.W, W); k.dy = off(ay, r.T, r.H, H);
            if (k.w === "fill") k.w = r2(r.W);
            if (k.h === "fill") k.h = r2(r.H);
            if (c.op !== undefined) k.op = Math.round(((k.op ?? 100) * c.op) / 100);
            out.push(k);
        }
        list.splice(list.indexOf(c), 1, ...out);
        n++;
    }
    return n;
};

// ungroup the chosen items of a block (ids), or every row and column in it (ids none: again until none is left, so rows
// in rows come apart too; groups stay, the rows in them come apart in them). Changes the block; answers how many
export const ungroupBlock = (t: Theme, doc: Document, b: Block, ids?: Set<string>): number => {
    let n = 0;
    for (let i = 0; i < 32; i++) {
        if (!ids && !flowsIn(b.items)) break;
        const { host, el } = drawOff(t, doc, b);
        let k = 0;
        try { k = spread(b.items, el, b.w, b.h, ids ? (it) => ids.has(it.id) : isFlow); } finally { host.remove(); }
        n += k;
        if (ids || !k) break;
    }
    return n;
};
