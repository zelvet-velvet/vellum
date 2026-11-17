// Overlays: guides drawn over a screen while designing, never part of it. Layout grids (an even grid as lines or dots,
// columns, rows), composition guides (thirds, the golden ratio grid, the golden spiral, diagonals / golden triangles /
// the harmonic armature, the centre) and perspective (one or two vanishing points with their rays), each with labels
// (where a line falls, its ratio). Lines keep 1 px on the monitor at any zoom (iz = 1 / zoom). Kept on the device, per
// note: a viewing aid, like a crop overlay, not part of the design.

export type Room = { l: number; t: number; r: number; b: number };
export interface OvlCfg {
    show: boolean; notes: boolean; labels: boolean;
    snap: boolean; ratio: boolean; inShow: boolean; opacity: number;
    area: { x: number; y: number; w: number; h: number } | null;   // where the composition guides are drawn (screen points); none: the whole screen
    grid: { on: boolean; size: number; dots: boolean };
    cols: { on: boolean; count: number; margin: number; gutter: number };
    rows: { on: boolean; count: number; margin: number; gutter: number };
    thirds: { on: boolean };
    phi: { on: boolean };
    spiral: { on: boolean; flipX: boolean; flipY: boolean };
    diag: { on: boolean; style: "x" | "tri" | "arm" };
    center: { on: boolean };
    persp: { on: boolean; two: boolean; x: number; y: number; x2: number; rays: number };   // the points as fractions of the screen
}
export const OVL_DEFAULT: OvlCfg = {
    show: true, notes: true, labels: true, area: null, snap: true, ratio: true, inShow: false, opacity: 0.8,
    grid: { on: false, size: 8, dots: false },
    cols: { on: false, count: 4, margin: 16, gutter: 16 },
    rows: { on: false, count: 6, margin: 16, gutter: 16 },
    thirds: { on: false },
    phi: { on: false },
    spiral: { on: false, flipX: false, flipY: false },
    diag: { on: false, style: "tri" },
    center: { on: false },
    persp: { on: false, two: false, x: 0.5, y: 0.4, x2: 1.4, rays: 24 },
};
// a stored setting over the defaults (a newer version may add fields)
export const ovlOf = (raw: unknown): OvlCfg => {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>, out = JSON.parse(JSON.stringify(OVL_DEFAULT)) as OvlCfg;
    for (const k of Object.keys(out) as (keyof OvlCfg)[]) {
        const v = o[k];
        if (v === undefined) continue;
        if (out[k] !== null && typeof out[k] === "object") Object.assign(out[k] as object, v as object);
        else (out as unknown as Record<string, unknown>)[k] = v;
    }
    return out;
};
export const compOn = (c: OvlCfg) => c.thirds.on || c.phi.on || c.spiral.on || c.diag.on || c.center.on;
export const anyOn = (c: OvlCfg) => c.grid.on || c.cols.on || c.rows.on || c.thirds.on || c.phi.on || c.spiral.on || c.diag.on || c.center.on || c.persp.on;

const PHI = (1 + Math.sqrt(5)) / 2;
// each guide has its colour (columns red as in most tools, the golden ones gold)
export const OVL_COLORS = { grid: "#8a8f98", cols: "#ff4d6d", rows: "#ff4d6d", thirds: "#22b8cf", phi: "#f2a516", spiral: "#f2a516", diag: "#9b6dff", center: "#22b8cf", persp: "#2fbf71" };

// the room the columns / rows divide: inside the safe areas, less the margin
const span = (a: number, b: number, n: number, margin: number, gutter: number) => {
    const x0 = a + margin, x1 = b - margin, n1 = Math.max(1, Math.round(n)), w = (x1 - x0 - gutter * (n1 - 1)) / n1;
    return w > 0 ? Array.from({ length: n1 }, (_, i) => [x0 + i * (w + gutter), w] as [number, number]) : [];
};

// the lines a drag may snap to (screen points): the edges of the columns and rows, thirds, golden lines, the middle
export function overlayLines(c: OvlCfg, W: number, H: number, room: Room) {
    const x: number[] = [], y: number[] = [];
    if (!c.show || !c.snap) return { x, y };
    if (c.cols.on) for (const [a, w] of span(room.l, room.r, c.cols.count, c.cols.margin, c.cols.gutter)) x.push(a, a + w);
    if (c.rows.on) for (const [a, h] of span(room.t, room.b, c.rows.count, c.rows.margin, c.rows.gutter)) y.push(a, a + h);
    const A = c.area ?? { x: 0, y: 0, w: W, h: H }, ax = (f: number) => A.x + A.w * f, ay = (f: number) => A.y + A.h * f;
    if (c.thirds.on) { x.push(ax(1 / 3), ax(2 / 3)); y.push(ay(1 / 3), ay(2 / 3)); }
    if (c.phi.on) { x.push(ax(1 / PHI / PHI), ax(1 / PHI)); y.push(ay(1 / PHI / PHI), ay(1 / PHI)); }
    if (c.center.on) { x.push(ax(0.5)); y.push(ay(0.5)); }
    if (c.area && compOn(c)) { x.push(A.x, A.x + A.w); y.push(A.y, A.y + A.h); }
    return { x, y };
}

