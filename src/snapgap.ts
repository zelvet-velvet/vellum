// Equal spacing while dragging (no DOM): where a box would sit with the same gap on both sides of it, or with a gap that
// already exists between two of its neighbours. Boxes are in one frame's points (a block's items, or a screen's blocks).
export type Box = { L: number; T: number; W: number; H: number };
// at: the box's left (x) or top (y) there; gap: the gap it makes; spans: the gaps to mark, each [from, to] along the axis
export type GapStop = { at: number; gap: number; spans: [number, number][] };

// the neighbours along an axis: the boxes that share some of the other axis with it (a row for x, a column for y)
export function gapStops(me: Box, others: Box[], axis: "x" | "y"): GapStop[] {
    const lo = (b: Box) => (axis === "x" ? b.L : b.T), size = (b: Box) => (axis === "x" ? b.W : b.H);
    const across = (b: Box) => (axis === "x" ? b.T < me.T + me.H && me.T < b.T + b.H : b.L < me.L + me.W && me.L < b.L + b.W);
    const row = others.filter(across).sort((a, b) => lo(a) - lo(b));
    if (!row.length) return [];
    const mid = lo(me) + size(me) / 2, S = size(me);
    let before: Box | null = null, after: Box | null = null;
    for (const o of row) {
        if (lo(o) + size(o) <= mid && (!before || lo(o) + size(o) > lo(before) + size(before))) before = o;
        if (lo(o) >= mid && (!after || lo(o) < lo(after))) after = o;
    }
    const out: GapStop[] = [];
    const end = (b: Box) => lo(b) + size(b);
    // the same gap on both sides, between the two neighbours
    if (before && after) {
        const g = (lo(after) - end(before) - S) / 2;
        if (g >= 0) { const at = end(before) + g; out.push({ at, gap: Math.round(g), spans: [[end(before), at], [at + S, lo(after)]] }); }
    }
    // a gap already there between two others in the row: the same one beside a neighbour
    const gaps: [number, number][] = [];
    for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i], b = row[i + 1], g = lo(b) - end(a);
        if (g > 0 && !(a === before && b === after)) gaps.push([end(a), lo(b)]);   // (the one it sits in is not a gap)
    }
    for (const [f, t] of gaps) {
        const g = t - f;
        if (before) out.push({ at: end(before) + g, gap: Math.round(g), spans: [[f, t], [end(before), end(before) + g]] });
        if (after) out.push({ at: lo(after) - g - S, gap: Math.round(g), spans: [[f, t], [lo(after) - g, lo(after)]] });
    }
    return out;
}

// the stop nearest a position, within reach
export function nearStop(stops: GapStop[], at: number, reach: number): GapStop | null {
    let best: GapStop | null = null;
    for (const s of stops) if (Math.abs(s.at - at) <= reach && (!best || Math.abs(s.at - at) < Math.abs(best.at - at))) best = s;
    return best;
}

// a size within reach of a neighbour's: that size (resizing to match it)
export function sameSize(v: number, sizes: number[], reach: number): number | null {
    let best: number | null = null;
    for (const s of sizes) if (Math.abs(s - v) <= reach && (best === null || Math.abs(s - v) < Math.abs(best - v))) best = s;
    return best;
}
