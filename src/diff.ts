import type { Block, Item, Mark, Page } from "./model";

// What the user changed on a screen since it was built (its copy in _edited/ against the screen now), as lines an agent
// can build from without comparing the files itself: blocks and items by name and id, each field old → new; what was
// added in full (short), what was removed by name
const val = (v: unknown) => { const s = v === undefined ? "none" : JSON.stringify(v); return s.length > 80 ? s.slice(0, 77) + "…" : s; };
const whole = (v: unknown) => { const s = JSON.stringify(v); return s.length > 600 ? s.slice(0, 597) + "… (the rest in the screen's file)" : s; };
const itemName = (it: Item) => `${it.type}${it.type === "text" ? ` "${(it.v ?? "").split("\n")[0].slice(0, 30)}"` : it.type === "icon" ? ` ${it.name ?? ""}` : ""} ${it.id ?? ""}`.trim();
const blockName = (b: Block) => `block "${b.name}" (${b.id})`;
const keyOf = (x: { id?: string }, i: number) => x.id ?? `#${i}`;

// the fields that differ, one "k: old → new" each (a list of items or blocks is compared apart)
const fields = (a: Record<string, unknown>, b: Record<string, unknown>, skip: string[]) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${val(a[k])} → ${val(b[k])}`);

function items(was: Item[] = [], now: Item[] = [], at: string, out: string[]) {
    const old = new Map(was.map((x, i) => [keyOf(x, i), x])), cur = new Map(now.map((x, i) => [keyOf(x, i), x]));
    for (const [k, it] of cur) {
        const o = old.get(k);
        if (!o) { out.push(`- ${at}: ${itemName(it)} added: ${whole(it)}`); continue; }
        const f = fields(o as unknown as Record<string, unknown>, it as unknown as Record<string, unknown>, ["items"]);
        if (f.length) out.push(`- ${at}, ${itemName(it)}: ${f.join(", ")}`);
        if (o.items || it.items) items(o.items, it.items, `${at}, in ${itemName(it)}`, out);
    }
    for (const [k, it] of old) if (!cur.has(k)) out.push(`- ${at}: ${itemName(it)} removed`);
    const ow = was.map((x, i) => keyOf(x, i)).filter((k) => cur.has(k)), nw = now.map((x, i) => keyOf(x, i)).filter((k) => old.has(k));
    if (ow.join() !== nw.join()) out.push(`- ${at}: items in a new order: ${nw.join(", ")}`);
}

function blocks(was: Block[] = [], now: Block[] = [], layout: string, out: string[]) {
    const old = new Map(was.map((b) => [b.id, b])), cur = new Map(now.map((b) => [b.id, b]));
    for (const b of now) {
        const o = old.get(b.id);
        if (!o) { out.push(`- ${layout}${blockName(b)} added: ${whole(b)}`); continue; }
        const f = fields(o as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, ["items"]);
        if (f.length) out.push(`- ${layout}${blockName(b)}: ${f.join(", ")}`);
        items(o.items, b.items, `${layout}${blockName(b)}`, out);
    }
    for (const b of was) if (!cur.has(b.id)) out.push(`- ${layout}${blockName(b)} removed`);
    const ow = was.map((b) => b.id).filter((k) => cur.has(k)), nw = now.map((b) => b.id).filter((k) => old.has(k));
    if (ow.join() !== nw.join()) out.push(`- ${layout}blocks in a new order (bottom to top): ${nw.join(", ")}`);
}

function marks(was: Mark[] = [], now: Mark[] = [], out: string[]) {
    const old = new Map(was.map((m) => [m.id, m])), cur = new Map(now.map((m) => [m.id, m]));
    const name = (m: Mark) => `${m.kind}${m.text ? ` "${m.text.split("\n")[0].slice(0, 60)}"` : ""} (${m.id})`;
    for (const m of now) { const o = old.get(m.id); if (!o) out.push(`- mark ${name(m)} added`); else if (JSON.stringify(o) !== JSON.stringify(m)) out.push(`- mark ${name(m)} changed`); }
    for (const m of was) if (!cur.has(m.id)) out.push(`- mark ${name(m)} removed`);
}

export function describeEdit(was: Page, now: Page): string[] {
    const out: string[] = [];
    const f = fields(was as unknown as Record<string, unknown>, now as unknown as Record<string, unknown>, ["blocks", "land", "marks"]);
    if (f.length) out.push(`- the screen: ${f.join(", ")}`);
    blocks(was.blocks, now.blocks, "", out);
    if (was.land || now.land) blocks(was.land, now.land, "landscape, ", out);
    marks(was.marks, now.marks, out);
    return out;
}