// a ratio as words: 1 : 2.17, and the well-known one it is close to (within 1.5 %)
const NAMED: [number, string][] = [[1, "1:1"], [5 / 4, "5:4"], [4 / 3, "4:3"], [3 / 2, "3:2"], [Math.SQRT2, "√2"], [PHI, "φ"], [16 / 10, "16:10"], [16 / 9, "16:9"], [2, "2:1"], [19.5 / 9, "19.5:9"], [21 / 9, "21:9"]];
export function ratioText(w: number, h: number) {
    if (!(w > 0 && h > 0)) return "";
    const r = Math.max(w, h) / Math.min(w, h), wide = w >= h;
    const n = NAMED.find(([v]) => Math.abs(r - v) / v < 0.015);
    const turn = (s: string) => (wide || s === "1:1" ? s : s.includes(":") ? s.split(":").reverse().join(":") : `1:${s}`);
    const num = wide ? `${r.toFixed(2)} : 1` : `1 : ${r.toFixed(2)}`;
    return `${Math.round(w)} × ${Math.round(h)} · ${num}` + (n ? ` ≈ ${turn(n[1])}` : "");
}

let uidN = 0;
// the overlay as an SVG over the screen (screen points). handles: the vanishing points, to drag (the editor listens)
// tint: one colour for every guide (an area mark's guides take the mark's colour); foot: the screen's size and ratio
export function drawOverlay(scr: HTMLElement, c: OvlCfg, W: number, H: number, room: Room, z: number, o: { tint?: string; foot?: boolean } = {}): SVGSVGElement {
    const C = o.tint ? (Object.fromEntries(Object.keys(OVL_COLORS).map((k) => [k, o.tint])) as typeof OVL_COLORS) : OVL_COLORS;
    const iz = 1 / z, fs = 10 * iz, id = `vl-ovl-${++uidN}`;
    const svg = scr.createSvg("svg", { cls: "vl-ovl", attr: { width: W, height: H, viewBox: `0 0 ${W} ${H}` } });
    svg.style.opacity = String(c.opacity);
    const defs = svg.createSvg("defs");
    const clip = defs.createSvg("clipPath", { attr: { id: `${id}-clip` } });
    clip.createSvg("rect", { attr: { x: 0, y: 0, width: W, height: H } });
    const root = svg.createSvg("g", { attr: { "clip-path": `url(#${id}-clip)`, "stroke-width": iz, fill: "none" } });
    const labels = svg.createSvg("g", { cls: "vl-ovl-labels" });
    const g = (color: string) => root.createSvg("g", { attr: { stroke: color } });
    const ln = (p: SVGElement, x1: number, y1: number, x2: number, y2: number, dash = false) => p.createSvg("line", { attr: { x1, y1, x2, y2, ...(dash ? { "stroke-dasharray": `${4 * iz} ${3 * iz}` } : {}) } });
    // a label: small, with a halo so it reads over anything; kept inside the screen
    const tx = (color: string, x: number, y: number, text: string, anchor: "start" | "middle" | "end" = "start", base: "hanging" | "auto" | "middle" = "hanging") => {
        if (!c.labels) return;
        const pad = 3 * iz;
        x = Math.min(W - pad, Math.max(pad, x)); y = Math.min(H - pad, Math.max(pad, y));
        const t = labels.createSvg("text", { attr: { x, y, "font-size": fs, "text-anchor": anchor, "dominant-baseline": base, "stroke-width": 3 * iz } });
        t.style.fill = color;   // a style, not an attribute: the colour may be a CSS variable
        t.textContent = text;
    };
    const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

    // the even grid: a pattern (thousands of lines or dots cost nothing); hidden while too dense to see
    if (c.grid.on && c.grid.size * z >= 4) {
        const s = c.grid.size, pat = defs.createSvg("pattern", { attr: { id: `${id}-grid`, width: s, height: s, patternUnits: "userSpaceOnUse" } });
        if (c.grid.dots) for (const [cx, cy] of [[0, 0], [s, 0], [0, s], [s, s]]) pat.createSvg("circle", { attr: { cx, cy, r: 1.2 * iz, fill: C.grid } });
        else pat.createSvg("path", { attr: { d: `M ${s} 0 L 0 0 0 ${s}`, fill: "none", stroke: C.grid, "stroke-width": iz, opacity: 0.55 } });
        root.createSvg("rect", { attr: { x: 0, y: 0, width: W, height: H, fill: `url(#${id}-grid)`, stroke: "none" } });
        tx(C.grid, room.l + 4 * iz, room.t + 4 * iz, `${s} pt ${c.grid.dots ? "dots" : "grid"}`);
    }
    // columns and rows: filled bands, as in a layout grid
    if (c.cols.on) {
        const gc = g(C.cols), cols = span(room.l, room.r, c.cols.count, c.cols.margin, c.cols.gutter);
        cols.forEach(([a, w], i) => {
            gc.createSvg("rect", { attr: { x: a, y: 0, width: w, height: H, fill: C.cols, "fill-opacity": 0.1, stroke: "none" } });
            ln(gc, a, 0, a, H); ln(gc, a + w, 0, a + w, H);
            tx(C.cols, a + w / 2, room.t + 4 * iz, String(i + 1), "middle");
        });
        if (cols.length) tx(C.cols, cols[0][0] + 2 * iz, room.b - 4 * iz, `${cols.length} cols · ${fmt(cols[0][1])} pt · gutter ${c.cols.gutter} · margin ${c.cols.margin}`, "start", "auto");
    }
    if (c.rows.on) {
        const gr = g(C.rows), rows = span(room.t, room.b, c.rows.count, c.rows.margin, c.rows.gutter);
        rows.forEach(([a, h], i) => {
            gr.createSvg("rect", { attr: { x: 0, y: a, width: W, height: h, fill: C.rows, "fill-opacity": 0.07, stroke: "none" } });
            ln(gr, 0, a, W, a); ln(gr, 0, a + h, W, a + h);
            tx(C.rows, room.r - 4 * iz, a + h / 2, String(i + 1), "end", "middle");
        });
        if (rows.length) tx(C.rows, room.r - 4 * iz, rows[0][0] + 2 * iz, `${rows.length} rows · ${fmt(rows[0][1])} pt`, "end");
    }
    // thirds: the lines and the four points where they cross (where the eye goes)
    if (c.thirds.on) {
        const gt = g(C.thirds), col = C.thirds;
        for (const f of [1 / 3, 2 / 3]) { ln(gt, W * f, 0, W * f, H); ln(gt, 0, H * f, W, H * f); }
        for (const fx of [1 / 3, 2 / 3]) for (const fy of [1 / 3, 2 / 3]) gt.createSvg("circle", { attr: { cx: W * fx, cy: H * fy, r: 3 * iz, fill: col, stroke: "none" } });
        tx(col, W / 3 + 3 * iz, 4 * iz, "⅓"); tx(col, (2 * W) / 3 + 3 * iz, 4 * iz, "⅔");
        tx(col, 4 * iz, H / 3 + 3 * iz, "⅓"); tx(col, 4 * iz, (2 * H) / 3 + 3 * iz, "⅔");
    }
    // the golden ratio grid (phi grid): the lines at 0.382 and 0.618
    if (c.phi.on) {
        const gp = g(C.phi), col = C.phi, a = 1 / PHI / PHI, b = 1 / PHI;
        for (const f of [a, b]) { ln(gp, W * f, 0, W * f, H); ln(gp, 0, H * f, W, H * f); }
        for (const fx of [a, b]) for (const fy of [a, b]) gp.createSvg("circle", { attr: { cx: W * fx, cy: H * fy, r: 3 * iz, fill: col, stroke: "none" } });
        tx(col, W * a + 3 * iz, H - 4 * iz, "0.382", "start", "auto"); tx(col, W * b + 3 * iz, H - 4 * iz, "0.618 · φ", "start", "auto");
        tx(col, W - 4 * iz, H * a + 3 * iz, "0.382", "end"); tx(col, W - 4 * iz, H * b + 3 * iz, "0.618", "end");
    }
    // the golden spiral: the golden rectangle stretched over the screen (as photo tools do), cut into squares, a
    // quarter circle in each; turned to the screen's long side, flipped either way
    if (c.spiral.on) {
        const gs = g(C.spiral), tall = H > W, { flipX, flipY } = c.spiral;
        const map = (X: number, Y: number): [number, number] => {
            let u = X / PHI, v = Y;
            if (tall) [u, v] = [v, u];
            if (flipX) u = 1 - u;
            if (flipY) v = 1 - v;
            return [u * W, v * H];
        };
        const sweep = (1 ^ (tall ? 1 : 0) ^ (flipX ? 1 : 0) ^ (flipY ? 1 : 0)) as 0 | 1;
        let x = 0, y = 0, w = PHI, h = 1, d = "";
        for (let i = 0; i < 10; i++) {
            const s = Math.min(w, h), side = i % 4;   // the square cut from the left, top, right, bottom in turn
            let sq: [number, number], from: [number, number], to: [number, number];
            if (side === 0) { sq = [x, y]; from = [x, y + s]; to = [x + s, y]; x += s; w -= s; }
            else if (side === 1) { sq = [x, y]; from = [x, y]; to = [x + s, y + s]; y += s; h -= s; }
            else if (side === 2) { sq = [x + w - s, y]; from = [x + w, y]; to = [x + w - s, y + s]; w -= s; }
            else { sq = [x, y + h - s]; from = [x + s, y + h]; to = [x, y + h - s]; h -= s; }
            const [ax, ay] = map(sq[0], sq[1]), [bx, by] = map(sq[0] + s, sq[1] + s);
            gs.createSvg("rect", { attr: { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), opacity: 0.45 } });
            const [fx, fy] = map(...from), [tx2, ty2] = map(...to);
            const rx = (tall ? s : s / PHI) * W, ry = (tall ? s / PHI : s) * H;
            d += `${d ? "" : `M ${fx} ${fy} `}A ${rx} ${ry} 0 0 ${sweep} ${tx2} ${ty2} `;
        }
        gs.createSvg("path", { attr: { d, "stroke-width": 1.5 * iz } });
        tx(C.spiral, flipX ? 4 * iz : W - 4 * iz, flipY ? 4 * iz : H - 4 * iz, "golden spiral · 1 : 1.618", flipX ? "start" : "end", flipY ? "hanging" : "auto");
    }
    // diagonals: the X; golden triangles (a diagonal, a line from each other corner meeting it square); the harmonic
    // armature (both diagonals and the four reciprocals, each from a corner, square to a diagonal)
    if (c.diag.on) {
        const gd = g(C.diag), col = C.diag, L = 4 * Math.max(W, H);
        const foot = (px: number, py: number, ax: number, ay: number, dx: number, dy: number): [number, number] => { const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy); return [ax + dx * t, ay + dy * t]; };
        const ray = (px: number, py: number, dx: number, dy: number) => { const n = Math.hypot(dx, dy); ln(gd, px, py, px + (dx / n) * L, py + (dy / n) * L); };
        if (c.diag.style === "tri") {
            ln(gd, 0, 0, W, H);
            const f1 = foot(W, 0, 0, 0, W, H), f2 = foot(0, H, 0, 0, W, H);
            ln(gd, W, 0, f1[0], f1[1]); ln(gd, 0, H, f2[0], f2[1]);
            for (const f of [f1, f2]) gd.createSvg("circle", { attr: { cx: f[0], cy: f[1], r: 3 * iz, fill: col, stroke: "none" } });
            tx(col, 4 * iz, 4 * iz, "golden triangles");
        } else {
            ln(gd, 0, 0, W, H); ln(gd, W, 0, 0, H);
            if (c.diag.style === "arm") {
                ray(W, 0, -H, W); ray(0, H, H, -W);   // square to the diagonal from the top left
                ray(0, 0, H, W); ray(W, H, -H, -W);   // square to the diagonal from the top right
                tx(col, 4 * iz, 4 * iz, "harmonic armature");
            }
        }
    }
    if (c.center.on) {
        const gc = g(C.center);
        ln(gc, W / 2, 0, W / 2, H, true); ln(gc, 0, H / 2, W, H / 2, true);
        tx(C.center, W / 2 + 3 * iz, H / 2 + 3 * iz, "½");
    }
    // perspective: one point (rays all round it, the horizon through it) or two on one horizon
    if (c.persp.on) {
        const gq = g(C.persp), col = C.persp, L = 4 * Math.max(W, H), hy = c.persp.y * H;
        const pts: [number, number][] = [[c.persp.x * W, hy], ...(c.persp.two ? [[c.persp.x2 * W, hy] as [number, number]] : [])];
        ln(gq, -L, hy, L, hy).setAttr("stroke-width", 1.5 * iz);
        const n = Math.max(4, Math.min(72, Math.round(c.persp.rays)));
        for (const [px, py] of pts) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ln(gq, px, py, px + Math.cos(a) * L, py + Math.sin(a) * L).setAttr("opacity", "0.6"); }
        tx(col, 4 * iz, hy - 3 * iz, "horizon", "start", "auto");
        pts.forEach(([px, py], i) => {
            const h = svg.createSvg("circle", { cls: "vl-vp", attr: { cx: px, cy: py, r: 6 * iz, fill: col, "stroke-width": 2 * iz, "data-vp": String(i + 1) } });
            h.createSvg("title").textContent = "Drag: the vanishing point (and the horizon)";
            tx(col, px + 9 * iz, py + 3 * iz, pts.length > 1 ? `VP${i + 1}` : "VP");
        });
    }
    // the screen's own size and ratio, at its foot
    if (c.labels && o.foot !== false) tx("var(--text-muted)", W - 4 * iz, room.b - 4 * iz - (c.cols.on ? 14 * iz : 0), ratioText(W, H), "end", "auto");
    return svg;
}
