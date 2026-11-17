import { addIcon, App, FuzzySuggestModal, getIconIds, ItemView, MarkdownPostProcessorContext, MarkdownRenderChild, normalizePath, Notice, Platform, Plugin, setIcon, setTooltip, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { customDevice, deviceOf, DEVICES, screenOf } from "./devices";
import { axes, bgOf, Block, Guide, Mark, childrenOf, cloneItem, parentOf, Doc, drawnBlocks, findItem, frameOf, GRAVITIES, subtreeOf, Item, ItemType, Layer, layersOf, newItem, Page, parseDoc, serialiseDoc, uid } from "./model";
import { applyLook, BASE_KINDS, BASE_THEME, colorOf, drawItem, Kind, pictureUrl, setPictureResolver, Theme, UI_COLORS } from "./render";
import { getLocal, setLocal } from "./local";
import { FolderStore, srcOf } from "./store";
import { anyOn, compOn, drawOverlay, OvlCfg, overlayLines, ovlOf, OVL_COLORS, ratioText } from "./overlay";

// The Vellum editor in a ```vellum block. Desktop first (the phone checks): the pages as phones side by side; a tap on the
// screen chooses the page, on a block the block, on an item the item; drag moves it (blocks by x / y, items by their offset
// from their gravity point), a block's corner resizes it; the panel shows only what is chosen, as controls (no syntax).
// Keys: arrows nudge 1 px (shift 4), Delete, Ctrl+Z / Ctrl+Shift+Z, Ctrl+D duplicate, Ctrl+S save, Esc goes up a level (never out of the editor).
// Unsaved work is kept on the device (Obsidian's local storage, per vault) until saved into the note.
export interface VellumHost { theme?: Partial<Theme>; kinds?: Kind[]; ui?: Record<string, string> }   // ui: the editor's own colours that differ from Obsidian's

// snapping while dragging / resizing: to the grid, and (on) to the edges and middles of the frame (an item's block, a
// block's screen and safe area), margin lines inside it and the other items / blocks; Alt: none (1 px). Set in the plugin's
// settings; the magnet in the pill turns it on and off
export interface SnapCfg { on: boolean; dist: number; grid: number; margins: number[]; frame: boolean; others: boolean; guides: boolean }
export const SNAP_DEFAULT: SnapCfg = { on: true, dist: 6, grid: 4, margins: [16], frame: true, others: true, guides: true };
let snap: SnapCfg = { ...SNAP_DEFAULT }, keepSnap = () => {};
export const setSnap = (c: SnapCfg, save: () => void) => { snap = c; keepSnap = save; };
// an even grid overlay shown (snapping to overlays on) takes the place of the snap grid
let ovlGrid = 0;
const grid = () => Math.max(1, ovlGrid || snap.grid || 1);
// the overlays of each note (kept on the device)
const ovls = new Map<string, OvlCfg>();
// number boxes: how much one press of an arrow changes the value (in the box's own steps), and hold-and-drag on or off
export interface EditCfg { arrow: number; hold: boolean }
export const EDIT_DEFAULT: EditCfg = { arrow: 1, hold: true };
let editCfg: EditCfg = { ...EDIT_DEFAULT };
export const setEdit = (c: EditCfg) => { editCfg = c; };
// the selection's colour: the accent, unless it is too close to the colour of what is chosen (an orange handle on a
// red shape); then whichever of a few clear colours stands out most from it. Set on the block as --vl-sel (and --vl-sel-ink,
// the text on it), for the outline, the gravity ring, the corner handles and the size tag
const rgbOf = (c: string): number[] | null => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
const far = (a: number[], b: number[]) => { const r = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db); };
function selInk(blockEl: HTMLElement, itemEl: HTMLElement) {
    const win = blockEl.win, cs = win.getComputedStyle(itemEl);
    let c = rgbOf(cs.backgroundColor);
    if (!c || c[3] < 0.3) c = rgbOf(cs.color);   // a text or an icon: its ink
    if (itemEl.hasClass("vl-i-img")) c = null;      // a picture: any colour; the halo keeps the handles seen
    const probe = blockEl.createDiv({ cls: "vl-accentprobe" }); const acc = rgbOf(win.getComputedStyle(probe).color); probe.remove();
    if (!c || !acc) return;
    const base = c, pick = far(acc, base) > 220 ? acc : [acc, [34, 211, 238], [163, 230, 53], [255, 255, 255], [139, 92, 246], [20, 20, 24]].sort((a, b) => far(b, base) - far(a, base))[0];
    blockEl.setCssProps({ "--vl-sel": `rgb(${pick[0]}, ${pick[1]}, ${pick[2]})`, "--vl-sel-ink": 0.299 * pick[0] + 0.587 * pick[1] + 0.114 * pick[2] > 150 ? "#111" : "#fff" });
}
type Lines = { x: number[]; y: number[] };
// the nearest line within reach of any of the points: how far to shift, and the line
const near = (pts: number[], lines: number[], reach: number) => {
    let best: { d: number; at: number } | null = null;
    for (const q of pts) for (const l of lines) { const d = l - q; if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l }; }
    return best;
};
// an item's offset from its gravity point, from its box's left (or top) edge in its block
const toD = (a: number, L: number, W: number, bw: number) => Math.round(a < 0 ? L : a > 0 ? bw - L - W : L + W / 2 - bw / 2);
type View = { zoom: number; fit: boolean; show: boolean; page?: string; rail: boolean; land?: boolean; panel?: boolean; map?: boolean; mapZoom?: number; mapFit?: boolean };   // map: the whole tree in the stage   // panel: false = folded (computer)
const view = new Map<string, View>();   // per doc, kept across redraws
type Sel = { page: string; block?: string; item?: string; mark?: string } | null;
// the colours a mark can take (or any CSS colour)
const MARK_COLORS: Record<string, string> = { yellow: "#f5c84b", orange: "#ff8a3d", red: "#ff4d6d", green: "#2fbf71", blue: "#3d8bff", purple: "#9b6dff", gray: "#8a8f98" };
const markColor = (c?: string) => MARK_COLORS[c ?? "yellow"] ?? c ?? MARK_COLORS.yellow;
// the workspace was open when the note re-drew its block (a save rewrites the note): the new editor opens it again as it was
const reopen = new Map<string, { at: number; sel: Sel; past: string[]; future: string[] }>();
// on a computer the editor lives in its own window (an Obsidian pop-out): the open windows and the editors, by note + doc
const VIEW = "vellum-editor";
const editors = new Map<string, Editor>();   // the newest editor of each doc (the one its window shows)
const live = new Set<Editor>();              // every card on screen (one note open in two panes = two), told about outside changes
const windows = new Map<string, VellumWindow>();
class VellumWindow extends ItemView {
    key = "";
    getViewType() { return VIEW; }
    getDisplayText() { return "Vellum" + (this.key ? " · " + (this.key.split(":")[1] ?? "").replace(/\.md$/, "") : ""); }
    getIcon() { return "vellum"; }
    getState() { return { key: this.key }; }
    async setState(state: unknown, result: ViewStateResult) {
        const k = (state as { key?: string })?.key ?? "";
        if (k && k !== this.key) {
            this.key = k; windows.set(k, this);
            const ed = editors.get(k) ?? (k.includes(".md:") ? undefined : await folderEditor(k.replace(/^vellum:/, "")));
            if (ed) ed.mount(this.contentEl);
            else { this.contentEl.empty(); this.contentEl.createDiv({ cls: "vl-err", text: "Open the note with this Vellum block, then Open editor." }); }
        }
        return super.setState(state, result);
    }
    async onClose() { if (windows.get(this.key) === this) windows.delete(this.key); editors.get(this.key)?.unmount(); }
}

// a window to the front, focused (Electron: shown, raised; restored when minimised)
type ElectronWin = { isMinimized?(): boolean; restore?(): void; show?(): void; moveTop?(): void; focus?(): void };
const raise = (win: Window) => {
    const ew = (win as Window & { electronWindow?: ElectronWin }).electronWindow;
    try { if (ew?.isMinimized?.()) ew.restore?.(); ew?.show?.(); ew?.moveTop?.(); ew?.focus?.(); } catch { /* not Electron */ }
    win.focus();
};
class Editor {
    doc: Doc; saved: string; past: string[] = []; future: string[] = []; sel: Sel = null; pending: string | null = null;
    wall!: HTMLElement; panel: HTMLElement | null = null; theme!: Theme; kinds: Kind[];
    tab: "style" | "place" | "note" = "style";
    // store: the folder the doc is kept in (src: in the block), with the doc as read; none = the JSON in the block itself
    // el / ctx: the ```vellum block it is drawn in; none = opened straight on a folder (the ribbon, a command)
    constructor(readonly plugin: Plugin, host: VellumHost, source: string, readonly el: HTMLElement | undefined, readonly ctx: MarkdownPostProcessorContext | undefined, readonly store?: FolderStore, loaded?: { doc: Doc; error?: string }) {
        this.lookFrom(host);
        this.kinds = host.kinds ?? BASE_KINDS;
        const { doc, error } = loaded ?? parseDoc(source);
        this.doc = doc;
        this.saved = serialiseDoc(doc);
        this.card = el ? el.createDiv({ cls: "vl vl-card" }) : createDiv({ cls: "vl vl-card" });
        if (error && !store) { this.card.createDiv({ cls: "vl-err", text: error + " Fix it in the source view." }); return; }
        if (error) new Notice(`Vellum (${store!.dir}): ${error}`);
        // unsaved work kept on the device: used when it started from the note as it is now; if the note changed since (the
        // agent, a sync), the note is shown and the old work is offered back (never silently over the note)
        const draft = this.draftGet();
        if (draft) {
            try {
                const d = JSON.parse(draft) as { base?: string; doc?: Doc; pages?: unknown };
                if (d.doc && d.base === this.saved) this.doc = d.doc;
                else if (d.doc) this.stale = d.doc;
                else if (d.pages) this.stale = d as unknown as Doc;   // an older draft without its base: offered back too
            } catch { /* a broken draft is dropped */ }
        }
        this.paint(this.card);
        const onResize = () => { if (this.root?.isConnected && this.v.fit) this.drawPages(); };
        window.addEventListener("resize", onResize);
        const key = this.draftKey();
        editors.set(key, this); live.add(this);
        if (!el || !ctx) return;   // opened on a folder: lives as long as the plugin
        const life = new MarkdownRenderChild(el);
        life.onunload = () => {
            window.removeEventListener("resize", onResize);
            if (editors.get(key) === this) editors.delete(key);
            live.delete(this);
            if (!this.root?.isConnected) return;
            // a save re-draws the block: the new editor takes the window over within a moment; else the window closes
            reopen.set(key, { at: Date.now(), sel: this.sel, past: this.past, future: this.future });
            this.root.remove(); this.root = null;
            if (!Platform.isMobile) window.setTimeout(() => { if (!editors.has(key)) windows.get(key)?.leaf.detach(); }, 3000);
        };
        ctx.addChild(life);
        this.drawCard();
        const back = reopen.get(key);
        if (back && Date.now() - back.at < 3000) {
            reopen.delete(key); this.past = back.past; this.future = back.future; this.sel = back.sel; this.fixSel();
            const w = windows.get(key);
            if (w) this.mount(w.contentEl); else if (Platform.isMobile) this.openWs();
        }
    }
    card: HTMLElement; root: HTMLElement | null = null;
    // the theme's colours as --vl-* on an element (the card in the note, the workspace on the body)
    // the look from the host. The editor's own colours are set as Obsidian's variables on the editor, which the screens inside
    // it would inherit: a screen colour that names a changed variable reads a copy of Obsidian's value instead (--vlr--…)
    ui: Record<string, string> = {};
    lookFrom(host: VellumHost) {
        this.ui = { ...host.ui };
        const changed = new Set(UI_COLORS.filter((u) => this.ui[u.id]).flatMap((u) => u.vars));
        const colors: Record<string, string> = { ...BASE_THEME.colors, ...host.theme?.colors };
        for (const k of Object.keys(colors)) colors[k] = colors[k].replace(/var\((--[\w-]+)/g, (m, v: string) => (changed.has(v) ? `var(--vlr${v}` : m));
        this.theme = { colors, fonts: { ...BASE_THEME.fonts, ...host.theme?.fonts } };
    }
    paintLook(e: HTMLElement) {
        for (const c of Object.keys(this.theme.colors)) e.style.setProperty(`--vl-${c}`, this.theme.colors[c]);
        const obsidian = getComputedStyle(e.doc.body), own = e === this.root;   // (only the editor takes the colours; a note's preview just the copies)
        for (const u of UI_COLORS) for (const name of u.vars) {
            if (this.ui[u.id]) { e.style.setProperty(`--vlr${name}`, obsidian.getPropertyValue(name).trim()); if (own) e.style.setProperty(name, this.ui[u.id]); }
            else { e.style.removeProperty(`--vlr${name}`); if (own) e.style.removeProperty(name); }
        }
    }
    // the settings changed (or Obsidian's theme): the open editor takes them at once
    relook(host: VellumHost) {
        this.lookFrom(host); this.paintLook(this.card);
        if (!this.root) { this.drawCard(); return; }
        this.paintLook(this.root); this.thumbs.clear(); this.drawPanel(); this.drawPages();
    }
    paint(e: HTMLElement) { this.paintLook(e); for (const ev of ["pointerdown", "mousedown", "click", "touchstart", "dblclick"]) e.addEventListener(ev, (x) => x.stopPropagation()); }

    // ---- state, undo, drafts, save
    get v(): View { return view.get(this.doc.id) ?? { zoom: 0.75, fit: true, show: false, rail: !Platform.isMobile && window.innerWidth >= 1000 }; }
    setView(p: Partial<View>) { view.set(this.doc.id, { ...this.v, ...p }); }
    snap() { return JSON.stringify(this.doc); }
    get dirty() { return serialiseDoc(this.doc) !== this.saved; }
    draftKey() { return this.store ? `vellum:${this.store.dir}` : `vellum:${this.ctx!.sourcePath}:${this.doc.id}`; }
    draftGet() { try { return getLocal(this.draftKey()); } catch { return null; } }
    draftPut() { try { if (this.dirty) setLocal(this.draftKey(), JSON.stringify({ base: this.saved, doc: this.doc })); else if (!this.stale) setLocal(this.draftKey(), null); } catch { /* private mode */ } }
    stale: Doc | null = null;
    // a discrete change: one undo step
    edit(fn: () => void, panel = true) { const s = this.snap(); fn(); this.commit(s, panel); }
    // a continuous change (typing, dragging, scrubbing): begin once, apply many, end once
    begin() { if (this.pending === null) this.pending = this.snap(); }
    end() { if (this.pending !== null) { const s = this.pending; this.pending = null; this.commit(s, false); } }
    commit(before: string, panel: boolean) {
        const was = serialiseDoc(JSON.parse(before) as Doc) !== this.saved;
        if (before !== this.snap()) { this.past.push(before); this.future = []; }
        this.draftPut(); this.drawPages(); if (panel) this.drawPanel(); else this.drawBar();
        if (!was && this.dirty) this.hint("Unsaved: kept on this device until you save", undefined, false);
    }
    // a short note under the Save button for a few seconds (floats: nothing moves)
    // a short note by the button it is about (else under Save): a mark and a few words, gone after a moment
    hint(text: string, at?: HTMLElement, ok = true) {
        const R = this.root; if (!R?.isConnected) return;
        R.querySelector(".vl-hint")?.remove();
        const a = at?.isConnected ? at : this.bar?.querySelector<HTMLElement>(".is-savebtn");
        const h = R.createDiv({ cls: "vl-hint" + (ok ? " is-ok" : "") });
        setIcon(h.createSpan({ cls: "vl-hinti" }), ok ? "check" : "info");
        h.createSpan({ text });
        if (a) {
            const rr = R.getBoundingClientRect(), ar = a.getBoundingClientRect();
            h.style.top = `${ar.bottom - rr.top + 8}px`;
            const left = Math.min(rr.width - h.offsetWidth - 8, Math.max(8, ar.left - rr.left + ar.width / 2 - h.offsetWidth / 2));
            h.style.left = `${left}px`;
            h.style.setProperty("--arrow", `${ar.left - rr.left + ar.width / 2 - left}px`);
        }
        window.setTimeout(() => h.addClass("is-out"), 1800);
        window.setTimeout(() => h.remove(), 2200);
    }
    undo() { const s = this.past.pop(); if (!s) return; this.future.push(this.snap()); this.doc = JSON.parse(s) as Doc; this.fixSel(); this.draftPut(); this.draw(); }
    redo() { const s = this.future.pop(); if (!s) return; this.past.push(this.snap()); this.doc = JSON.parse(s) as Doc; this.fixSel(); this.draftPut(); this.draw(); }
    save() {
        if (this.store) {
            const text = serialiseDoc(this.doc), st = this.store;
            st.save(this.doc).then(() => {
                this.saved = text;
                try { setLocal(this.draftKey(), null); } catch { /* */ }
                this.drawBar(); this.drawCard(); this.hint(`Saved to ${st.dir}`);
            }, (e: Error) => new Notice(`Vellum: not saved (${e.message}). Your work is kept.`));
            return;
        }
        if (!this.ctx || !this.el) return;
        const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
        const info = this.ctx.getSectionInfo(this.el);
        if (!(file instanceof TFile) || !info) { new Notice("Vellum: could not find this block in the note"); return; }
        const text = serialiseDoc(this.doc);
        void this.plugin.app.vault.process(file, (data) => {
            const lines = data.split("\n");
            // the block must still be where it was drawn from (the note may have changed since): else nothing is written
            if (lines[info.lineStart]?.trim() !== "```vellum" || !lines[info.lineEnd]?.trim().startsWith("```")) { new Notice("Vellum: the note changed, not saved. Your work is kept; reopen the note."); return data; }
            lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...text.split("\n"));
            this.saved = text;
            try { setLocal(this.draftKey(), null); } catch { /* */ }
            window.setTimeout(() => { this.drawBar(); this.drawCard(); this.hint("Saved into the note"); });
            return lines.join("\n");
        });
    }

    // the folder changed outside (the agent, a sync): taken as it is; unsaved work here is offered back, never lost
    async outside() {
        if (!this.store) return;
        const { doc } = await this.store.load(), text = serialiseDoc(doc);
        if (text === this.saved) return;
        if (this.dirty) this.stale = this.doc;
        this.doc = doc; this.saved = text; this.fixSel(); this.draftPut();
        this.drawCard(); if (this.root?.isConnected) this.draw();
    }

    // ---- what is chosen
    page(id = this.sel?.page) { return this.doc.pages.find((p) => p.id === id); }
    block() { const p = this.page(); return p ? this.blocks(p).find((b) => b.id === this.sel?.block) : undefined; }
    // the layout on show: portrait, or landscape (a screen may have none yet: make = start an empty one)
    get land() { return !!this.v.land; }
    blocks(p: Page, make = false): Block[] { if (!this.land) return p.blocks; if (!p.land && make) p.land = []; return p.land ?? []; }
    // landscape from portrait: full-width blocks stretch to the new width, the rest keep their place under the status bar;
    // each keeps its id (a block of a frame and its overrides are the same block in both layouts)
    makeLand(p: Page) { this.edit(() => {
        const up = this.screen(p, false), sd = this.screen(p, true);
        const roomUp = up.W - up.safe.left - up.safe.right, roomSd = sd.W - sd.safe.left - sd.safe.right;
        p.land = p.blocks.map((b) => {
            const c = JSON.parse(JSON.stringify(b)) as Block;
            const m = b.x - up.safe.left, wide = b.w >= roomUp - 2 * m - 4;
            c.x = sd.safe.left + m; c.w = wide ? Math.max(8, roomSd - 2 * m) : b.w;
            c.y = Math.max(sd.safe.top, b.y - up.safe.top);
            return c;
        });
    }); }
    // a page's screen as drawn: the device's, with the safe areas set for this doc (upright / sideways)
    screen(p: Page, land = this.land) {
        const sc = screenOf(deviceOf(p.device ?? this.doc.device), land), o = land ? this.doc.safeLand : this.doc.safe;
        return { ...sc, safe: { ...sc.safe, ...o } };
    }
    // the room a block keeps to: inside the safe areas, or the whole screen when it may go under the bars (bleed)
    room(p: Page, b?: Block) {
        const { W, H, safe } = this.screen(p);
        return b?.bleed ? { l: 0, t: 0, r: W, b: H } : { l: safe.left, t: safe.top, r: W - safe.right, b: H - safe.bottom };
    }
    // the blocks drawn on a page (its frame's under its own) in the layout on show; layer(): the chosen one among them
    layers(p: Page): Layer[] { return layersOf(this.doc.pages, p, this.land); }
    layer() { const p = this.page(); return p && this.sel?.block ? this.layers(p).find((l) => l.block.id === this.sel?.block) : undefined; }
    item() { const b = this.block(); return b && this.sel?.item ? findItem(b.items, this.sel.item) : null; }
    choose(s: Sel) { this.sel = s; this.drawPanel(); this.drawPages(); }
    // the overlays (grids, composition guides, perspective) of this note, kept on the device
    get ov(): OvlCfg {
        let c = ovls.get(this.doc.id);
        if (!c) { let raw: unknown = null; try { raw = JSON.parse(getLocal(`vellum:ovl:${this.doc.id}`) ?? "null"); } catch { /* */ } c = ovlOf(raw); ovls.set(this.doc.id, c); }
        return c;
    }
    keepOv() { try { setLocal(`vellum:ovl:${this.doc.id}`, JSON.stringify(this.ov)); } catch { /* */ } }
    // ---- marks: notes, areas and guide lines on a screen (in the note, for the people and the agent), in the layout on show
    marking = false;   // the mark tool: a click leaves a note, a drag an area
    marksOf(p: Page) { return (p.marks ?? []).filter((m) => !!m.land === this.land); }
    mark() { const p = this.page(), id = this.sel?.mark; return p && id ? (p.marks ?? []).find((m) => m.id === id) : undefined; }
    markLines(p: Page): Lines {
        const x: number[] = [], y: number[] = [];
        if (!this.ov.notes) return { x, y };
        for (const m of this.marksOf(p)) {
            if (m.kind === "line") (m.axis === "x" ? x : y).push(m.axis === "x" ? m.x : m.y);
            else if (m.kind === "area" && m.w && m.h) { x.push(m.x, m.x + m.w / 2, m.x + m.w); y.push(m.y, m.y + m.h / 2, m.y + m.h); }
        }
        return { x, y };
    }
    addMark(p: Page, m: Omit<Mark, "id">) {
        const mk: Mark = { id: uid(), ...m, ...(this.land ? { land: true } : {}) };
        this.focusMark = true;
        this.edit(() => { (p.marks ??= []).push(mk); this.sel = { page: p.id, mark: mk.id }; });
        this.drawPages();
    }
    focusMark = false;
    drawMarks(scr: HTMLElement, p: Page, z: number) {
        scr.querySelector(":scope > .vl-marks")?.remove();
        const layer = scr.createDiv({ cls: "vl-marks" }), iz = 1 / z;
        for (const m of this.marksOf(p)) {
            const on = this.sel?.mark === m.id;
            const el = layer.createDiv({ cls: `vl-mark is-${m.kind}` + (on ? " is-on" : ""), attr: { "data-mark": m.id } });
            el.style.setProperty("--mc", markColor(m.color));
            const by = m.by ? `${m.by}: ` : "";
            if (m.kind === "note") {
                Object.assign(el.style, { left: `${m.x}px`, top: `${m.y}px` });
                el.createDiv({ cls: "vl-mpin" });
                if (m.text || on) el.createDiv({ cls: "vl-mbub", text: by + (m.text || "Write the note in the panel") });
            } else if (m.kind === "area") {
                const w = m.w ?? 100, h = m.h ?? 100;
                Object.assign(el.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${w}px`, height: `${h}px` });
                if (m.guide) {
                    const c = ovlOf({ labels: on, [m.guide]: { on: true, ...(m.guide === "spiral" ? { flipY: (m.corner ?? "br")[0] === "t", flipX: (m.corner ?? "br")[1] === "l" } : {}) } });
                    drawOverlay(el, c, w, h, { l: 0, t: 0, r: w, b: h }, z, { tint: markColor(m.color), foot: false }).addClass("is-inmark");
                }
                for (const side of ["t", "r", "b", "l"]) el.createDiv({ cls: `vl-medge is-${side}` });
                el.createDiv({ cls: "vl-mtag", text: by + (m.text || "Area") + (on ? `  ·  ${ratioText(w, h)}` : "") });
                if (on) el.createDiv({ cls: "vl-mgrip", attr: { "data-mgrip": "1", "aria-label": "Resize (Shift: keep the shape)" } });
            } else {
                const across = m.axis !== "x";
                el.addClass(across ? "is-y" : "is-x");
                if (across) el.style.top = `${m.y}px`; else el.style.left = `${m.x}px`;
                el.createDiv({ cls: "vl-mtag", text: by + (m.text ? `${m.text} · ` : "") + `${across ? "y" : "x"} ${Math.round(across ? m.y : m.x)}` });
            }
            el.addEventListener("pointerdown", (e) => this.markDown(e, p, scr, m, z));
        }
        layer.style.setProperty("--vl-iz", String(iz));
    }
    // a mark: a press chooses it, a drag moves it (an area's corner resizes it); grid steps, Alt 1 px; lines and areas snap
    markDown(e: PointerEvent, p: Page, scr: HTMLElement, m: Mark, z: number) {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        const grip = !!(e.target as HTMLElement).closest("[data-mgrip]"), x0 = e.clientX, y0 = e.clientY, st = { ...m };
        const was = this.sel?.mark === m.id;
        if (!was) { this.sel = { page: p.id, mark: m.id }; this.drawPanel(); this.drawMarks(scr, p, z); }
        const others = (() => { const keep = this.marksOf(p).filter((o) => o !== m), sv = p.marks; p.marks = keep; const l = this.markLines(p); p.marks = sv; const b = this.layers(p).map((x) => x.block); return { x: [...l.x, ...b.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])], y: [...l.y, ...b.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])] }; })();
        const { W, H } = this.screen(p); others.x.push(0, W / 2, W); others.y.push(0, H / 2, H);
        let moved = false;
        scr.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
            const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            if (!moved) { moved = true; this.begin(); }
            const on = snap.on && !ev.altKey, reach = snap.dist / z, sn = (v: number) => (ev.altKey ? Math.round(v) : Math.round(v / grid()) * grid());
            const fit = (v: number, pts: number[], ls: number[]) => { const g = on ? near(pts.map((q) => q + v), ls, reach) : null; return g ? Math.round(v + g.d) : sn(v); };
            if (grip && m.kind === "area") {
                m.w = Math.max(8, fit(st.w! + dx, [st.x], others.x) );
                m.h = ev.shiftKey && st.w && st.h ? Math.max(8, Math.round((m.w * st.h) / st.w)) : Math.max(8, fit(st.h! + dy, [st.y], others.y));
            } else if (m.kind === "line") {
                if (m.axis === "x") m.x = fit(st.x + dx, [0], others.x); else m.y = fit(st.y + dy, [0], others.y);
            } else if (m.kind === "area") {
                m.x = fit(st.x + dx, [0, st.w! / 2, st.w!], others.x); m.y = fit(st.y + dy, [0, st.h! / 2, st.h!], others.y);
            } else { m.x = sn(st.x + dx); m.y = sn(st.y + dy); }
            this.drawMarks(scr, p, z);
            this.livePanel();
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            if (moved) this.end(); else if (!was) this.drawPages();
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }
    // the mark tool on the screen: a click leaves a note there, a drag draws an area; then the tool is put away
    markDraw(e: PointerEvent, p: Page, scr: HTMLElement) {
        const z = this.v.zoom, r = scr.getBoundingClientRect(), at = (x: number, y: number) => [Math.round((x - r.left) / z), Math.round((y - r.top) / z)];
        const [x0, y0] = at(e.clientX, e.clientY);
        let box: HTMLElement | null = null, end = [x0, y0];
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            end = at(m.clientX, m.clientY);
            if (!box && Math.abs(end[0] - x0) * z + Math.abs(end[1] - y0) * z < 6) return;
            box ??= scr.createDiv({ cls: "vl-marq is-mark" });
            Object.assign(box.style, { left: `${Math.min(x0, end[0])}px`, top: `${Math.min(y0, end[1])}px`, width: `${Math.abs(end[0] - x0)}px`, height: `${Math.abs(end[1] - y0)}px` });
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            box?.remove(); this.marking = false;
            if (box) this.addMark(p, { kind: "area", x: Math.min(x0, end[0]), y: Math.min(y0, end[1]), w: Math.max(8, Math.abs(end[0] - x0)), h: Math.max(8, Math.abs(end[1] - y0)), text: "" });
            else this.addMark(p, { kind: "note", x: x0, y: y0, text: "" });
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }
    markPanel(body: HTMLElement, p: Page, m: Mark) {
        const names = { note: "Note", area: "Area", line: "Guide line" } as const;
        const s = this.section(body, names[m.kind]);
        if (m.by) s.createDiv({ cls: "vl-frameinfo", text: `Written by ${m.by}.` });
        this.text(s, () => m.text ?? "", (v) => { if (v.trim()) m.text = v; else delete m.text; }, { area: true, placeholder: m.kind === "note" ? "What to look at, what to change…" : m.kind === "area" ? "A name: thumb zone, hero, the eye goes here…" : "A name: content edge, baseline…", title: names[m.kind] });
        this.chips(s, Object.keys(MARK_COLORS).map((k) => [k, k] as [string, string]), m.color ?? "yellow", (v) => { if (v === "yellow") delete m.color; else m.color = v; }, (v) => MARK_COLORS[v], true);
        const r = s.createDiv({ cls: "vl-nums" });
        if (m.kind === "line") {
            this.chips(s, [["y", "Across", "move-horizontal"], ["x", "Down", "move-vertical"]], m.axis === "x" ? "x" : "y", (v) => { m.axis = v; });
            if (m.axis === "x") this.num(r, "X", () => m.x, (v) => { m.x = v; }); else this.num(r, "Y", () => m.y, (v) => { m.y = v; });
        } else {
            this.num(r, "X", () => m.x, (v) => { m.x = v; }); this.num(r, "Y", () => m.y, (v) => { m.y = v; });
        }
        if (m.kind === "area") {
            const r2 = s.createDiv({ cls: "vl-nums" });
            this.num(r2, "W", () => m.w ?? 100, (v) => { m.w = v; }, { min: 8 }); this.num(r2, "H", () => m.h ?? 100, (v) => { m.h = v; }, { min: 8 });
            const g = this.section(body, "Guide in it");
            this.chips(g, [["none", "None"], ["thirds", "Thirds"], ["phi", "Golden grid"], ["spiral", "Spiral"], ["diag", "Triangles"], ["center", "Centre"]] as [string, string][], m.guide ?? "none", (v) => { if (v === "none") delete m.guide; else m.guide = v as Guide; });
            if (m.guide === "spiral") this.chips(g, [["tl", "↖"], ["tr", "↗"], ["bl", "↙"], ["br", "↘"]] as ["tl" | "tr" | "bl" | "br", string][], m.corner ?? "br", (v) => { if (v === "br") delete m.corner; else m.corner = v; });
            const { W, H } = this.screen(p), PHI = (1 + Math.sqrt(5)) / 2;
            this.actions(g, [
                ["ratio", "Golden shape", () => this.edit(() => { const w = m.w ?? 100, h = m.h ?? 100; if (w >= h) m.h = Math.round(w / PHI); else m.w = Math.round(h / PHI); })],
                ["square", "Square", () => this.edit(() => { m.h = m.w ?? 100; })],
                ["maximize", "The whole screen", () => this.edit(() => { m.x = 0; m.y = 0; m.w = W; m.h = H; })],
            ]);
        }
        this.actions(body, [["copy", "Duplicate", () => this.duplicate()], ["trash-2", "Delete", () => this.remove()]]);
        if (this.focusMark) { this.focusMark = false; window.setTimeout(() => body.querySelector<HTMLElement>("textarea.vl-text")?.focus()); }
    }
    // several blocks chosen at once (an area dragged out, Shift+click, Ctrl+A): kept for the page selection it was made
    // with, so any other choice lets it go by itself
    group: { sel: Sel; ids: string[]; items?: { block: string; item: string }[] } | null = null;
    get many(): Block[] {
        const g = this.group, p = this.page();
        if (!g || g.sel !== this.sel || !p || g.items) return [];
        const own = this.blocks(p);
        return g.ids.map((id) => own.find((b) => b.id === id)).filter((b): b is Block => !!b);
    }
    // several items (each placed in its block, not in a row), in one block or more
    get manyItems(): { b: Block; it: Item }[] {
        const g = this.group, p = this.page();
        if (!g?.items || g.sel !== this.sel || !p) return [];
        const own = this.blocks(p), out: { b: Block; it: Item }[] = [];
        for (const x of g.items) { const b = own.find((o) => o.id === x.block), it = b?.items.find((i) => i.id === x.item); if (b && it) out.push({ b, it }); }
        return out;
    }
    chooseItems(p: Page, list: { block: string; item: string }[]) {
        if (list.length === 1) { this.choose({ page: p.id, block: list[0].block, item: list[0].item }); return; }
        const s: Sel = { page: p.id };
        this.group = list.length ? { sel: s, ids: [], items: list } : null;
        this.choose(s);
    }
    chooseMany(p: Page, ids: string[]) {
        if (ids.length === 1) { this.choose({ page: p.id, block: ids[0] }); return; }
        const s: Sel = { page: p.id };
        this.group = ids.length ? { sel: s, ids } : null;
        this.choose(s);
    }
    fixSel() { if (!this.page()) this.sel = null; else if (this.sel?.mark && !this.mark()) this.sel = { page: this.sel.page }; else if (this.sel?.block && !this.layer()) this.sel = { page: this.sel.page }; else if (this.sel?.item && !this.item()) this.sel = { page: this.sel.page, block: this.sel.block }; }

    // ---- the card in the note: the screens as a small map, Open
    drawCard() {
        const c = this.card; c.empty();
        const head = c.createDiv({ cls: "vl-chead" });
        const t = head.createDiv({ cls: "vl-ctitle" });
        t.createSpan({ cls: "vl-cname", text: "Vellum" });
        t.createSpan({ cls: "vl-cinfo", text: `${this.doc.pages.length} screen${this.doc.pages.length === 1 ? "" : "s"} · ${deviceOf(this.doc.device).name}` + (this.store ? ` · ${this.store.dir}` : "") + (this.dirty ? " · unsaved edits on this device" : "") });
        const o = head.createEl("button", { cls: "vl-open mod-cta" }); setIcon(o.createSpan(), "pencil-ruler"); o.appendText("Open editor");
        o.addEventListener("click", () => this.openWs());
        const m = c.createDiv({ cls: "vl-map" });
        this.drawMap(m);
    }
    // ---- the workspace: over the whole window; top bar, screens rail, the stage with the phone in its middle, the panel
    // computer: its own window (a pop-out, focused if already open); phone: over the whole screen
    openWs(page?: string) {
        if (page) this.setView({ page, fit: true });
        if (Platform.isMobile) { if (!this.root?.isConnected) this.mount(activeDocument.body); else this.draw(); return; }
        const key = this.draftKey();
        const w = windows.get(key) ?? this.plugin.app.workspace.getLeavesOfType(VIEW).map((l) => l.view).find((v): v is VellumWindow => v instanceof VellumWindow && v.key === key);
        if (w) { if (page) this.draw(); void this.plugin.app.workspace.revealLeaf(w.leaf); raise(w.contentEl.win); return; }
        // a new window opens maximized: the editor wants the room (its size is not remembered)
        const leaf = this.plugin.app.workspace.openPopoutLeaf({ size: { width: 1280, height: 880 } });
        void leaf.setViewState({ type: VIEW, active: true, state: { key } }).then(() => {
            const ew = (leaf.view.containerEl.win as Window & { electronWindow?: { maximize?(): void } }).electronWindow;
            try { ew?.maximize?.(); } catch { /* not Electron */ }
        });
    }
    mount(container: HTMLElement) {
        this.root?.remove();
        container.empty();
        const pop = container !== container.doc.body;
        const R = (this.root = container.createDiv({ cls: "vl vl-ws" + (Platform.isMobile ? " is-phone" : "") + (pop ? " is-pop" : ""), attr: { tabindex: "-1" } }));
        this.paint(R);
        // keys: on the editor itself (it may be in another window); capture so Obsidian's own keys do not take them first
        // (the window's own capture phase: Obsidian takes Ctrl+S there before it reaches the editor)
        const onKey = (e: KeyboardEvent) => { if (!R.isConnected) return R.win.removeEventListener("keydown", onKey, true); const a = R.doc.activeElement; if (a && (R === a || R.contains(a))) this.key(e); };
        R.win.addEventListener("keydown", onKey, true);
        if (pop) {
            let raf = 0;
            new ResizeObserver(() => {
                if (!R.isConnected) return;
                window.cancelAnimationFrame(raf);
                raf = window.requestAnimationFrame(() => {
                    if (this.v.fit && this.pending === null) this.drawPages();
                });
            }).observe(R);
        }
        this.draw();
        R.focus({ preventScroll: true });
    }
    unmount() { this.end(); this.root?.remove(); this.root = null; this.panel = null; this.drawCard(); }
    closeWs() { const w = windows.get(this.draftKey()); if (w && !Platform.isMobile) w.leaf.detach(); else this.unmount(); }
    draw() {
        const R = this.root; if (!R) return;
        // the camera: a rebuild (undo, redo, a change from outside, a side folded) keeps the stage scrolled where it was,
        // as long as it still shows the same thing (the same screen and layout, or the map)
        const was = this.wall?.isConnected ? { key: this.camKey(), l: this.wall.scrollLeft, t: this.wall.scrollTop } : null;
        R.empty(); this.panel = null;
        this.bar = R.createDiv({ cls: "vl-top" });
        this.drawStale();
        const body = R.createDiv({ cls: "vl-body" });
        this.rail = body.createDiv({ cls: "vl-rail" });
        this.rail.addEventListener("click", (e) => { if (e.target === this.rail) { this.setView({ rail: false }); this.draw(); } });   // phone: a tap on the dim closes the list
        const mid = body.createDiv({ cls: "vl-mid" });
        this.wall = mid.createDiv({ cls: "vl-stage" });
        this.wall.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, { x: e.clientX, y: e.clientY }); }, { passive: false });
        // the middle button drags the view around (Edit, Show and Map); no browser autoscroll
        this.wall.addEventListener("pointerdown", (e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); this.pan(e); } }, true);
        this.wall.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
        this.wall.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
        // Edit: a drag beside the phone chooses the blocks it covers (a tap lets go)
        this.wall.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || this.v.show || this.v.map || this.marking || (e.target as HTMLElement).closest(".vl-screen, button, .vl-empty")) return;
            const p = this.current(), scr = this.wall.querySelector<HTMLElement>(".vl-screen");
            if (p && scr) this.marquee(e, p, scr, true);
        });
        this.wall.addEventListener("click", (e) => { if ((this.v.show || this.v.map) && e.target === this.wall && this.sel) this.choose(null); });   // a tap beside the phone lets go
        this.zbar = mid.createDiv({ cls: "vl-zbar" });
        this.side = Platform.isMobile ? R : body;
        this.drawPanel(); this.drawPages();
        if (was && was.key === this.camKey()) { this.wall.scrollLeft = was.l; this.wall.scrollTop = was.t; }
    }
    camKey() { const v = this.v; return v.map ? "map" : `${this.current()?.id}|${v.land ? 1 : 0}|${v.show ? 1 : 0}`; }
    zbar!: HTMLElement; rail!: HTMLElement; side!: HTMLElement; railTop = 0;
    // unsaved work from before the note changed: offered back, never applied by itself
    drawStale() {
        if (!this.stale || !this.root) return;
        const s = this.root.createDiv({ cls: "vl-stale" });
        s.createSpan({ text: "The note changed since your unsaved edits on this device. The note is shown." });
        const keep = s.createEl("button", { text: "Restore my edits" });
        keep.addEventListener("click", () => { const d = this.stale!; this.stale = null; this.edit(() => { this.doc = d; }); this.draw(); });
        const drop = s.createEl("button", { text: "Drop them" });
        drop.addEventListener("click", () => { this.stale = null; try { setLocal(this.draftKey(), null); } catch { /* */ } this.draw(); });
    }
    // the page in the editor: the one opened (or chosen), else the first
    current(): Page | undefined { return this.doc.pages.find((p) => p.id === (this.v.page ?? this.sel?.page)) ?? this.doc.pages[0]; }
    openPage(p: Page) { this.setView({ page: p.id }); this.sel = null; if (Platform.isMobile) this.setView({ rail: false }); this.draw(); }
    bar!: HTMLElement;
    // the top bar: close and where you are on the left, undo / redo / save on the right; nothing else
    drawBar() {
        const b = this.bar; if (!b?.isConnected) return;
        b.empty();
        const l = b.createDiv({ cls: "vl-tl" });
        if (Platform.isMobile) this.btn(l, "x", "Close the editor", () => this.closeWs()).addClass("vl-x");
        const cur = this.current();
        if (Platform.isMobile) {
            const rt = l.createEl("button", { cls: "vl-railbtn" + (this.v.rail ? " is-on" : ""), attr: { "aria-label": "Screens" } });
            setIcon(rt.createSpan(), "layers");
            rt.createSpan({ cls: "vl-pg", text: cur?.name ?? "No screens" });
            setIcon(rt.createSpan({ cls: "vl-chev" }), "chevron-down");
            rt.addEventListener("click", () => { this.setView({ rail: !this.v.rail }); this.draw(); });
        } else {
            this.btn(l, this.v.rail ? "sidebar-left" : "vellum-side-left", this.v.rail ? "Collapse the screens" : "Expand the screens", () => { this.setView({ rail: !this.v.rail }); this.draw(); }).addClass("vl-side-toggle");
            l.createSpan({ cls: "vl-pg vl-pgname", text: cur?.name ?? "No screens" });
        }
        const r = b.createDiv({ cls: "vl-tr" });
        this.btn(r, "settings", "Vellum settings (colours, fonts, snapping)", () => {
            // Obsidian's settings on Vellum's tab, above the editor: its own window (newer Obsidian) or the main one, brought to
            // the front once it is open (and again a moment later: a new window may take the focus back as it appears)
            const set = (this.plugin.app as unknown as { setting?: { open(): void; openTabById(id: string): void; win?: Window } }).setting;
            if (!set) return;
            set.open(); set.openTabById(this.plugin.manifest.id);
            const up = () => raise(set.win ?? window);
            up(); for (const ms of [120, 400]) window.setTimeout(up, ms);
        });
        this.btn(r, "undo-2", "Undo (Ctrl+Z)", () => this.undo(), !this.past.length);
        this.btn(r, "redo-2", "Redo (Ctrl+Shift+Z)", () => this.redo(), !this.future.length);
        const sv = r.createEl("button", { cls: "vl-save is-savebtn" + (this.dirty ? " is-dirty" : ""), attr: { "aria-label": "Save into the note (Ctrl+S)" } });
        setIcon(sv.createSpan(), this.dirty ? "save" : "check"); sv.appendText(this.dirty ? "Save" : "Saved");
        sv.addEventListener("click", () => { if (this.dirty) this.save(); });
        if (!Platform.isMobile && !this.v.show && !this.v.map) {   // Show and Map have no settings panel
            r.createSpan({ cls: "vl-zsep" });
            this.btn(r, this.v.panel === false ? "vellum-side-right" : "sidebar-right", this.v.panel === false ? "Expand the settings" : "Collapse the settings", () => { this.setView({ panel: this.v.panel === false }); this.draw(); }).addClass("vl-side-toggle");
        }
        this.drawZoom();
    }
    // the pill at the foot of the stage: Edit / Show, zoom, fit
    drawZoom() {
        const z = this.zbar; if (!z?.isConnected) return;
        z.empty(); if (!this.doc.pages.length) return;
        const pill = z.createDiv({ cls: "vl-zpill" });
        const seg = pill.createDiv({ cls: "vl-seg" });
        const mode = this.v.map ? "map" : this.v.show ? "show" : "edit";
        for (const [label, m] of [["Edit", "edit"], ["Show", "show"], ["Map", "map"]] as const) {
            const x = seg.createEl("button", { text: label, cls: mode === m ? "is-on" : "", attr: { "aria-label": m === "map" ? "Every screen as a tree" : m === "show" ? "The screen alone" : "Frames and safe areas" } });
            x.addEventListener("click", () => { if (mode === m) return; this.setView({ show: m === "show", map: m === "map" }); if (m !== "edit") this.sel = null; this.draw(); });
        }
        pill.createSpan({ cls: "vl-zsep" });
        const ori = pill.createDiv({ cls: "vl-seg is-ori" });
        for (const [land, icon, label] of [[false, "rectangle-vertical", "Portrait"], [true, "rectangle-horizontal", "Landscape"]] as const) {
            const x = ori.createEl("button", { cls: this.land === land ? "is-on" : "", attr: { "aria-label": label } });
            setIcon(x, icon); if (!x.querySelector("svg")) x.setText(label);
            x.addEventListener("click", () => { if (this.land === land) return; this.setView({ land }); this.sel = null; this.thumbs.clear(); this.draw(); });
        }
        if (!this.v.map && !this.v.show) {
            this.tip(this.btn(pill, "magnet", "", () => { snap.on = !snap.on; keepSnap(); this.drawZoom(); }), snap.on ? "Snapping on\nAlt while dragging: off" : "Snapping off\nthe grid only").toggleClass("is-on", snap.on);
        }
        if (!this.v.map && !this.v.show) {
            const mt = this.btn(pill, "message-square-plus", "", () => { this.marking = !this.marking; this.drawPages(); });
            this.tip(mt, "Mark (N)\nclick: a note · drag: an area").toggleClass("is-on", this.marking);
        }
        if (!this.v.map) {
            const ob = this.tip(this.btn(pill, "layout-grid", "", () => this.ovMenu(ob)), "Overlays\nCtrl+' shows / hides");
            if (!ob.querySelector("svg")) ob.setText("#");   // an icon set without it: still a button you can see
            ob.addClass("vl-ovbtn"); ob.toggleClass("is-on", this.ov.show && anyOn(this.ov));
        }
        pill.createSpan({ cls: "vl-zsep" });
        this.btn(pill, "minus", "Zoom out (Ctrl+wheel)", () => this.zoomBy(1 / 1.25));
        pill.createSpan({ cls: "vl-zoom", text: `${Math.round((this.v.map ? this.v.mapZoom ?? 1 : this.v.zoom) * 100)}%` });
        this.btn(pill, "plus", "Zoom in (Ctrl+wheel)", () => this.zoomBy(1.25));
        const fitOn = this.v.map ? this.v.mapFit !== false : this.v.fit;
        const fit = pill.createEl("button", { cls: "vl-zfit" + (fitOn ? " is-on" : ""), text: "Fit", attr: { "aria-label": "Fit to the window" } });
        fit.addEventListener("click", () => { this.setView(this.v.map ? { mapFit: true } : { fit: true }); this.drawPages(); });
        // the pill is at the foot: its tooltips open above it, never over its own buttons
        z.querySelectorAll<HTMLElement>("[aria-label]").forEach((e) => e.setAttr("data-tooltip-position", "top"));
    }
    // the overlays menu (over the pill): each guide on / off with its settings; kept on the device, drawn at once
    ovMenu(anchor: HTMLElement) {
        const R = this.root!, open = R.querySelector(".vl-menu.is-ovl");
        R.querySelectorAll(".vl-menu:not(.is-ovl)").forEach((x) => x.remove());
        if (open) { open.remove(); return; }
        const m = R.createDiv({ cls: "vl-menu is-ovl" });
        const place = () => { const rr = R.getBoundingClientRect(), ar = anchor.getBoundingClientRect(); m.style.left = `${Math.max(8, Math.min(rr.width - m.offsetWidth - 8, ar.left - rr.left - 140))}px`; m.style.bottom = `${rr.bottom - ar.top + 10}px`; };
        const ov = this.ov;
        const apply = () => { this.keepOv(); this.drawPages(); };
        const draw = () => {
            m.empty();
            const head = m.createDiv({ cls: "vl-ovhead" });
            head.createSpan({ cls: "vl-menuh", text: "Overlays" });
            const sh = head.createEl("button", { cls: "vl-ovtog" + (ov.show ? " is-on" : ""), text: ov.show ? "Shown" : "Hidden", attr: { "aria-label": "Show / hide them all (Ctrl+')" } });
            sh.addEventListener("click", () => { ov.show = !ov.show; apply(); draw(); });
            const num = (row: HTMLElement, label: string, get: () => number, set: (v: number) => void, o: { min?: number; max?: number; step?: number } = {}) => {
                const w = row.createEl("label", { cls: "vl-ovnum" }); w.createSpan({ text: label });
                const i = w.createEl("input", { attr: { type: "number", step: String(o.step ?? 1), ...(o.min !== undefined ? { min: o.min } : {}), ...(o.max !== undefined ? { max: o.max } : {}) } });
                i.value = String(get());
                i.addEventListener("input", () => { const v = Number(i.value); if (i.value !== "" && !Number.isNaN(v)) { set(Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v))); apply(); } });
                i.addEventListener("keydown", (k) => k.stopPropagation());
            };
            const pick = <T extends string | boolean>(row: HTMLElement, opts: [T, string][], get: () => T, set: (v: T) => void) => {
                const g = row.createDiv({ cls: "vl-ovseg" });
                for (const [v, t] of opts) { const b = g.createEl("button", { text: t, cls: get() === v ? "is-on" : "" }); b.addEventListener("click", () => { set(v); apply(); draw(); }); }
            };
            type K = keyof typeof OVL_COLORS;
            const item = (k: K, name: string, hint: string, opts?: (row: HTMLElement) => void) => {
                const c = ov[k];
                const r = m.createDiv({ cls: "vl-ovrow" + (c.on ? " is-on" : "") });
                const b = r.createEl("button", { cls: "vl-ovname", attr: { "aria-label": hint } });
                b.createSpan({ cls: "vl-ovsw" }).style.background = OVL_COLORS[k];
                b.createSpan({ text: name });
                setIcon(b.createSpan({ cls: "vl-ovcheck" }), c.on ? "check" : "plus");
                b.addEventListener("click", () => { c.on = !c.on; if (c.on) ov.show = true; apply(); draw(); });
                if (c.on && opts) opts(r.createDiv({ cls: "vl-ovopts" }));
            };
            m.createDiv({ cls: "vl-menuh", text: "Layout" });
            item("grid", "Grid", "An even grid, as lines or dots", (r) => { num(r, "Size", () => ov.grid.size, (v) => { ov.grid.size = v; }, { min: 2, max: 200 }); pick(r, [[false, "Lines"], [true, "Dots"]], () => ov.grid.dots, (v) => { ov.grid.dots = v; }); });
            item("cols", "Columns", "Columns across the safe area: count, margin, gutter", (r) => { num(r, "Count", () => ov.cols.count, (v) => { ov.cols.count = v; }, { min: 1, max: 24 }); num(r, "Margin", () => ov.cols.margin, (v) => { ov.cols.margin = v; }, { min: 0 }); num(r, "Gutter", () => ov.cols.gutter, (v) => { ov.cols.gutter = v; }, { min: 0 }); });
            item("rows", "Rows", "Rows down the safe area: count, margin, gutter", (r) => { num(r, "Count", () => ov.rows.count, (v) => { ov.rows.count = v; }, { min: 1, max: 48 }); num(r, "Margin", () => ov.rows.margin, (v) => { ov.rows.margin = v; }, { min: 0 }); num(r, "Gutter", () => ov.rows.gutter, (v) => { ov.rows.gutter = v; }, { min: 0 }); });
            m.createDiv({ cls: "vl-menuh", text: "Composition" });
            item("thirds", "Rule of thirds", "Thirds across and down, and the four points where they cross");
            item("phi", "Golden ratio grid", "Lines at 0.382 and 0.618 (φ)");
            item("spiral", "Golden spiral", "The golden rectangle cut into squares, a spiral through them", (r) => pick(r, [["tl", "↖"], ["tr", "↗"], ["bl", "↙"], ["br", "↘"]] as [string, string][], () => `${ov.spiral.flipY ? "t" : "b"}${ov.spiral.flipX ? "l" : "r"}`, (v) => { ov.spiral.flipY = v[0] === "t"; ov.spiral.flipX = v[1] === "l"; }));
            item("diag", "Diagonals", "The X, golden triangles, or the harmonic armature (dynamic symmetry)", (r) => pick(r, [["x", "X"], ["tri", "Triangles"], ["arm", "Armature"]] as ["x" | "tri" | "arm", string][], () => ov.diag.style, (v) => { ov.diag.style = v; }));
            item("center", "Centre", "The middle across and down");
            if (compOn(ov)) {
                const r = m.createDiv({ cls: "vl-ovopts is-foot" });
                r.createSpan({ cls: "vl-ovhint", text: "Drag the Composition tag on the screen to move them, its corner to resize." });
                const p = this.current(), sc = p ? this.screen(p) : null, PHI = (1 + Math.sqrt(5)) / 2;
                const act = (label: string, hint: string, fn: () => void) => { const b = r.createEl("button", { cls: "vl-ovflag", text: label, attr: { "aria-label": hint } }); b.addEventListener("click", () => { fn(); apply(); draw(); }); };
                act("Whole screen", "Back over the whole screen", () => { ov.area = null; });
                if (sc) act("Golden shape", "Its shape 1 : 1.618, as wide as now", () => { const a = ov.area ?? { x: 0, y: 0, w: sc.W, h: sc.H }; ov.area = { ...a, h: Math.round(a.w >= a.h ? a.w / PHI : a.w * PHI) }; });
                if (sc) act("Square", "Its shape 1 : 1, as wide as now", () => { const a = ov.area ?? { x: 0, y: 0, w: sc.W, h: sc.H }; ov.area = { ...a, h: a.w }; });
            }
            m.createDiv({ cls: "vl-menuh", text: "Perspective" });
            item("persp", "Vanishing points", "Rays from one or two vanishing points on a horizon; drag a point on the screen", (r) => {
                pick(r, [[false, "1 point"], [true, "2 points"]], () => ov.persp.two, (v) => { ov.persp.two = v; if (v && ov.persp.x2 === ov.persp.x) ov.persp.x2 = ov.persp.x + 1; });
                num(r, "Rays", () => ov.persp.rays, (v) => { ov.persp.rays = v; }, { min: 4, max: 72 });
                num(r, "Horizon %", () => Math.round(ov.persp.y * 100), (v) => { ov.persp.y = v / 100; }, { min: 0, max: 100 });
            });
            m.createDiv({ cls: "vl-menuh", text: "Show" });
            const o = m.createDiv({ cls: "vl-ovopts is-foot" });
            const flag = (label: string, hint: string, get: () => boolean, set: (v: boolean) => void) => { const b = o.createEl("button", { cls: "vl-ovflag" + (get() ? " is-on" : ""), text: label, attr: { "aria-label": hint } }); b.addEventListener("click", () => { set(!get()); apply(); draw(); }); };
            flag("Marks", "Notes, areas and guide lines on the screens (N: the mark tool)", () => ov.notes, (v) => { ov.notes = v; });
            flag("Labels", "Where each line falls, its ratio; the screen's size and ratio", () => ov.labels, (v) => { ov.labels = v; });
            flag("Snap", "Dragging snaps to the overlay lines (the grid's size takes the snap grid's place)", () => ov.snap, (v) => { ov.snap = v; });
            flag("Ratio", "The chosen block's or item's size and ratio under it", () => ov.ratio, (v) => { ov.ratio = v; });
            flag("In Show", "Also over the screen in Show", () => ov.inShow, (v) => { ov.inShow = v; });
            num(o, "Opacity %", () => Math.round(ov.opacity * 100), (v) => { ov.opacity = v / 100; }, { min: 10, max: 100, step: 5 });
        };
        draw(); place();   // placed once: the pill is drawn again as the overlays change
        for (const ev of ["pointerdown", "mousedown", "click", "wheel"]) m.addEventListener(ev, (x) => x.stopPropagation());
        const off = (e: Event) => { if (!m.isConnected) return R.doc.removeEventListener("pointerdown", off, true); if (!m.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".vl-ovbtn")) { m.remove(); R.doc.removeEventListener("pointerdown", off, true); } };
        window.setTimeout(() => R.doc.addEventListener("pointerdown", off, true));
    }
    // at: the pointer (Ctrl+wheel): the spot under it stays under it. Its place in the map or the phone, as a fraction,
    // before the zoom; after the redraw the stage scrolls that place back under the pointer (content that fits stays centred)
    zoomBy(f: number, at?: { x: number; y: number }) {
        const sel = this.v.map ? ".vl-mapbox" : ".vl-phone";
        const r0 = at ? this.wall?.querySelector<HTMLElement>(sel)?.getBoundingClientRect() : undefined;
        if (this.v.map) this.setView({ mapFit: false, mapZoom: Math.min(MAPMAX, Math.max(0.3, Math.round((this.v.mapZoom ?? 1) * f * 100) / 100)) });
        else this.setView({ fit: false, zoom: Math.min(ZOOMMAX, Math.max(0.1, Math.round(this.v.zoom * f * 100) / 100)) });
        this.drawPages();
        const r1 = r0 ? this.wall?.querySelector<HTMLElement>(sel)?.getBoundingClientRect() : undefined;
        if (!at || !r0 || !r1 || !r0.width || !r0.height) return;
        const u = (at.x - r0.left) / r0.width, v = (at.y - r0.top) / r0.height;
        this.wall.scrollLeft += r1.left + u * r1.width - at.x;
        this.wall.scrollTop += r1.top + v * r1.height - at.y;
    }
    // the middle button held: the stage scrolls with the pointer
    pan(e: PointerEvent) {
        const w = this.wall, x0 = e.clientX, y0 = e.clientY, l0 = w.scrollLeft, t0 = w.scrollTop;
        w.setPointerCapture(e.pointerId); w.addClass("is-panning");
        const move = (m: PointerEvent) => { w.scrollLeft = l0 - (m.clientX - x0); w.scrollTop = t0 - (m.clientY - y0); };
        const up = () => { w.removeEventListener("pointermove", move); w.removeEventListener("pointerup", up); w.removeEventListener("pointercancel", up); w.removeClass("is-panning"); };
        w.addEventListener("pointermove", move); w.addEventListener("pointerup", up); w.addEventListener("pointercancel", up);
    }
    // a new main page, or one opened from a page
    addPage(parent?: Page) { this.edit(() => {
        const n: Page = { id: uid(), name: "New page", blocks: [{ id: uid(), name: "Title", kind: "nav", x: 16, y: 64, w: 370, h: 48, items: [{ id: uid(), type: "text", v: "Title", size: 30, wt: 800, font: "display", g: "l", dx: 0 }] }] };
        const pages = this.doc.pages;
        if (parent) { n.parent = parent.id; pages.splice(pages.indexOf(parent) + 1, 0, n); } else pages.push(n);
        this.sel = { page: n.id }; this.setView({ page: n.id });
    }); this.draw(); }
    // a short tooltip, a line or two, centred; over the pill it opens above
    tip(el: HTMLElement, text: string) { setTooltip(el, text, { placement: "top", classes: ["vl-tip"] }); return el; }
    btn(parent: HTMLElement, icon: string, label: string, act: () => void, off = false) {
        const x = parent.createEl("button", { cls: "vl-btn" + (off ? " is-off" : ""), attr: { "aria-label": label } });
        setIcon(x, icon);
        x.addEventListener("click", () => { if (!off) act(); });
        return x;
    }
    drawPages() {
        if (!this.wall?.isConnected) return;
        // a redraw keeps where the stage was scrolled (choosing a block or an item does not jump to the top)
        const sx = this.wall.scrollLeft, sy = this.wall.scrollTop, keep = () => { this.wall.scrollLeft = sx; this.wall.scrollTop = sy; };
        this.wall.empty();
        this.wall.toggleClass("is-show", !!this.v.show && !this.v.map);
        if (!this.doc.pages.length) { const e = this.wall.createDiv({ cls: "vl-empty" }); e.createSpan({ text: "No screens yet." }); e.createEl("button", { cls: "vl-act", text: "+ Add a screen" }).addEventListener("click", () => this.addPage()); }
        this.drawRail();   // first: its width is part of the room the phone fits in
        if (this.v.map && this.doc.pages.length) {
            // Map: every screen in the stage as a tree; a click opens it for editing. Fit: the tree as wide as the stage
            const box = this.wall.createDiv({ cls: "vl-stagemap" });
            const pick = (p: Page) => { this.setView({ map: false, page: p.id }); this.sel = null; this.draw(); };
            const BASE = 110, room = this.wall.clientWidth - 64;
            let tw = BASE * (this.v.mapZoom ?? 1);
            if (this.v.mapFit !== false) {
                // as big as both the width (screens across) and the height (rows of screens) allow
                const { slots, rows } = this.drawMap(box, BASE, pick), d = deviceOf(this.doc.device), ratio = d.h / d.w;
                const byW = room / Math.max(1, slots) - 40, byH = ((this.wall.clientHeight - 150) / Math.max(1, rows) - 86) / ratio;
                tw = Math.max(48, Math.min(200, Math.floor(Math.min(byW, byH))));
                this.setView({ mapZoom: Math.round((tw / BASE) * 100) / 100 });
            }
            this.drawMap(box, tw, pick);
            this.drawZoom(); keep();
            return;
        }
        const cur = this.current();
        if (cur) {
            // fit: the whole phone in the stage, the pill and a margin kept clear
            if (this.v.fit) {
                const dev = deviceOf(cur.device ?? this.doc.device), { W, H } = screenOf(dev, this.land);
                const ph = Platform.isMobile, show = this.v.show;   // Show: room for the name above, the arrows beside, what it opens below
                const sw = this.wall.clientWidth - (ph ? 44 : 64) - (show ? (ph ? 72 : 112) : 0), sh = this.wall.clientHeight - (ph ? 100 : 120) - (show ? (ph ? 100 : 130) : 0);
                if (sw > 0 && sh > 0) view.set(this.doc.id, { ...this.v, zoom: Math.max(0.2, Math.min(2, Math.floor(Math.min(sw / W, sh / H) * 100) / 100)) });
            }
            this.drawPage(cur);
        }
        this.drawZoom(); keep();
    }
    // the screens rail: every page as a row, sub pages indented under the page they open from (with how you get there);
    // a tap opens it, + beside a row adds a page opened from it; the device for the whole note at the foot
    drawRail() {
        const r = this.rail; if (!r?.isConnected) return;
        this.unpeek();   // its row is about to go: a peek left from it would never hear the pointer leave
        r.empty(); r.toggleClass("is-on", this.v.rail);
        if (!this.v.rail) return;
        // its width: the right border drags it (computer), kept on the device
        if (!Platform.isMobile) {
            r.style.width = `${Number(getLocal("vellum:railW")) || 248}px`;
            const g = r.createDiv({ cls: "vl-rgrip" });
            g.addEventListener("pointerdown", (e) => {
                e.preventDefault(); g.setPointerCapture(e.pointerId); g.addClass("is-on");
                const x0 = e.clientX, w0 = r.offsetWidth;
                const tw0 = this.picW(w0);
                // the pictures grow with the width while dragging (scaled), drawn again at their new size on release
                const mv = (m: PointerEvent) => { const w = Math.min(560, Math.max(180, w0 + m.clientX - x0)); r.style.width = `${w}px`; r.style.setProperty("--vl-pz", String(this.picW(w) / tw0)); };
                const up = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeClass("is-on"); try { setLocal("vellum:railW", String(r.offsetWidth)); } catch { /* */ } r.style.removeProperty("--vl-pz"); this.drawPages(); };
                g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up);
            });
        }
        const box = r.createDiv({ cls: "vl-railbox" });
        box.addEventListener("scroll", () => { this.railTop = box.scrollTop; this.unpeek(); }, { passive: true });
        box.addEventListener("mouseleave", () => this.unpeek());
        const pics = getLocal("vellum:pics") === "1";
        const hd = box.createDiv({ cls: "vl-railhead" });
        hd.createDiv({ cls: "vl-sech", text: `Screens · ${this.doc.pages.length}` });
        // the preview that opens when the pointer rests on a screen's name: on unless turned off here (kept on the device)
        const peeks = getLocal("vellum:peek") !== "0";
        const hb = this.btn(hd, peeks ? "monitor" : "monitor-off", peeks ? "Preview on hover: on (turn off)" : "Preview on hover: off (turn on)", () => { try { setLocal("vellum:peek", peeks ? "0" : "1"); } catch { /* */ } this.unpeek(); this.drawRail(); });
        hb.toggleClass("is-on", peeks); hb.setAttr("data-tooltip-position", "bottom");
        const pb = this.btn(hd, "image", pics ? "Hide the pictures" : "Show a picture of each screen", () => { try { setLocal("vellum:pics", pics ? "0" : "1"); } catch { /* */ } this.drawRail(); });
        pb.toggleClass("is-on", pics); pb.setAttr("data-tooltip-position", "bottom");
        // the tree: main screens at the left, each screen's sub screens under it on guide lines; a chevron folds a branch;
        // each row has a small picture of its screen
        const list = box.createDiv({ cls: "vl-plist" });
        const pages = this.doc.pages, cur = this.current(), seen = new Set<string>(), fold = this.folds();
        const row = (p: Page, depth: number) => {
            if (seen.has(p.id)) return; seen.add(p.id);
            const kids = childrenOf(pages, p.id).filter((c) => !seen.has(c.id));
            // the flow: how you get here, on the connector into this screen ("↳ tap a row")
            if (p.link && depth) {
                const ed = list.createDiv({ cls: "vl-pedge" });
                const gi = ed.createDiv({ cls: "vl-pind" });
                for (let i = 0; i < depth; i++) gi.createSpan({ cls: "vl-pguide" });
                setIcon(ed.createSpan({ cls: "vl-pedgei" }), "corner-down-right");
                ed.createSpan({ cls: "vl-pedget", text: p.link });
            }
            const w = list.createDiv({ cls: "vl-prow" + (p.id === cur?.id ? " is-on" : "") + (p.mock ? " is-mock" : "") });
            const ind = w.createDiv({ cls: "vl-pind" });
            for (let i = 0; i < depth; i++) ind.createSpan({ cls: "vl-pguide" });
            if (kids.length) {
                const ch = w.createEl("button", { cls: "vl-pchev", attr: { "aria-label": fold.has(p.id) ? "Unfold" : "Fold" } });
                setIcon(ch, fold.has(p.id) ? "chevron-right" : "chevron-down");
                ch.addEventListener("click", (e) => { e.stopPropagation(); if (fold.has(p.id)) fold.delete(p.id); else fold.add(p.id); this.keepFolds(fold); this.drawRail(); });
            } else w.createSpan({ cls: "vl-pchev is-leaf" });
            if (pics) w.appendChild(this.thumb(p));
            if (peeks) this.peekOn(w, p);
            const t = w.createDiv({ cls: "vl-ptext" });
            t.createDiv({ cls: "vl-pn", text: p.name + (p.mock ? " · mock" : "") });
            if (p.link && !depth) t.createDiv({ cls: "vl-pl", text: p.link });
            w.addEventListener("click", () => this.openPage(p));
            const add = this.btn(w, "plus", `Add a screen opened from ${p.name}`, () => this.addPage(p));
            add.addClass("vl-padd"); add.addEventListener("click", (e) => e.stopPropagation());
            if (!fold.has(p.id)) for (const c of kids) row(c, depth + 1);
            else for (const c of subtreeOf(pages, p.id)) if (c !== p.id) seen.add(c);
        };
        for (const p of childrenOf(pages)) row(p, 0);
        for (const p of pages) row(p, 0);   // anything left (a loop) as a main page
        const na = box.createEl("button", { cls: "vl-act vl-newp" }); setIcon(na.createSpan(), "plus"); na.appendText("New Screen");
        na.addEventListener("click", () => this.addPage());
        // the device
        const foot = box.createDiv({ cls: "vl-rfoot" });
        foot.createDiv({ cls: "vl-sech", text: "Device" });
        const devc = deviceOf(this.doc.device);
        const dev = foot.createEl("button", { cls: "vl-dev" });
        dev.createSpan({ text: devc.name }); setIcon(dev.createSpan({ cls: "vl-chev" }), "chevron-down");
        dev.addEventListener("click", () => {
            const R = this.root!; const open = R.querySelector(".vl-menu");
            if (open) { open.remove(); return; }
            const m = R.createDiv({ cls: "vl-menu" });
            const rr = R.getBoundingClientRect(), dr = dev.getBoundingClientRect();
            m.style.left = `${dr.left - rr.left}px`; m.style.bottom = `${rr.bottom - dr.top + 4}px`;
            let brand = "";
            for (const d of DEVICES) {
                if (d.brand !== brand) { brand = d.brand; m.createDiv({ cls: "vl-menuh", text: brand }); }
                const it = m.createEl("button", { cls: "vl-menui" + (d.id === devc.id ? " is-on" : "") });
                it.createSpan({ text: d.name }); it.createSpan({ cls: "vl-devsz", text: `${d.w}×${d.h} · ${d.cut === "none" ? "home button" : d.cut}` });
                it.addEventListener("click", () => { m.remove(); if (d.id !== this.doc.device) this.edit(() => { this.doc.device = d.id; }); });
            }
            // any other size: width × height in points
            m.createDiv({ cls: "vl-menuh", text: "Custom" });
            const cu = m.createDiv({ cls: "vl-custom" });
            const now = deviceOf(this.doc.device);
            const wi = cu.createEl("input", { attr: { type: "number", min: "240", max: "1600", placeholder: "W", value: devc.brand === "Custom" ? String(now.w) : "" } });
            cu.createSpan({ text: "×" });
            const hi = cu.createEl("input", { attr: { type: "number", min: "320", max: "2400", placeholder: "H", value: devc.brand === "Custom" ? String(now.h) : "" } });
            const ok = cu.createEl("button", { cls: "vl-act", text: "Use" });
            ok.addEventListener("click", () => {
                const w = Math.round(Number(wi.value)), h = Math.round(Number(hi.value));
                if (!(w >= 240 && w <= 1600 && h >= 320 && h <= 2400)) { new Notice("Vellum: a width of 240–1600 and a height of 320–2400 points"); return; }
                m.remove(); this.edit(() => { this.doc.device = customDevice(w, h).id; });
            });
            const off = (e: Event) => { if (!m.isConnected) return R.doc.removeEventListener("pointerdown", off, true); if (!m.contains(e.target as Node) && !dev.contains(e.target as Node)) { m.remove(); R.doc.removeEventListener("pointerdown", off, true); } };
            window.setTimeout(() => R.doc.addEventListener("pointerdown", off, true));
        });
        box.scrollTop = this.railTop;   // the list stays where it was scrolled (a tap opens a screen, the rail is drawn again)
    }
    // a large look at a screen without opening it: the pointer resting on its row (computer), a long press (phone)
    peekOn(row: HTMLElement, p: Page) {
        let t = 0;
        if (!Platform.isMobile) {
            row.addEventListener("mouseenter", () => this.peek(p, row));
            row.addEventListener("mouseleave", () => this.unpeek());
            row.addEventListener("pointerdown", () => this.unpeek());
            return;
        }
        let shown = false;
        row.addEventListener("pointerdown", () => { shown = false; t = window.setTimeout(() => { shown = true; this.peek(p, row); }, 450); });
        const off = () => { window.clearTimeout(t); if (shown) window.setTimeout(() => this.unpeek(), 0); };
        row.addEventListener("pointerup", off); row.addEventListener("pointercancel", off); row.addEventListener("pointerleave", off);
        row.addEventListener("click", (e) => { if (shown) { e.stopImmediatePropagation(); e.preventDefault(); shown = false; } }, true);
        row.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    peek(p: Page, row: HTMLElement, beside?: HTMLElement) {   // beside: to the left of that (else right of the rail)
        const R = this.root; if (!R?.isConnected) return;
        this.unpeek();
        const W = Platform.isMobile ? Math.min(300, R.clientWidth * 0.72) : 240;
        const box = R.createDiv({ cls: "vl-peek" });
        box.createDiv({ cls: "vl-peekname", text: p.name });
        box.appendChild(this.pic(p, W));
        const rr = R.getBoundingClientRect(), wr = row.getBoundingClientRect(), br = this.rail.getBoundingClientRect();
        if (Platform.isMobile) { box.style.left = `${(rr.width - W) / 2 - 8}px`; box.style.top = `${Math.max(56, (rr.height - box.offsetHeight) / 2)}px`; }
        else { box.style.left = `${beside ? Math.max(8, beside.getBoundingClientRect().left - rr.left - box.offsetWidth - 10) : br.right - rr.left + 10}px`; box.style.top = `${Math.max(8, Math.min(rr.height - box.offsetHeight - 8, wr.top - rr.top - 40))}px`; }
    }
    unpeek() { this.root?.querySelectorAll(".vl-peek").forEach((e) => e.remove()); }
    // a screen drawn small, as it looks (no frames)
    pic(p: Page, TW: number): HTMLElement {
        const d = deviceOf(p.device ?? this.doc.device), sc = screenOf(d, this.land), k = TW / sc.W;
        const el = createDiv({ cls: "vl-pthumb" });
        el.style.width = `${TW}px`; el.style.height = `${Math.round(sc.H * k)}px`; el.style.borderRadius = `${Math.max(3, d.radius * k)}px`;
        const scr = el.createDiv({ cls: "vl-screen is-show" });
        Object.assign(scr.style, { width: `${sc.W}px`, height: `${sc.H}px`, transform: `scale(${k})` });
        const bg = bgOf(this.doc.pages, p);
        if (bg) scr.style.background = colorOf(this.theme, bg);
        const keep = this.sel; this.sel = null;
        for (const b of drawnBlocks(this.doc.pages, p, this.land)) this.drawBlock(scr, p, b, true);
        this.sel = keep;
        return el;
    }
    // the tree's pictures are as big as its width allows: 22 px at the narrowest, up to 180 px
    picW(railW: number) { return Math.round(Math.min(180, Math.max(22, (railW - 190) * 0.9))); }
    // folded branches of the tree, kept on the device per doc
    folds(): Set<string> { try { return new Set(JSON.parse(getLocal(`vellum:fold:${this.draftKey()}`) ?? "[]") as string[]); } catch { return new Set(); } }
    keepFolds(f: Set<string>) { try { setLocal(`vellum:fold:${this.draftKey()}`, JSON.stringify([...f])); } catch { /* */ } }
    // a screen as a small picture (the rail's rows): drawn again only when the screen changed
    thumbs = new Map<string, { sig: string; el: HTMLElement }>();
    thumb(p: Page): HTMLElement {
        const tw = this.picW(this.rail?.offsetWidth || Number(getLocal("vellum:railW")) || 248);
        const sig = JSON.stringify(p) + JSON.stringify(drawnBlocks(this.doc.pages, p, this.land)) + bgOf(this.doc.pages, p) + this.doc.device + tw + this.land, hit = this.thumbs.get(p.id);
        if (hit && hit.sig === sig) return hit.el;
        const el = this.pic(p, tw);
        this.thumbs.set(p.id, { sig, el });
        return el;
    }
    // the map in the note's card: every page as a small screen; main pages along the top, each page's sub pages under it,
    // joined by lines (with how you get there); a click opens the editor on that page
    // TW: a screen's width in the map; pick: what a click does (the card: open the editor there); returns the slots across
    drawMap(m: HTMLElement, TW = 76, pick: (p: Page) => void = (p) => this.openWs(p.id)): { slots: number; rows: number } {
        m.empty();
        if (!this.doc.pages.length) { m.createDiv({ cls: "vl-empty", text: "No screens yet: open the editor to add one." }); return { slots: 0, rows: 0 }; }
        const pages = this.doc.pages, cur = this.root?.isConnected ? this.current() : undefined;
        const GAP = 40, LABEL = 46, slotW = TW + GAP;
        const dims = (p: Page) => { const d = deviceOf(p.device ?? this.doc.device), sc = screenOf(d, this.land); const k = TW / Math.max(sc.W, d.w); return { k, w: sc.W * k, h: sc.H * k, d, sc }; };
        const rowH = Math.max(...pages.map((p) => dims(p).h)) + LABEL + GAP;
        // a tidy tree: each leaf a slot, a parent centred over its children
        const pos = new Map<string, { x: number; y: number }>();
        let depthMax = 0;
        const place = (p: Page, depth: number, x0: number, seen: Set<string>): number => {
            if (seen.has(p.id)) return 0;
            seen.add(p.id); depthMax = Math.max(depthMax, depth);
            const kids = childrenOf(pages, p.id);
            let x = x0;
            for (const c of kids) x += place(c, depth + 1, x, seen);
            const w = Math.max(1, x - x0);
            pos.set(p.id, { x: x0 + (w - 1) / 2, y: depth });
            return w;
        };
        let x = 0; const seen = new Set<string>();
        for (const r of childrenOf(pages)) x += place(r, 0, x, seen);
        for (const p of pages) if (!pos.has(p.id)) x += place(p, 0, x, seen);   // anything left (a loop) as a main page
        const box = m.createDiv({ cls: "vl-mapbox" });
        box.style.width = `${x * slotW}px`; box.style.height = `${(depthMax + 1) * rowH - GAP + 4}px`;
        const NS = "http://www.w3.org/2000/svg";
        const svg = m.doc.createElementNS(NS, "svg"); svg.setAttribute("class", "vl-maplines"); svg.setAttribute("width", String(x * slotW)); svg.setAttribute("height", String((depthMax + 1) * rowH - GAP + 4));
        box.appendChild(svg);
        const at = (p: Page) => { const q = pos.get(p.id)!, d = dims(p); return { cx: q.x * slotW + slotW / 2, top: q.y * rowH, h: d.h }; };
        for (const p of pages) {
            const par = pages.find((q) => q.id === p.parent);
            if (!par || !pos.has(par.id)) continue;
            // from under the parent's name, down, across, down to the sub page (its link label sits just above it)
            const a = at(par), b = at(p);
            const y0 = a.top + a.h + 26, midY = y0 + 8;
            const path = m.doc.createElementNS(NS, "path");
            path.setAttribute("d", `M${a.cx} ${y0} V${midY} H${b.cx} V${b.top - 2}`);
            svg.appendChild(path);
            if (p.link) { const t = box.createDiv({ cls: "vl-maplink", text: p.link }); t.style.left = `${b.cx}px`; t.style.maxWidth = `${slotW}px`; t.style.top = `${b.top - 19}px`; }
        }
        const keep = this.sel; this.sel = null;   // the small screens show the page as it is (no frames, no choice)
        for (const p of pages) {
            const q = pos.get(p.id)!, d = dims(p);
            const t = box.createDiv({ cls: "vl-thumb" + (p.mock ? " is-mock" : "") + (p.parent ? "" : " is-main") });
            t.style.left = `${q.x * slotW + (slotW - d.w) / 2}px`; t.style.top = `${q.y * rowH}px`; t.style.width = `${d.w}px`;
            const ph = t.createDiv({ cls: "vl-tphone" }); ph.style.height = `${d.h}px`; ph.style.borderRadius = `${d.d.radius * d.k}px`;
            const scr = ph.createDiv({ cls: "vl-screen is-show" });
            const bg = bgOf(pages, p);
            if (bg) { scr.style.background = colorOf(this.theme, bg); ph.style.background = scr.style.background; }
            Object.assign(scr.style, { width: `${d.sc.W}px`, height: `${d.sc.H}px`, transform: `scale(${d.k})` });
            for (const b of drawnBlocks(pages, p, this.land)) this.drawBlock(scr, p, b, true);
            t.createDiv({ cls: "vl-tname", text: p.name });
            t.addEventListener("click", () => pick(p));
            if (p.id === cur?.id) t.addClass("is-on");
        }
        this.sel = keep;
        return { slots: x, rows: depthMax + 1 };
    }
    drawPage(p: Page) {
        const dev = deviceOf(p.device ?? this.doc.device), { W, H, safe } = this.screen(p), z = this.v.zoom, show = this.v.show;
        const fig = this.wall.createDiv({ cls: "vl-page" + (p.mock ? " is-mock" : "") + (this.sel?.page === p.id ? " is-sel" : "") });
        fig.createDiv({ cls: "vl-pname", text: p.name + (p.mock ? "  · mock" : "") });
        // Show: the screen as a preview: its name and the way to it above, the next / previous screen beside it, the
        // screens it opens under it
        if (show) { fig.addClass("is-showing"); this.showHead(fig, p); }
        const row = show ? fig.createDiv({ cls: "vl-showrow" }) : fig;
        const phone = row.createDiv({ cls: "vl-phone" });
        if (show) this.showAround(fig, row, phone, p);
        phone.style.width = `${W * z}px`; phone.style.height = `${H * z}px`; phone.style.borderRadius = `${dev.radius * z}px`;
        const scr = phone.createDiv({ cls: "vl-screen" + (show ? " is-show" : "") });
        const bg = bgOf(this.doc.pages, p);
        if (bg) { scr.style.background = colorOf(this.theme, bg); phone.style.background = scr.style.background; }
        Object.assign(scr.style, { width: `${W}px`, height: `${H}px`, transform: `scale(${z})`, borderRadius: `${dev.radius}px` });
        scr.style.setProperty("--vl-iz", String(1 / z));   // handles, outlines and labels keep their size on the monitor at any zoom
        // the device: status bar, cut-out, home indicator; safe areas shaded while editing
        if (!this.land) {
            const sb = scr.createDiv({ cls: "vl-status" }); sb.style.height = `${dev.top}px`;
            const cutW = dev.cut === "island" ? 125 : dev.cut === "notch" ? 209 : 0;
            sb.style.setProperty("--ear", `${(W - cutW) / 2}px`);
            sb.createDiv({ cls: "vl-ear" }).createSpan({ cls: "vl-time", text: "9:41" });
            const r = sb.createDiv({ cls: "vl-ear" });
            // signal bars, 5G, the battery (built as SVG elements: no HTML strings)
            const bars = r.createSvg("svg", { cls: "vl-bars", attr: { viewBox: "0 0 18 12", width: 18, height: 12 } });
            for (const [x, y, h] of [[0, 7.5, 4.5], [5, 5, 7], [10, 2.5, 9.5], [15, 0, 12]]) bars.createSvg("rect", { attr: { x, y, width: 3, height: h, rx: 1 } });
            r.createSpan({ cls: "vl-net", text: "5G" });
            const batt = r.createSvg("svg", { cls: "vl-batt", attr: { viewBox: "0 0 28 13", width: 28, height: 13 } });
            batt.createSvg("rect", { attr: { x: 0.5, y: 0.5, width: 24, height: 12, rx: 3.8, fill: "none", stroke: "currentColor", opacity: 0.4 } });
            batt.createSvg("rect", { attr: { x: 2, y: 2, width: 16, height: 9, rx: 2.4 } });
            batt.createSvg("path", { attr: { d: "M26 4.5v4a2.2 2.2 0 0 0 0-4z", opacity: 0.45 } });
        }
        if (dev.cut !== "none") scr.createDiv({ cls: `vl-cut is-${dev.cut}` + (this.land ? " is-side" : "") });
        if (safe.bottom) scr.createDiv({ cls: "vl-home" });
        if (!show) for (const [k, v] of Object.entries(safe)) if (v) { const s = scr.createDiv({ cls: `vl-safe is-${k}` }); s.style[k === "top" || k === "bottom" ? "height" : "width"] = `${v}px`; }
        // the frame's blocks (inherit) faded and locked under the page's own while editing; as they are in Show
        const layers = this.layers(p);
        const ov = this.ov, ovOn = ov.show && anyOn(ov) && (!show || ov.inShow);
        ovlGrid = ovOn && ov.snap && ov.grid.on ? ov.grid.size : 0;
        for (const l of layers) this.drawBlock(scr, p, l.block, show, show ? undefined : l);
        if (ovOn) this.drawOv(scr, p, z);
        if (!show && this.ov.notes) this.drawMarks(scr, p, z);
        scr.toggleClass("is-marking", this.marking && !show);
        // pointer: choose and drag
        // no landscape layout yet (nor a frame's): one button to start it from the portrait one
        if (this.land && !p.land && !layers.length) {
            const mk = scr.createDiv({ cls: "vl-mkland" });
            mk.createDiv({ text: "No landscape layout yet" });
            const go = mk.createEl("button", { cls: "mod-cta", text: "Make landscape from portrait" });
            go.addEventListener("click", (e) => { e.stopPropagation(); this.makeLand(p); });
            go.addEventListener("pointerdown", (e) => e.stopPropagation());
            return;
        }
        if (!show) scr.addEventListener("pointerdown", (e) => this.down(e, p, scr));
        if (!show) scr.addEventListener("dblclick", (e) => this.typeInPlace(e, p));
    }
    // the overlays over the screen; the vanishing points drag (the horizon goes with them)
    drawOv(scr: HTMLElement, p: Page, z: number) {
        scr.querySelectorAll(":scope > .vl-ovl, :scope > .vl-ovframe").forEach((e) => e.remove());
        const { W, H } = this.screen(p), ov = this.ov, off = <T extends { on: boolean }>(x: T): T => ({ ...x, on: false });
        // the layout grids and perspective over the whole screen; the composition guides in their own frame, which moves
        const svg = drawOverlay(scr, { ...ov, thirds: off(ov.thirds), phi: off(ov.phi), spiral: off(ov.spiral), diag: off(ov.diag), center: off(ov.center) }, W, H, this.room(p), z);
        if (compOn(ov)) {
            const A = ov.area ?? { x: 0, y: 0, w: W, h: H };
            const f = scr.createDiv({ cls: "vl-ovframe vl-mark is-area" + (ov.area ? " is-moved" : "") });
            Object.assign(f.style, { left: `${A.x}px`, top: `${A.y}px`, width: `${A.w}px`, height: `${A.h}px` });
            f.style.setProperty("--mc", OVL_COLORS.phi);
            drawOverlay(f, { ...ov, grid: off(ov.grid), cols: off(ov.cols), rows: off(ov.rows), persp: off(ov.persp) }, A.w, A.h, { l: 0, t: 0, r: A.w, b: A.h }, z, { foot: false }).addClass("is-inmark");
            for (const side of ["t", "r", "b", "l"]) f.createDiv({ cls: `vl-medge is-${side}` });
            f.createDiv({ cls: "vl-mtag", text: `Composition  ·  ${ratioText(A.w, A.h)}`, attr: { "aria-label": "Drag: move the composition guides; the corner: resize (Shift: keep the shape). Double-click: the whole screen again", "data-tooltip-position": "top" } });
            f.createDiv({ cls: "vl-mgrip", attr: { "data-ovgrip": "1" } });
            f.addEventListener("pointerdown", (e) => this.ovFrameDown(e, p, scr, z, A));
            f.addEventListener("dblclick", (e) => { e.stopPropagation(); ov.area = null; this.keepOv(); this.drawPages(); });
        }
        // the vanishing points: dragged with the screen holding the pointer (the overlay is drawn again as they move)
        svg.querySelectorAll<SVGCircleElement>(".vl-vp").forEach((h) => h.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.stopPropagation(); e.preventDefault();
            const r = scr.getBoundingClientRect(), two = h.dataset.vp === "2";
            scr.setPointerCapture(e.pointerId);
            const mv = (m: PointerEvent) => {
                const fx = Math.round(((m.clientX - r.left) / z / W) * 1000) / 1000, fy = Math.round(((m.clientY - r.top) / z / H) * 1000) / 1000;
                if (two) ov.persp.x2 = fx; else ov.persp.x = fx;
                ov.persp.y = Math.min(1, Math.max(0, fy));
                this.drawOv(scr, p, z);
            };
            const up = () => { scr.removeEventListener("pointermove", mv); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up); this.keepOv(); this.drawPages(); };
            scr.addEventListener("pointermove", mv); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
        }));
    }
    // the composition frame: its tag or edge moves it, its corner resizes it; snaps to the screen's edges and middle,
    // the blocks and the grid; kept on the device with the other overlay settings
    ovFrameDown(e: PointerEvent, p: Page, scr: HTMLElement, z: number, A: { x: number; y: number; w: number; h: number }) {
        if (e.button !== 0 || e.detail > 1) return;
        e.stopPropagation(); e.preventDefault();
        const grip = !!(e.target as HTMLElement).closest("[data-ovgrip]"), x0 = e.clientX, y0 = e.clientY, st = { ...A }, ov = this.ov;
        const { W, H } = this.screen(p), bl = this.layers(p).map((l) => l.block);
        const lx = [0, W / 2, W, ...bl.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])], ly = [0, H / 2, H, ...bl.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
        let moved = false;
        scr.setPointerCapture(e.pointerId);
        const mv = (m: PointerEvent) => {
            const dx = (m.clientX - x0) / z, dy = (m.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            moved = true;
            const on = snap.on && !m.altKey, reach = snap.dist / z, sn = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / grid()) * grid());
            const fit = (v: number, pts: number[], ls: number[]) => { const g = on ? near(pts.map((q) => q + v), ls, reach) : null; return g ? Math.round(v + g.d) : sn(v); };
            const a = { ...st };
            if (grip) { a.w = Math.max(16, fit(st.w + dx, [st.x], lx)); a.h = m.shiftKey ? Math.max(16, Math.round((a.w * st.h) / st.w)) : Math.max(16, fit(st.h + dy, [st.y], ly)); }
            else { a.x = fit(st.x + dx, [0, st.w / 2, st.w], lx); a.y = fit(st.y + dy, [0, st.h / 2, st.h], ly); }
            ov.area = a;
            this.drawOv(scr, p, z);
        };
        const up = () => { scr.removeEventListener("pointermove", mv); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up); if (moved) { this.keepOv(); this.drawPages(); } };
        scr.addEventListener("pointermove", mv); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }
    // the screens in the rail's order (each main screen, then the screens opened from it)
    order(): Page[] {
        const out: Page[] = [], seen = new Set<string>(), pages = this.doc.pages;
        const walk = (p: Page) => { if (seen.has(p.id)) return; seen.add(p.id); out.push(p); for (const c of childrenOf(pages, p.id)) walk(c); };
        for (const p of childrenOf(pages)) walk(p);
        for (const p of pages) walk(p);
        return out;
    }
    showGo(step: number) { const o = this.order(), i = o.findIndex((x) => x.id === this.current()?.id), n = o[i + step]; if (n) this.openPage(n); }
    showHead(fig: HTMLElement, p: Page) {
        const h = fig.createDiv({ cls: "vl-showhead" });
        const par = p.parent ? this.page(p.parent) : undefined;
        if (par) {
            const c = h.createDiv({ cls: "vl-showfrom" });
            const back = c.createEl("button", { cls: "vl-showlink", attr: { "aria-label": `Back to ${par.name}` } });
            setIcon(back.createSpan(), "corner-left-up"); back.appendText(par.name);
            back.addEventListener("click", () => this.openPage(par));
            if (p.link) c.createSpan({ cls: "vl-showhow", text: p.link });
        }
        const t = h.createDiv({ cls: "vl-showtitle" });
        t.createSpan({ text: p.name });
        if (p.mock) t.createSpan({ cls: "vl-mocktag", text: "mock" });
        if (p.note) h.createDiv({ cls: "vl-shownote", text: p.note.split("\n")[0] });
    }
    showAround(fig: HTMLElement, row: HTMLElement, phone: HTMLElement, p: Page) {
        const o = this.order(), i = o.findIndex((x) => x.id === p.id);
        const arrow = (step: number, icon: string) => {
            const n = o[i + step], b = createEl("button", { cls: "vl-shownav" + (n ? "" : " is-off"), attr: { "aria-label": n ? `${step < 0 ? "Previous" : "Next"}: ${n.name} (${step < 0 ? "←" : "→"})` : "" } });
            setIcon(b, icon);
            if (n) b.addEventListener("click", () => this.openPage(n)); else b.disabled = true;
            return b;
        };
        row.insertBefore(arrow(-1, "chevron-left"), phone);
        row.appendChild(arrow(1, "chevron-right"));
        const f = fig.createDiv({ cls: "vl-showfoot" });
        const kids = childrenOf(this.doc.pages, p.id);
        if (kids.length) {
            const g = f.createDiv({ cls: "vl-showkids" });
            g.createSpan({ cls: "vl-showlabel", text: "Opens" });
            for (const k of kids) {
                const c = g.createEl("button", { cls: "vl-showkid" });
                c.createSpan({ cls: "vl-showkn", text: k.name });
                if (k.link) c.createSpan({ cls: "vl-showhow", text: k.link });
                setIcon(c.createSpan({ cls: "vl-showki" }), "arrow-right");
                c.addEventListener("click", () => this.openPage(k));
            }
        }
        f.createDiv({ cls: "vl-showcount", text: `${i + 1} / ${o.length}` });
    }
    // one block again, in its place (a drag keeps its screen element, which holds the pointer)
    redrawBlock(scr: HTMLElement, p: Page, b: Block) {
        const old = scr.querySelector(`[data-block="${b.id}"]`);
        const el = this.drawBlock(scr, p, b, false, this.layers(p).find((l) => l.block === b));
        if (old) old.replaceWith(el);
    }
    // l (editing): where the block comes from: a frame's (inherited: faded, locked) or an override of one (a small mark)
    drawBlock(scr: HTMLElement, p: Page, b: Block, show: boolean, l?: Layer): HTMLElement {
        const kind = this.kinds.find((k) => k.id === b.kind) ?? this.kinds[0];
        const sel = this.sel?.page === p.id && this.sel.block === b.id;
        const inh = !!l?.from && !l.over;
        const inGroup = !show && this.sel?.page === p.id && this.many.includes(b);
        const el = scr.createDiv({ cls: "vl-block" + (sel || inGroup ? " is-sel" : "") + (inGroup ? " is-many" : "") + (inh ? " is-inh" : "") + (l?.over ? " is-over" : ""), attr: { "data-block": b.id } });
        Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
        applyLook(this.theme, el.style, b);
        el.style.setProperty("--k", kind?.color ?? "var(--text-faint)");
        if (!show) {
            const tag = el.createDiv({ cls: "vl-tag" });
            if (inh) setIcon(tag.createSpan({ cls: "vl-tagi" }), "lock");
            tag.appendText(b.name + (inh ? ` · ${this.page(l.from)?.name ?? "frame"}` : ""));
        }
        for (const it of b.items) drawItem(this.theme, el, it);
        if (!show && this.sel?.page === p.id) for (const x of this.manyItems) if (x.b === b) el.querySelector(`[data-id="${x.it.id}"]`)?.addClass("is-sel");
        if (l?.over && !show) setIcon(el.createDiv({ cls: "vl-overmark", attr: { "aria-label": `Overrides ${this.page(l.over)?.name ?? "the frame"}'s ${b.name}` } }), "layers-2");
        if (sel && inh) { /* locked: no grip, no items to choose */ }
        else if (sel) {
            const id = this.sel?.item;
            if (id) {
                const selEl = el.querySelector<HTMLElement>(`[data-id="${id}"]`);
                selEl?.addClass("is-sel");
                if (selEl) selInk(el, selEl);
                const it = findItem(b.items, id)?.item;
                // the gravity point the item keeps, on the block
                if (it && b.items.includes(it)) { const [ax, ay] = axes(it.g); const d = el.createDiv({ cls: "vl-anchor" }); d.style.left = `${(ax + 1) * 50}%`; d.style.top = `${(ay + 1) * 50}%`; }
                if (it && b.items.includes(it) && RESIZE.includes(it.type)) this.itemGrips(el, b, it);
                if (it && this.ov.ratio && this.ov.show) { const bx = this.itemBox(el, b, it); if (bx) { const r = el.createDiv({ cls: "vl-ratio", text: ratioText(bx.W, bx.H) }); r.addClass("is-under"); r.setCssStyles({ left: `${Math.max(0, bx.L)}px` }); } }   // under the block: never over its content
            } else {
                el.createDiv({ cls: "vl-grip", attr: { "data-grip": "1" } });
                if (this.ov.ratio && this.ov.show) { const r = el.createDiv({ cls: "vl-ratio", text: ratioText(b.w, b.h) }); r.addClass("is-under"); }
            }
        }
        return el;
    }

    // a chosen picture / shape (placed in its block, not in a row): a handle at both bottom corners to resize it
    itemGrips(bEl: HTMLElement, b: Block, it: Item) {
        const box = this.itemBox(bEl, b, it); if (!box) return;
        for (const c of ["bl", "br"] as const) {
            const g = bEl.createDiv({ cls: `vl-igrip is-${c}`, attr: { "data-igrip": c, "aria-label": "Resize (Shift: keep the shape, Alt: 1 px)" } });
            g.style.left = `${c === "bl" ? box.L : box.L + box.W}px`; g.style.top = `${box.T + box.H}px`;
        }
    }
    // an item's box in its block's points, as drawn (hug and fill too)
    itemBox(bEl: HTMLElement, b: Block, it: Item) {
        const iEl = bEl.querySelector<HTMLElement>(`[data-id="${it.id}"]`), br = bEl.getBoundingClientRect();
        if (!iEl || !br.width) return null;
        const ir = iEl.getBoundingClientRect(), k = br.width / b.w;
        return { L: (ir.left - br.left) / k, T: (ir.top - br.top) / k, W: ir.width / k, H: ir.height / k };
    }
    // the lines a box snaps to: an item's in its block (block points), a block's on the screen
    itemLines(bEl: HTMLElement, b: Block, it: Item): Lines {
        const x: number[] = [], y: number[] = [], p = this.page();
        // the overlay lines, in the block's points
        if (p) { const { W, H } = this.screen(p), o = overlayLines(this.ov, W, H, this.room(p)), ml = this.markLines(p); x.push(...[...o.x, ...ml.x].map((v) => v - b.x)); y.push(...[...o.y, ...ml.y].map((v) => v - b.y)); }
        if (snap.frame) {
            x.push(0, b.w / 2, b.w); y.push(0, b.h / 2, b.h);
            for (const m of snap.margins) { x.push(m, b.w - m); y.push(m, b.h - m); }
        }
        if (snap.others) for (const o of b.items) {
            if (o === it) continue;
            const r = this.itemBox(bEl, b, o); if (!r) continue;
            x.push(r.L, r.L + r.W / 2, r.L + r.W); y.push(r.T, r.T + r.H / 2, r.T + r.H);
        }
        return { x, y };
    }
    blockLines(p: Page, b: Block, skip?: Set<string>): Lines {
        const { W, H, safe } = this.screen(p), o = overlayLines(this.ov, W, H, this.room(p)), ml = this.markLines(p), x: number[] = [...o.x, ...ml.x], y: number[] = [...o.y, ...ml.y];
        if (snap.frame) {
            const l = safe.left, r = W - safe.right, t = safe.top, bo = H - safe.bottom;
            x.push(0, W / 2, W, l, r); y.push(0, H / 2, H, t, bo);
            for (const m of snap.margins) { x.push(l + m, r - m); y.push(t + m, bo - m); }
        }
        if (snap.others) for (const { block: o } of this.layers(p)) {
            if (o.id === b.id || skip?.has(o.id)) continue;
            x.push(o.x, o.x + o.w / 2, o.x + o.w); y.push(o.y, o.y + o.h / 2, o.y + o.h);
        }
        return { x, y };
    }
    // the lines a drag snapped to, across the screen (screen points); none = cleared
    guides(scr: HTMLElement, xs: number[] = [], ys: number[] = []) {
        scr.querySelectorAll(".vl-guide").forEach((g) => g.remove());
        if (!snap.guides) return;
        for (const v of xs) { const g = scr.createDiv({ cls: "vl-guide is-v" }); g.style.left = `${v}px`; }
        for (const v of ys) { const g = scr.createDiv({ cls: "vl-guide is-h" }); g.style.top = `${v}px`; }
    }
    // drag a corner: w / h change live (snapped like blocks, Alt 1 px, Shift keeps the shape); the opposite edge stays put,
    // whatever the item's gravity (its offset follows); a "fill" size becomes a number
    resizeItem(e: PointerEvent, p: Page, b: Block, scr: HTMLElement, corner: "bl" | "br") {
        const it = this.item()?.item, bEl = scr.querySelector<HTMLElement>(`[data-block="${b.id}"]`);
        const box0 = it && bEl ? this.itemBox(bEl, b, it) : null;
        if (!it || !box0) return;
        const L0 = Math.round(box0.L), T0 = Math.round(box0.T), W0 = Math.round(box0.W), H0 = Math.round(box0.H);
        const [ax, ay] = axes(it.g), x0 = e.clientX, y0 = e.clientY, z = this.v.zoom;
        let moved = false;
        const lines = this.itemLines(bEl!, b, it);
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            const dx = (m.clientX - x0) / z, dy = (m.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
            if (!moved) { moved = true; this.begin(); }
            const sn = (v: number) => Math.max(4, m.altKey ? Math.round(v) : Math.round(v / grid()) * grid());
            const on = snap.on && !m.altKey, reach = snap.dist / z, gx: number[] = [], gy: number[] = [];
            // the moving edges snap to a line in reach, else the size to the grid
            const gX = on ? near([corner === "br" ? L0 + W0 + dx : L0 + dx], lines.x, reach) : null;
            if (gX) gx.push(gX.at);
            const W = gX ? Math.max(4, Math.round(corner === "br" ? gX.at - L0 : L0 + W0 - gX.at)) : sn(corner === "br" ? W0 + dx : W0 - dx);
            const gY = on && !m.shiftKey ? near([T0 + H0 + dy], lines.y, reach) : null;
            if (gY) gy.push(gY.at);
            const H = m.shiftKey && W0 && H0 ? Math.max(4, Math.round((W * H0) / W0)) : gY ? Math.max(4, Math.round(gY.at - T0)) : sn(H0 + dy);
            const L = corner === "br" ? L0 : L0 + W0 - W;
            it.w = W; it.h = H;
            it.dx = ax < 0 ? L : ax > 0 ? b.w - L - W : Math.round(L + W / 2 - b.w / 2);
            it.dy = ay < 0 ? T0 : ay > 0 ? b.h - T0 - H : Math.round(T0 + H / 2 - b.h / 2);
            this.redrawBlock(scr, p, b);
            this.guides(scr, gx.map((v) => v + b.x), gy.map((v) => v + b.y));
            this.livePanel();
        };
        const up = () => { scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up); this.guides(scr); if (moved) { this.end(); this.drawPanel(); } };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }

    // ---- pointer: a tap chooses, a drag moves (snaps to 4 px, Alt for 1 px)
    down(e: PointerEvent, p: Page, scr: HTMLElement) {
        if (e.button !== 0) return;
        if (this.marking) { this.markDraw(e, p, scr); return; }
        const t = e.target as HTMLElement;
        const bEl = t.closest<HTMLElement>("[data-block]"), b = bEl ? this.blocks(p).find((x) => x.id === bEl.dataset.block) : undefined;
        const grip = !!t.closest("[data-grip]");
        const itEl = t.closest<HTMLElement>(".vl-it");
        // an item inside a row moves with its row: the drag takes the top-level item, the tap chooses the inner one
        const topEl = t.closest<HTMLElement>("[data-top]");
        let pickId = itEl?.dataset.id, dragId = topEl?.dataset.id;
        // groups: a tap chooses the group until it (or something in it) is chosen, then what is in it; a drag moves the
        // item at the level that is open (in an open group: its item, alone)
        if (b && itEl) { const r = this.pickLevel(b, itEl); pickId = r.pick; dragId = r.drag ?? dragId; }
        const before = this.sel;
        // empty space on the screen: a drag chooses the blocks in its area, a tap the page; Ctrl (Cmd): the items, anywhere
        if (!bEl || ((e.ctrlKey || e.metaKey) && !t.closest("[data-grip], [data-igrip]"))) { this.marquee(e, p, scr, false); return; }
        // an item of the item group: they move together; Shift+click on an item, with items chosen: in or out
        const mi = this.manyItems;
        if (b && dragId && mi.some((x) => x.it.id === dragId) && !e.shiftKey) { this.dragItems(e, p, scr, b, dragId); return; }
        if (b && dragId && e.shiftKey && b.items.some((i) => i.id === dragId) && (mi.length || (this.sel?.item && this.sel.page === p.id))) {
            const list = mi.map((x) => ({ block: x.b.id, item: x.it.id }));
            if (!list.length) { const cb = this.block(), top = cb?.items.find((i) => i.id === this.sel!.item || !!findItem([i], this.sel!.item!)); if (cb && top) list.push({ block: cb.id, item: top.id }); }
            const i = list.findIndex((x) => x.item === dragId);
            if (i >= 0) list.splice(i, 1); else list.push({ block: b.id, item: dragId });
            this.chooseItems(p, list);
            return;
        }
        if (!b) {
            // a frame's block (locked here): chosen, to override it or go and edit it in its page
            const l = this.layers(p).find((x) => x.block.id === bEl.dataset.block);
            this.choose(l ? { page: p.id, block: l.block.id } : { page: p.id });
            return;
        }
        // Shift+click: a block in or out of the group (the block chosen alone starts it)
        if (e.shiftKey && !this.sel?.item) {
            const ids = this.many.map((x) => x.id);
            if (!ids.length && this.sel?.page === p.id && this.sel.block && this.sel.block !== b.id && this.blocks(p).some((x) => x.id === this.sel!.block)) ids.push(this.sel.block);
            const i = ids.indexOf(b.id);
            if (i >= 0) ids.splice(i, 1); else ids.push(b.id);
            this.chooseMany(p, ids);
            return;
        }
        if (this.many.includes(b)) { this.dragMany(e, p, scr, b); return; }
        const ig = t.closest<HTMLElement>("[data-igrip]");
        if (ig && this.sel?.item && this.sel.block === b.id) { this.resizeItem(e, p, b, scr, ig.dataset.igrip as "bl" | "br"); return; }
        // first tap on a block chooses the block; an item is chosen once its block is (or straight away with a double tap)
        const blockChosen = before?.page === p.id && before.block === b.id;
        // Ctrl / Cmd + click, or a press on the block's name tag: the block itself (a drag moves it), never an item in it
        const wholeBlock = e.ctrlKey || e.metaKey || !!t.closest(".vl-tag");
        const target: Sel = pickId && blockChosen && !wholeBlock ? { page: p.id, block: b.id, item: pickId } : { page: p.id, block: b.id };
        const dragItem = target?.item ? findItem(b.items, dragId!)?.item : undefined;
        const holder = dragItem ? parentOf(b.items, dragItem.id) : null, inGroup = holder?.type === "group";   // in a group: grid steps, then the group fits its items again
        const x0 = e.clientX, y0 = e.clientY, z = this.v.zoom, start = { ...b }, istart = dragItem ? { dx: dragItem.dx ?? 0, dy: dragItem.dy ?? 0 } : null;
        let moved = false;
        // what the drag snaps to, measured once as it starts (the rest stays put): the item's box and its block's lines,
        // or the block's lines on the screen
        let ib: { L: number; T: number; W: number; H: number } | null = null, lines: Lines = { x: [], y: [] };
        const R = this.room(p, b), keep = !b.bleed && inRoom(b, R);
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            const dx = (m.clientX - x0) / z, dy = (m.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            if (!moved) {
                moved = true; this.begin();
                const be = scr.querySelector<HTMLElement>(`[data-block="${b.id}"]`);
                if (dragItem && be && !inGroup) { ib = this.itemBox(be, b, dragItem); lines = this.itemLines(be, b, dragItem); } else if (!dragItem) lines = this.blockLines(p, b);
                if (!blockChosen || target?.item !== this.sel?.item) { this.sel = target; this.drawPanel(); }
            }
            const sn = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / grid()) * grid());
            const on = snap.on && !m.altKey, reach = snap.dist / z, gx: number[] = [], gy: number[] = [];
            const pick = (pts: number[], ls: number[], out: number[]) => { const g = on ? near(pts, ls, reach) : null; if (g) out.push(g.at); return g; };
            let ox = 0, oy = 0;   // guides in screen points: an item's are in its block
            if (dragItem && istart) {
                const [ax, ay] = axes(dragItem.g);
                ox = b.x; oy = b.y;
                if (dragItem.w !== "fill") {
                    const L = (ib?.L ?? 0) + dx, W = ib?.W ?? 0, g = ib ? pick([L, L + W / 2, L + W], lines.x, gx) : null;
                    dragItem.dx = g ? toD(ax, L + g.d, W, b.w) : sn(istart.dx + (ax > 0 ? -dx : dx));
                }
                if (dragItem.h !== "fill") {
                    const T = (ib?.T ?? 0) + dy, H = ib?.H ?? 0, g = ib ? pick([T, T + H / 2, T + H], lines.y, gy) : null;
                    dragItem.dy = g ? toD(ay, T + g.d, H, b.h) : sn(istart.dy + (ay > 0 ? -dy : dy));
                }
            } else if (grip) {
                const gR = pick([start.x + start.w + dx], lines.x, gx), gB = pick([start.y + start.h + dy], lines.y, gy);
                b.w = Math.max(8, gR ? Math.round(gR.at - start.x) : sn(start.w + dx));
                b.h = Math.max(8, gB ? Math.round(gB.at - start.y) : sn(start.h + dy));
            } else {
                const L = start.x + dx, T = start.y + dy;
                const g1 = pick([L, L + b.w / 2, L + b.w], lines.x, gx), g2 = pick([T, T + b.h / 2, T + b.h], lines.y, gy);
                b.x = g1 ? Math.round(L + g1.d) : sn(L); b.y = g2 ? Math.round(T + g2.d) : sn(T);
            }
            if (!dragItem && keep) clampTo(b, R, grip);
            this.redrawBlock(scr, p, b);
            this.guides(scr, gx.map((v) => v + ox), gy.map((v) => v + oy));
            this.livePanel();
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            this.guides(scr);
            if (moved) { if (inGroup && holder && b.items.includes(holder)) this.refit(scr, b, holder); this.end(); return; }
            const again = target?.item && before?.item === target.item;
            this.choose(target);
            if (again && Platform.isMobile) this.writeItem(b, target.item!);
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }

    // a drag over empty space draws an area, as in Figma / Sketch: the blocks wholly inside it are chosen together; when
    // none is, the items it touches in the blocks it crosses (a block it touches with no item under the area: the block).
    // Shift: added to what is chosen. A tap: the page (on the screen) or nothing (beside it)
    marquee(e: PointerEvent, p: Page, scr: HTMLElement, outside: boolean) {
        const z = this.v.zoom, r = scr.getBoundingClientRect();
        const at = (x: number, y: number) => [(x - r.left) / z, (y - r.top) / z];
        const deep = e.ctrlKey || e.metaKey;
        if (deep) { this.marqueeItems(e, p, scr, outside); return; }
        const [x0, y0] = at(e.clientX, e.clientY), add = e.shiftKey ? this.many.map((b) => b.id) : [];
        if (add.length === 0 && e.shiftKey && this.sel?.page === p.id && this.sel.block && !this.sel.item) add.push(this.sel.block);
        const addItems = e.shiftKey ? this.manyItems.map((x) => ({ block: x.b.id, item: x.it.id })) : [];
        let box: HTMLElement | null = null, hits: string[] = [], itemHits: { block: string; item: string }[] = [];
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            const [x1, y1] = at(m.clientX, m.clientY);
            if (!box && Math.abs(x1 - x0) * z + Math.abs(y1 - y0) * z < 4) return;
            box ??= scr.createDiv({ cls: "vl-marq" });
            const L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
            Object.assign(box.style, { left: `${L}px`, top: `${T}px`, width: `${W}px`, height: `${H}px` });
            const own = this.blocks(p);
            const whole = own.filter((b) => b.x >= L && b.x + b.w <= L + W && b.y >= T && b.y + b.h <= T + H);
            const touched = own.filter((b) => b.x < L + W && b.x + b.w > L && b.y < T + H && b.y + b.h > T);
            hits = []; itemHits = [];
            scr.querySelectorAll<HTMLElement>(".vl-it.is-hit").forEach((el) => el.removeClass("is-hit"));
            if (whole.length) hits = whole.map((b) => b.id);
            else {
                // the items under the area, in the blocks it crosses (measured as drawn, in client pixels)
                const cL = r.left + L * z, cT = r.top + T * z, cR = cL + W * z, cB = cT + H * z;
                for (const b of touched) {
                    const bEl = scr.querySelector<HTMLElement>(`[data-block="${b.id}"]`); if (!bEl) continue;
                    let any = false;
                    bEl.querySelectorAll<HTMLElement>(".vl-it[data-top]").forEach((iEl) => {
                        const q = iEl.getBoundingClientRect();
                        if (q.left < cR && q.right > cL && q.top < cB && q.bottom > cT) { iEl.addClass("is-hit"); itemHits.push({ block: b.id, item: iEl.dataset.id! }); any = true; }
                    });
                    if (!any) hits.push(b.id);
                }
                if (itemHits.length) hits = [];
            }
            scr.querySelectorAll<HTMLElement>("[data-block]").forEach((el) => el.toggleClass("is-hit", hits.includes(el.dataset.block!)));
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            if (!box) { if (!outside) this.choose({ page: p.id }); else if (this.sel) this.choose(null); return; }
            box.remove();
            if (itemHits.length) { const all = [...addItems]; for (const h of itemHits) if (!all.some((x) => x.item === h.item)) all.push(h); this.chooseItems(p, all); }
            else this.chooseMany(p, [...new Set([...add, ...hits])]);
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }
    // Ctrl (Cmd) + drag: the area chooses the items it touches (each placed in its block; a row is one item), in the
    // page's own blocks (not a frame's). Shift: added to the items chosen. A tap: as a plain tap
    marqueeItems(e: PointerEvent, p: Page, scr: HTMLElement, outside: boolean) {
        const x0 = e.clientX, y0 = e.clientY, z = this.v.zoom, r = scr.getBoundingClientRect();
        const add = e.shiftKey ? this.manyItems.map((x) => ({ block: x.b.id, item: x.it.id })) : [];
        const own = new Set(this.blocks(p).map((b) => b.id));
        let box: HTMLElement | null = null, hits: { block: string; item: string }[] = [];
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            if (!box && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 4) return;
            box ??= scr.createDiv({ cls: "vl-marq is-deep" });
            const L = Math.min(x0, m.clientX), T = Math.min(y0, m.clientY), R = Math.max(x0, m.clientX), B = Math.max(y0, m.clientY);
            Object.assign(box.style, { left: `${(L - r.left) / z}px`, top: `${(T - r.top) / z}px`, width: `${(R - L) / z}px`, height: `${(B - T) / z}px` });
            hits = [];
            scr.querySelectorAll<HTMLElement>("[data-block]").forEach((bEl) => {
                if (!own.has(bEl.dataset.block!)) return;
                bEl.querySelectorAll<HTMLElement>(".vl-it[data-top]").forEach((iEl) => {
                    const q = iEl.getBoundingClientRect(), hit = q.left < R && q.right > L && q.top < B && q.bottom > T;
                    iEl.toggleClass("is-hit", hit);
                    if (hit) hits.push({ block: bEl.dataset.block!, item: iEl.dataset.id! });
                });
            });
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            if (!box) {
                // a Ctrl+click: the item under the pointer straight away (its block need not be chosen first)
                const t = e.target as HTMLElement, bEl = t.closest<HTMLElement>("[data-block]"), id = t.closest<HTMLElement>(".vl-it")?.dataset.id;
                if (bEl && id && own.has(bEl.dataset.block!)) this.choose({ page: p.id, block: bEl.dataset.block!, item: id });
                else if (!outside) this.choose({ page: p.id }); else if (this.sel) this.choose(null);
                return;
            }
            box.remove();
            const all = [...add]; for (const h of hits) if (!all.some((x) => x.item === h.item)) all.push(h);
            this.chooseItems(p, all);
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }
    // the chosen items move together, each from its own gravity point (snapped to the grid; Alt 1 px); a tap chooses
    // the one under the pointer alone
    dragItems(e: PointerEvent, p: Page, scr: HTMLElement, hitB: Block, hitId: string) {
        const list = this.manyItems, z = this.v.zoom, x0 = e.clientX, y0 = e.clientY;
        const start = list.map((x) => ({ ...x, dx: x.it.dx ?? 0, dy: x.it.dy ?? 0 }));
        let moved = false;
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            const dx = (m.clientX - x0) / z, dy = (m.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            if (!moved) { moved = true; this.begin(); }
            const sn = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / grid()) * grid());
            const mx = sn(dx), my = sn(dy), blocks = new Set<Block>();
            for (const s of start) {
                const [ax, ay] = axes(s.it.g);
                if (s.it.w !== "fill") s.it.dx = s.dx + (ax > 0 ? -mx : mx);
                if (s.it.h !== "fill") s.it.dy = s.dy + (ay > 0 ? -my : my);
                blocks.add(s.b);
            }
            for (const b of blocks) this.redrawBlock(scr, p, b);
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            if (moved) this.end(); else this.choose({ page: p.id, block: hitB.id, item: hitId });
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }
    // the chosen blocks move together: their outline snaps (to the frame and the blocks not moving), those inside their
    // room stay in it; a tap (no drag) chooses the one under the pointer alone
    dragMany(e: PointerEvent, p: Page, scr: HTMLElement, hit: Block) {
        const group = this.many, z = this.v.zoom, x0 = e.clientX, y0 = e.clientY;
        const start = group.map((b) => ({ b, x: b.x, y: b.y, R: this.room(p, b), keep: !b.bleed && inRoom(b, this.room(p, b)) }));
        const L0 = Math.min(...group.map((b) => b.x)), T0 = Math.min(...group.map((b) => b.y));
        const W = Math.max(...group.map((b) => b.x + b.w)) - L0, H = Math.max(...group.map((b) => b.y + b.h)) - T0;
        // how far the group may go before a block that is inside its room would leave it
        let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
        for (const s of start) if (s.keep) { minX = Math.max(minX, s.R.l - s.x); maxX = Math.min(maxX, s.R.r - s.x - s.b.w); minY = Math.max(minY, s.R.t - s.y); maxY = Math.min(maxY, s.R.b - s.y - s.b.h); }
        const lines = this.blockLines(p, hit, new Set(group.map((b) => b.id)));
        let moved = false;
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            const dx = (m.clientX - x0) / z, dy = (m.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            if (!moved) { moved = true; this.begin(); }
            const sn = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / grid()) * grid());
            const on = snap.on && !m.altKey, reach = snap.dist / z, gx: number[] = [], gy: number[] = [];
            const L = L0 + dx, T = T0 + dy;
            const g1 = on ? near([L, L + W / 2, L + W], lines.x, reach) : null, g2 = on ? near([T, T + H / 2, T + H], lines.y, reach) : null;
            if (g1) gx.push(g1.at); if (g2) gy.push(g2.at);
            const mx = Math.min(maxX, Math.max(minX, (g1 ? Math.round(L + g1.d) : sn(L)) - L0));
            const my = Math.min(maxY, Math.max(minY, (g2 ? Math.round(T + g2.d) : sn(T)) - T0));
            for (const s of start) { s.b.x = s.x + mx; s.b.y = s.y + my; this.redrawBlock(scr, p, s.b); }
            this.guides(scr, gx, gy);
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            this.guides(scr);
            if (moved) this.end(); else this.choose({ page: p.id, block: hit.id });
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }

    // what a tap picks and a drag takes, in the chain of items under the pointer (top first): a group not open stops it
    // (open: it, or something in it, is chosen); a drag takes the item right inside the deepest open group, else the top one
    pickLevel(b: Block, itEl: HTMLElement): { pick?: string; drag?: string } {
        const chain: HTMLElement[] = [];
        for (let e: HTMLElement | null = itEl; e && !e.dataset.block; e = e.parentElement) if (e.hasClass("vl-it")) chain.unshift(e);
        const selId = this.sel?.block === b.id ? this.sel.item : undefined;
        let pick = chain[chain.length - 1], drag: HTMLElement | undefined, open = -1;
        for (let i = 0; i < chain.length; i++) {
            const it = findItem(b.items, chain[i].dataset.id!)?.item;
            if (it?.type !== "group") continue;
            if (selId && (selId === it.id || findItem(it.items ?? [], selId))) { open = i; continue; }
            pick = chain[i]; break;
        }
        if (open >= 0 && chain[open + 1]) drag = chain[open + 1];
        return { pick: pick?.dataset.id, drag: drag?.dataset.id };
    }
    // a group's box fitted to its items again (after one moved in it): the items keep their place on the screen, each
    // placed from the group's top left; the group keeps its gravity
    refit(scr: HTMLElement, b: Block, g: Item) {
        const bEl = scr.querySelector<HTMLElement>(`[data-block="${b.id}"]`), gEl = bEl?.querySelector<HTMLElement>(`.vl-it[data-id="${g.id}"]`);
        const box = bEl ? this.itemBox(bEl, b, g) : null;
        if (!bEl || !gEl || !box || !g.items?.length) return;
        const k = bEl.getBoundingClientRect().width / b.w, gr = gEl.getBoundingClientRect();
        const kids = g.items.map((c) => { const q = gEl.querySelector<HTMLElement>(`:scope > [data-id="${c.id}"]`)?.getBoundingClientRect(); return q ? { c, L: (q.left - gr.left) / k, T: (q.top - gr.top) / k, W: q.width / k, H: q.height / k } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
        if (!kids.length) return;
        const L = Math.min(...kids.map((x) => x.L)), T = Math.min(...kids.map((x) => x.T));
        const W = Math.max(...kids.map((x) => x.L + x.W)) - L, H = Math.max(...kids.map((x) => x.T + x.H)) - T;
        for (const x of kids) { x.c.g = "tl"; x.c.dx = Math.round(x.L - L); x.c.dy = Math.round(x.T - T); if (x.c.w === "fill") x.c.w = Math.round(x.W); if (x.c.h === "fill") x.c.h = Math.round(x.H); }
        const [ax, ay] = axes(g.g), nW = Math.max(1, Math.round(W)), nH = Math.max(1, Math.round(H));
        g.w = nW; g.h = nH; g.dx = toD(ax, box.L + L, nW, b.w); g.dy = toD(ay, box.T + T, nH, b.h);
    }
    // Ctrl+G: the chosen items (of one block) become one group, where they are; Ctrl+Shift+G: a group's items back in the block
    groupSel() {
        const p = this.page(); if (!p) return;
        let list = this.manyItems;
        if (!list.length) { const f = this.item(), b = this.block(); if (f && b && b.items.includes(f.item)) list = [{ b, it: f.item }]; }
        if (!list.length) return;
        const b = list[0].b;
        if (list.some((x) => x.b !== b)) { new Notice("Vellum: a group holds items of one block; choose items in one block"); return; }
        const bEl = this.wall.querySelector<HTMLElement>(`.vl-screen [data-block="${b.id}"]`); if (!bEl) return;
        const boxes = list.map((x) => ({ it: x.it, r: this.itemBox(bEl, b, x.it) })).filter((x): x is { it: Item; r: NonNullable<typeof x.r> } => !!x.r).sort((a, c) => b.items.indexOf(a.it) - b.items.indexOf(c.it));
        if (!boxes.length) return;
        const L = Math.min(...boxes.map((x) => x.r.L)), T = Math.min(...boxes.map((x) => x.r.T));
        const W = Math.max(...boxes.map((x) => x.r.L + x.r.W)) - L, H = Math.max(...boxes.map((x) => x.r.T + x.r.H)) - T;
        const g: Item = { id: uid(), type: "group", g: "tl", dx: Math.round(L), dy: Math.round(T), w: Math.max(1, Math.round(W)), h: Math.max(1, Math.round(H)), items: [] };
        this.edit(() => {
            b.items.splice(b.items.indexOf(boxes[boxes.length - 1].it) + 1, 0, g);   // where the topmost of them was
            for (const x of boxes) {
                const c = x.it; c.g = "tl"; c.dx = Math.round(x.r.L - L); c.dy = Math.round(x.r.T - T);
                if (c.w === "fill") c.w = Math.round(x.r.W); if (c.h === "fill") c.h = Math.round(x.r.H);
                b.items.splice(b.items.indexOf(c), 1); g.items!.push(c);
            }
            this.sel = { page: p.id, block: b.id, item: g.id };
        });
    }
    ungroup() {
        const f = this.item(), b = this.block(), p = this.page(), g = f?.item;
        if (!g || !b || !p || g.type !== "group" || !b.items.includes(g)) return;
        const bEl = this.wall.querySelector<HTMLElement>(`.vl-screen [data-block="${b.id}"]`); if (!bEl) return;
        const kids = (g.items ?? []).map((c) => ({ c, r: this.itemBox(bEl, b, c) }));
        this.edit(() => {
            for (const { c, r } of kids) {
                if (r) { c.g = "tl"; c.dx = Math.round(r.L); c.dy = Math.round(r.T); if (c.w === "fill") c.w = Math.round(r.W); if (c.h === "fill") c.h = Math.round(r.H); }
                if (g.op !== undefined) c.op = Math.round(((c.op ?? 100) * g.op) / 100);
            }
            b.items.splice(b.items.indexOf(g), 1, ...kids.map((x) => x.c));
        }, false);
        this.chooseItems(p, kids.map((x) => ({ block: b.id, item: x.c.id })));
    }

    typeInPlace(e: MouseEvent, p: Page) {
        const at = (this.root?.doc ?? activeDocument).elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const itEl = at?.closest<HTMLElement>(".vl-it"), bEl = at?.closest<HTMLElement>("[data-block]");
        const b = bEl ? this.blocks(p).find((x) => x.id === bEl.dataset.block) : undefined;
        const f = b && itEl?.dataset.id ? findItem(b.items, itEl.dataset.id) : null;
        if (!b || !f) return;
        this.choose({ page: p.id, block: b.id, item: f.item.id });
        if (f.item.type !== "text") return;
        if (Platform.isMobile) { this.writeItem(b, f.item.id); return; }
        const el = (this.wall ?? activeDocument).querySelector<HTMLElement>(`.vl-it[data-id="${f.item.id}"]`);
        if (!el) return;
        el.contentEditable = "true";
        el.addClass("is-typing");
        el.focus({ preventScroll: true });   // typing in place does not move the view
        el.doc.getSelection()?.selectAllChildren(el);
        el.addEventListener("keydown", (k) => { if (k.key === "Escape" || (k.key === "Enter" && !k.shiftKey)) { k.preventDefault(); el.blur(); } });
        el.addEventListener("blur", () => this.edit(() => { f.item.v = el.innerText.replace(/\n$/, ""); }), { once: true });
    }

    writeItem(b: Block, id: string) {
        const it = findItem(b.items, id)?.item;
        if (it?.type === "text") this.writer("Text", it.v ?? "", (v) => this.edit(() => { it.v = v; }));
    }

    // ---- keys (only when not typing in a field)
    key(e: KeyboardEvent) {
        if (this.handle(e)) { e.preventDefault(); e.stopPropagation(); }
    }
    handle(e: KeyboardEvent): boolean {
        const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
        const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
        if (mod && k === "s") { this.save(); return true; }
        if (mod && e.shiftKey && k === "c" && !typing) { this.copyReference(); return true; }
        if (typing) return false;
        if (mod && k === "z") { if (e.shiftKey) this.redo(); else this.undo(); return true; }
        if (mod && k === "y") { this.redo(); return true; }
        if (mod && k === "d") { this.duplicate(); return true; }
        if (!mod && !e.altKey && k === "n" && !this.v.show && !this.v.map) { this.marking = !this.marking; this.drawPages(); return true; }
        if (e.key === "Escape" && this.marking) { this.marking = false; this.drawPages(); return true; }
        if (e.key === "Escape" && this.sel?.mark) { this.choose({ page: this.sel.page }); return true; }
        if (mod && k === "g" && !this.v.show && !this.v.map) { if (e.shiftKey) this.ungroup(); else this.groupSel(); return true; }
        if (this.v.show && !this.v.map && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "PageUp" || e.key === "PageDown")) { this.showGo(e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 1); return true; }
        if (mod && e.key === "'") { this.ov.show = !this.ov.show; this.keepOv(); this.drawPages(); return true; }
        if (mod && k === "a" && !this.v.show && !this.v.map) { const p = this.current(); if (p) this.chooseMany(p, this.blocks(p).map((b) => b.id)); return true; }
        if (e.key === "Escape" && !this.sel) return true;   // never closes the editor: a stray Esc would lose your place
        if (e.key === "Escape" && (this.many.length || this.manyItems.length)) { this.choose({ page: this.sel!.page }); return true; }
        if (e.key === "Escape") {
            // one level up: an item in a group / row → that; an item → its block; a block → the page
            const s = this.sel, b = this.block(), up = s?.item && b ? parentOf(b.items, s.item) : null;
            this.choose(up ? { page: s!.page, block: s!.block, item: up.id } : s?.item ? { page: s.page, block: s.block } : s?.block ? { page: s.page } : null); return true;
        }
        if (e.key === "Delete" || e.key === "Backspace") { this.remove(); return true; }
        const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
        if (d && this.mark()) { const m = this.mark()!, st = e.shiftKey ? grid() : 1; this.edit(() => { m.x += d[0] * st; m.y += d[1] * st; }, false); return true; }
        if (d && (this.many.length || this.manyItems.length)) { this.nudge(d[0] * (e.shiftKey ? grid() : 1), d[1] * (e.shiftKey ? grid() : 1)); return true; }
        if (d && this.sel?.block) { this.nudge(d[0] * (e.shiftKey ? grid() : 1), d[1] * (e.shiftKey ? grid() : 1)); return true; }
        return false;
    }
    nudge(dx: number, dy: number) {
        const f = this.item(), b = this.block(), many = this.many, mi = this.manyItems;
        if (mi.length) { this.edit(() => { for (const { it } of mi) { const [ax, ay] = axes(it.g); if (it.w !== "fill") it.dx = (it.dx ?? 0) + (ax > 0 ? -dx : dx); if (it.h !== "fill") it.dy = (it.dy ?? 0) + (ay > 0 ? -dy : dy); } }, false); return; }
        if (many.length) { const p = this.page()!; this.edit(() => { for (const g of many) { const R = this.room(p, g), keep = !g.bleed && inRoom(g, R); g.x += dx; g.y += dy; if (keep) clampTo(g, R, false); } }, false); return; }
        this.edit(() => {
            if (f) { const [ax, ay] = axes(f.item.g); if (f.item.w !== "fill") f.item.dx = (f.item.dx ?? 0) + (ax > 0 ? -dx : dx); if (f.item.h !== "fill") f.item.dy = (f.item.dy ?? 0) + (ay > 0 ? -dy : dy); }
            else if (b) { const p = this.page()!, R = this.room(p, b), keep = !b.bleed && inRoom(b, R); b.x += dx; b.y += dy; if (keep) clampTo(b, R, false); }
        });
    }
    duplicate() {
        const f = this.item(), b = this.block(), p = this.page(), many = this.many, mi = this.manyItems, mk = this.mark();
        if (mk && p) { const c: Mark = { ...(JSON.parse(JSON.stringify(mk)) as Mark), id: uid(), x: mk.x + 16, y: mk.y + 16 }; delete c.by; this.edit(() => { p.marks!.push(c); this.sel = { page: p.id, mark: c.id }; }); return; }
        if (mi.length && p) {
            // each item again, next to itself in its block; the copies are chosen
            const out: { block: string; item: string }[] = [];
            this.edit(() => { for (const { b: ib, it } of mi) { const c = cloneItem(it); ib.items.splice(ib.items.indexOf(it) + 1, 0, c); out.push({ block: ib.id, item: c.id }); } }, false);
            this.chooseItems(p, out); return;
        }
        if (many.length && p) {
            // the group again, just under itself; the copies are chosen
            const down = Math.max(...many.map((g) => g.y + g.h)) - Math.min(...many.map((g) => g.y)) + 8, ids: string[] = [];
            this.edit(() => { for (const g of many) { const c: Block = { ...(JSON.parse(JSON.stringify(g)) as Block), id: uid(), y: g.y + down }; c.items = g.items.map(cloneItem); this.blocks(p).push(c); ids.push(c.id); } }, false);
            this.chooseMany(p, ids); return;
        }
        if (this.sel?.block && !b) return;   // a frame's block: locked here
        if (f) this.edit(() => { const c = cloneItem(f.item); f.list.splice(f.list.indexOf(f.item) + 1, 0, c); this.sel = { ...this.sel!, item: c.id }; });
        else if (b && p) this.edit(() => { const c: Block = { ...(JSON.parse(JSON.stringify(b)) as Block), id: uid(), y: b.y + b.h + 8 }; c.items = b.items.map(cloneItem); this.blocks(p).push(c); this.sel = { page: p.id, block: c.id }; });
        else if (p) this.edit(() => { const c: Page = { ...(JSON.parse(JSON.stringify(p)) as Page), id: uid(), name: p.name + " copy" }; this.doc.pages.splice(this.doc.pages.indexOf(p) + 1, 0, c); this.sel = { page: c.id }; });
    }
    remove() {
        const f = this.item(), b = this.block(), p = this.page(), many = this.many, mi = this.manyItems, mk = this.mark();
        if (mk && p) { this.edit(() => { p.marks = p.marks!.filter((m) => m !== mk); if (!p.marks.length) delete p.marks; this.sel = { page: p.id }; }); return; }
        if (mi.length && p) { this.edit(() => { for (const { b: ib, it } of mi) ib.items.splice(ib.items.indexOf(it), 1); this.sel = { page: p.id }; }); return; }
        if (many.length && p) { this.edit(() => { const l = this.blocks(p); for (const g of many) l.splice(l.indexOf(g), 1); this.sel = { page: p.id }; }); return; }
        if (f) this.edit(() => { f.list.splice(f.list.indexOf(f.item), 1); this.sel = { page: p!.id, block: b!.id }; });
        else if (b && p) this.edit(() => { const l = this.blocks(p); l.splice(l.indexOf(b), 1); this.sel = { page: p.id }; });
    }

    // ---- the panel: only what is chosen, as controls
    drawPanel() {
        this.closePicker();
        this.parentClose?.();
        this.keepTop = this.panel?.querySelector(".vl-pbody")?.scrollTop ?? 0;
        this.panel?.remove(); this.panel = null; this.getters.clear();
        this.drawBar();
        this.panelBody();
        if (Platform.isMobile && this.v.fit && this.pending === null) this.drawPages();   // (not mid-drag) the sheet's height changed the stage: the phone fits what is left
    }
    panelBody() {
        if (!this.side?.isConnected || this.v.show || (!this.sel && Platform.isMobile) || (!Platform.isMobile && this.v.panel === false) || this.v.map) return;
        const p = this.page() ?? this.current(); if (!p) return;
        const P = (this.panel = this.side.createDiv({ cls: "vl-panel" + (Platform.isMobile ? " is-sheet" : "") }));
        if (!Platform.isMobile) {
            const pw = Number(getLocal("vellum:panelW")) || 300;
            P.style.width = `${pw}px`;
            const g = P.createDiv({ cls: "vl-pgrip" });
            g.addEventListener("pointerdown", (e) => {
                e.preventDefault(); g.setPointerCapture(e.pointerId); g.addClass("is-on");
                const x0 = e.clientX, w0 = P.offsetWidth;
                const mv = (m: PointerEvent) => { P.style.width = `${Math.min(600, Math.max(240, w0 - (m.clientX - x0)))}px`; };
                const up = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeClass("is-on"); try { setLocal("vellum:panelW", String(P.offsetWidth)); } catch { /* */ } if (this.v.fit) this.drawPages(); };
                g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up);
            });
        }
        const b = this.block(), f = this.item(), inh = !b ? this.layer() : undefined;
        // breadcrumb: page › block › item, each a way back up
        const head = P.createDiv({ cls: "vl-crumb" });
        const crumb = (text: string, s: Sel, on: boolean) => { const c = head.createEl("button", { text, cls: on ? "is-on" : "" }); c.addEventListener("click", () => this.choose(s)); };
        const many = this.many, mi = this.manyItems;
        crumb(p.name, { page: p.id }, !b && !many.length && !mi.length && !this.sel?.mark);
        if (many.length) { head.createSpan({ text: "›" }); crumb(`${many.length} blocks`, this.sel, true); }
        if (mi.length) { head.createSpan({ text: "›" }); crumb(`${mi.length} items`, this.sel, true); }
        const mk0 = this.mark();
        if (mk0) { head.createSpan({ text: "›" }); crumb(mk0.text?.split("\n")[0].slice(0, 20) || ({ note: "Note", area: "Area", line: "Guide line" } as const)[mk0.kind], this.sel, true); }
        if (b) { head.createSpan({ text: "›" }); crumb(b.name, { page: p.id, block: b.id }, !f); }
        else if (inh) { head.createSpan({ text: "›" }); crumb(inh.block.name, { page: p.id, block: inh.block.id }, true); }
        if (f) { head.createSpan({ text: "›" }); crumb(label(f.item), this.sel, true); }
        // the header's actions (always in reach): copy for the agent, duplicate, delete, let go
        const acts = head.createDiv({ cls: "vl-hacts" });
        const refB: HTMLElement = this.btn(acts, "link", "Copy reference: one line that points at it (Ctrl+Shift+C)", () => this.copyReference(refB));
        const agB: HTMLElement = this.btn(acts, "clipboard-copy", "Copy for the agent: the reference, its JSON now, and a line for what to change", () => this.copyForAgent(agB));
        if (f || b || many.length || mi.length || this.sel?.mark) {   // what is chosen (several too), never the screen by mistake
            this.btn(acts, "copy", "Duplicate (Ctrl+D)", () => this.duplicate());
            this.btn(acts, "trash-2", "Delete (Delete)", () => this.remove());
        } else if (!inh) {
            this.btn(acts, "copy", "Duplicate the screen", () => this.duplicate());
            this.btn(acts, "trash-2", "Delete the screen", () => this.edit(() => { this.doc.pages.splice(this.doc.pages.indexOf(p), 1); this.sel = null; }));
        }
        if (this.sel) this.btn(acts, "x", "Let go (Esc)", () => this.choose(null)).addClass("vl-close");
        const body = P.createDiv({ cls: "vl-pbody" });
        const mk = this.mark();
        if (mk) this.markPanel(body, p, mk);
        else if (many.length) this.groupPanel(body, many);
        else if (mi.length) this.itemsPanel(body, mi);
        else if (f && b) this.itemPanel(body, b, f.item, b.items.includes(f.item));
        else if (b) this.blockPanel(body, p, b);
        else if (inh) this.framePanel(body, p, inh);
        else this.pagePanel(body, p);
        body.scrollTop = this.keepTop; this.keepTop = 0;
    }
    keepTop = 0;
    // what is chosen, written for a coding agent: where it lives (the folder, the file, the screen, the block, the item),
    // what it is now (its JSON), and a line for what to change. Pasted to the agent, no need to describe which thing it is
    // where the chosen thing is, in one line: the file, the block, the item (ids to search for)
    reference(): string {
        const p = this.page() ?? this.current(); if (!p) return "";
        const b = this.block() ?? this.layer()?.block, f = this.item();
        const file = this.store ? (this.store.files.get(p.id) ?? `${this.store.dir}/${p.name}.json`) : `${this.ctx?.sourcePath ?? "the note"} › ${p.name}`;
        const parts = [file + (this.land ? " (landscape)" : "")];
        if (b) parts.push(`${b.name} (${b.id})`);
        if (f) parts.push(`${f.item.type}${f.item.type === "text" ? ` "${(f.item.v ?? "").split("\n")[0].slice(0, 30)}"` : f.item.type === "icon" ? ` ${f.item.name ?? ""}` : ""} ${f.item.id}`);
        return parts.join(" › ");
    }
    copyReference(at?: HTMLElement) {
        const t = this.reference(); if (!t) return;
        (this.root?.win ?? window).navigator.clipboard.writeText(t).then(() => this.hint("Reference copied", at), () => this.writer("Copy this reference", t, () => { /* */ }));
    }
    copyForAgent(at?: HTMLElement) {
        const p = this.page() ?? this.current(); if (!p) return;
        const b = this.block() ?? this.layer()?.block, f = this.item();
        const file = this.store ? `${this.store.files.get(p.id) ?? `${this.store.dir}/${p.name}.json`}` : `${this.ctx?.sourcePath ?? "the note"} (a vellum block)`;
        const where = [`Vellum screen "${p.name}" (id ${p.id}) in ${file}`];
        if (this.land) where.push("its landscape layout (land)");
        if (b) where.push(`block "${b.name}" (id ${b.id}, kind ${b.kind}, x ${b.x} y ${b.y} w ${b.w} h ${b.h})`);
        if (f) where.push(`item ${f.item.type}${f.item.type === "text" ? ` "${(f.item.v ?? "").split("\n")[0].slice(0, 40)}"` : ""} (id ${f.item.id})`);
        const now = f ? f.item : b ?? { id: p.id, name: p.name, parent: p.parent, link: p.link, bg: p.bg, blocks: this.blocks(p).map((x) => `${x.name} (${x.id})`) };
        const text = `${where.join(" · ")}\n\nNow:\n${JSON.stringify(now, null, 1)}\n\nWhat I want changed:\n`;
        const done = () => this.hint("Copied for the agent", at);
        const nav = (this.root?.win ?? window).navigator;
        nav.clipboard.writeText(text).then(done, () => this.writer("Copy this for the agent", text, () => { /* */ }));
    }
    // while dragging: only the numbers change (the panel stays as it is)
    liveText = new Map<HTMLElement, () => string>();   // numbers shown as text (the gaps) kept live while dragging too
    livePanel() { for (const [el, g] of this.liveText) if (el.isConnected) el.setText(g()); else this.liveText.delete(el); this.panel?.querySelectorAll<HTMLInputElement>("input[data-live]").forEach((i) => { const g = this.getters.get(i); if (g && i.doc.activeElement !== i) i.value = String(g()); }); }
    getters = new Map<HTMLInputElement, () => number | string>();

    // controls
    // a section: its title and its body; fold: a click on the title folds it (kept on the device, by title)
    // a section: its title and its body. fold: a click on the title folds it (kept on the device, by title); shut: it
    // starts folded; hint: a summary in the title, shown while it is folded (what is in it)
    section(parent: HTMLElement, title: string, fold = false, o: { shut?: boolean; hint?: string } = {}) {
        const sc = parent.createDiv({ cls: "vl-sec" }), h = sc.createDiv({ cls: "vl-sech" });
        h.createSpan({ text: title });
        if (o.hint) h.createSpan({ cls: "vl-sechint", text: o.hint });
        const body = sc.createDiv({ cls: "vl-secb" });
        if (!fold) return body;
        const KEY = "vellum:secstate";
        let st: Record<string, boolean> = {};
        try { st = JSON.parse(getLocal(KEY) ?? "{}") as Record<string, boolean>; } catch { /* */ }
        if (!(title in st)) { try { if ((JSON.parse(getLocal("vellum:secfold") ?? "[]") as string[]).includes(title)) st[title] = true; } catch { /* */ } }
        h.addClass("is-fold"); setIcon(h.createSpan({ cls: "vl-secchev" }), "chevron-down");
        sc.toggleClass("is-folded", st[title] ?? !!o.shut);
        h.addEventListener("click", () => { const now = !sc.hasClass("is-folded"); sc.toggleClass("is-folded", now); st[title] = now; setLocal(KEY, JSON.stringify(st)); });
        return body;
    }
    // a choice as a segmented control: words (an icon too, or an icon alone with its words in the tooltip)
    seg(parent: HTMLElement, opts: [string, string, string?][], on: string | undefined, pick: (v: string) => void, iconsOnly = false) {
        const g = parent.createDiv({ cls: "vl-seg2" + (iconsOnly ? " is-icons" : "") });
        for (const [v, text, icon] of opts) {
            const c = g.createEl("button", { cls: v === on ? "is-on" : "", attr: { "aria-label": text } });
            if (icon) setIcon(c.createSpan({ cls: "vl-seg2i" }), icon);
            if (!iconsOnly) c.createSpan({ text });
            c.addEventListener("click", () => this.edit(() => pick(v)));
        }
        return g;
    }
    // a row: its label at the left, the control at the right
    frow(parent: HTMLElement, label: string) { const r = parent.createDiv({ cls: "vl-frow" }); r.createSpan({ cls: "vl-frowl", text: label }); return r.createDiv({ cls: "vl-frowc" }); }
    // a menu of choices (Obsidian's own dropdown)
    menu(parent: HTMLElement, opts: [string, string][], on: string, pick: (v: string) => void, label = "") {
        const m = parent.createEl("select", { cls: "dropdown vl-menu2", attr: { "aria-label": label } });
        for (const [v, t] of opts) m.createEl("option", { value: v, text: t });
        m.value = on;
        m.addEventListener("change", () => this.edit(() => pick(m.value)));
        return m;
    }
    // a number: type it, or drag its label sideways to scrub; live while it changes, one undo step for the whole change
    // a number box, as ZeLedger's amount tiles: the value is text. Hold the box (a mouse or a finger), then drag up or down
    // to change it, a bubble showing the value; a quick click or tap turns it into a field to type in (Enter keeps it, Esc
    // puts it back); with the box focused, ↑ ↓ step and Enter types
    num(parent: HTMLElement, name: string, get: () => number, set: (v: number) => void, o: { step?: number; min?: number; max?: number; unit?: string } = {}) {
        const w = parent.createDiv({ cls: "vl-num", attr: { tabindex: "0", role: "spinbutton", "aria-label": name } });
        w.createSpan({ cls: "vl-numl", text: name });
        const vr = w.createDiv({ cls: "vl-numv" });
        const vt = vr.createSpan({ cls: "vl-numt" });
        if (o.unit) vr.createSpan({ cls: "vl-numu", text: o.unit });
        const st = o.step ?? 1, fmt = (v: number) => String(+v.toFixed(4));
        const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
        const show = () => { vt.setText(fmt(get())); w.setAttr("aria-valuenow", String(get())); };
        show();
        this.liveText.set(vt, () => fmt(get()));   // a drag elsewhere (the phone, the diagram) updates it
        const apply = (v: number) => { set(+clamp(Math.round(v / st) * st).toFixed(6)); this.draftPut(); this.drawPages(); this.drawBar(); show(); this.livePanel(); };
        // typing: the value becomes a field
        const type = () => {
            if (w.querySelector("input")) return;
            const i = createEl("input", { cls: "vl-numin", attr: { type: "text", inputmode: "decimal", "aria-label": name } });
            i.value = fmt(get()); vt.replaceWith(i); w.addClass("is-typing");
            const v0 = get(); this.begin();
            i.focus(); i.select();
            let done = false;
            const fin = (keep: boolean) => {
                if (done) return; done = true;
                if (!keep) apply(v0);
                i.replaceWith(vt); w.removeClass("is-typing"); show(); this.end();
                this.liveText.set(vt, () => fmt(get()));
            };
            i.addEventListener("input", () => { const n = Number(i.value.replace(",", ".")); if (i.value.trim() !== "" && !Number.isNaN(n)) apply(n); });
            i.addEventListener("keydown", (k) => { k.stopPropagation(); if (k.key === "Enter") { k.preventDefault(); fin(true); w.focus(); } if (k.key === "Escape") { k.preventDefault(); fin(false); w.focus(); } });
            i.addEventListener("blur", () => fin(true));
        };
        w.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest(".vl-arrows")) type(); });
        w.addEventListener("keydown", (k) => {
            if (k.target !== w) return;
            if (k.key === "Enter") { k.preventDefault(); type(); }
            else if (k.key === "ArrowUp" || k.key === "ArrowDown") { k.preventDefault(); k.stopPropagation(); this.begin(); apply(get() + (k.key === "ArrowUp" ? 1 : -1) * st * editCfg.arrow * (k.shiftKey ? 10 : 1)); this.end(); }
        });
        this.numberExtras(w, null, name, get, set, { ...o, refresh: show, anyPointer: true, arrows: false });
        return w;
    }
    // a number box's extras: ▲▼ arrows (a press moves one arrow step, Shift ten of them, holding repeats) and hold-and-drag:
    // hold the box still, then drag up or down; a bubble shows the value and the change; letting go keeps it, a cancel
    // puts it back. host: the box; arrows: where the arrows go (false: none); set is live (one undo step per change)
    numberExtras(host: HTMLElement, input: HTMLInputElement | null, label: string, get: () => number, set: (v: number) => void, o: { step?: number; min?: number; max?: number; arrows?: HTMLElement | false; handle?: HTMLElement; refresh?: () => void; anyPointer?: boolean } = {}) {
        const st = o.step ?? 1, clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
        const put = (v: number) => { set(+clamp(Math.round(v / st) * st).toFixed(6)); if (input) input.value = String(get()); o.refresh?.(); this.draftPut(); this.drawPages(); this.drawBar(); this.livePanel(); };
        if (o.arrows !== false) {
            const box = (o.arrows ?? host).createDiv({ cls: "vl-arrows" });
            for (const [dir, icon, name] of [[1, "chevron-up", "More"], [-1, "chevron-down", "Less"]] as const) {
                const b = box.createEl("button", { cls: "vl-arrow", attr: { "aria-label": `${name} (Shift: ×10)`, tabindex: "-1" } });
                setIcon(b, icon);
                let wait = 0, rep = 0;
                const stop = () => { window.clearTimeout(wait); window.clearInterval(rep); wait = rep = 0; this.end(); };
                b.addEventListener("pointerdown", (e) => {
                    e.preventDefault(); e.stopPropagation(); this.begin();
                    const once = () => put(get() + dir * st * editCfg.arrow * (e.shiftKey ? 10 : 1));
                    once();
                    wait = window.setTimeout(() => { rep = window.setInterval(once, 70); }, 380);
                    try { b.setPointerCapture(e.pointerId); } catch { /* */ }
                });
                b.addEventListener("pointerup", stop); b.addEventListener("pointercancel", stop);
                b.addEventListener("click", (e) => e.preventDefault());
            }
        }
        // dragging a value. A computer: the label is a handle (no hold): drag up or right for more, Shift ten times as fast,
        // Alt finer. A finger: hold the box still (280 ms, as ZeLedger does it), then drag up or down. A step every 9 px,
        // faster after ten; a bubble shows the value and the change; letting go keeps it, a cancel puts it back
        let timer = 0, active = false, x0 = 0, y0 = 0, v0 = 0, id = -1, bub: HTMLElement | null = null, both = false, fine = 1;
        const notches = (dy: number) => { const u = Math.abs(dy) / 9; return Math.sign(dy) * Math.floor(u < 10 ? u : 10 + Math.pow(u - 10, 1.35)); };
        const fmt = (v: number) => String(+v.toFixed(4));
        // while dragging (as ZeLedger does): the value, its box and the bubble change at once; the phone follows a moment
        // later (one redraw for many steps, so the drag never lags); letting go saves and redraws for good
        let preview = 0;
        const light = (v: number) => {
            const n = +clamp(Math.round(v / st) * st).toFixed(6);
            if (n === get()) return false;
            set(n); if (input) input.value = String(n); o.refresh?.();
            if (!preview) preview = window.setTimeout(() => { preview = 0; this.drawPages(); }, 90);
            return true;
        };
        const paint = (tick = false) => {
            if (!bub) return;
            const v = get(), d = +(v - v0).toFixed(4), ve = bub.querySelector<HTMLElement>(".vl-bubble-v");
            ve?.setText(fmt(v));
            if (tick && ve) { ve.removeClass("is-tick"); void ve.offsetWidth; ve.addClass("is-tick"); }
            bub.querySelector(".vl-bubble-d")?.setText(d ? `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}` : "↕");
            bub.toggleClass("is-up", d > 0); bub.toggleClass("is-down", d < 0);
        };
        host.addEventListener("touchmove", (e) => { if (active) e.preventDefault(); }, { passive: false });
        host.addEventListener("contextmenu", (e) => { if (active || timer) e.preventDefault(); });
        const start = () => {
                timer = 0; active = true; input?.blur(); v0 = get(); this.begin();
                try { host.setPointerCapture(id); } catch { /* */ }
                host.addClass("is-scrub");
                const R = this.root; if (!R) return;
                bub = R.createDiv({ cls: "vl-bubble" });
                bub.createDiv({ cls: "vl-bubble-k", text: label });
                bub.createDiv({ cls: "vl-bubble-v" }); bub.createDiv({ cls: "vl-bubble-d" });
                const rr = R.getBoundingClientRect(), hr = host.getBoundingClientRect();
                bub.style.left = `${Math.min(rr.width - 80, Math.max(80, hr.left - rr.left + hr.width / 2))}px`;
                bub.style.top = `${Math.max(96, hr.top - rr.top - 10)}px`;
                paint();
        };
        if (o.handle) {
            const hd = o.handle;
            hd.addClass("vl-drag");
            hd.addEventListener("pointerdown", (e) => {
                if (e.button !== 0 || active) return;
                e.preventDefault(); e.stopPropagation();
                x0 = e.clientX; y0 = e.clientY; id = e.pointerId; both = true;
                try { hd.setPointerCapture(id); } catch { /* */ }
                start();
            });
            hd.addEventListener("pointermove", (e) => { if (e.pointerId === id && active) move(e); });
            hd.addEventListener("pointerup", (e) => { if (e.pointerId === id) finish(true); });
            hd.addEventListener("pointercancel", (e) => { if (e.pointerId === id) finish(false); });
        }
        host.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || active || !editCfg.hold || (e.pointerType === "mouse" && !o.anyPointer) || (e.target as HTMLElement).closest(".vl-arrows, .vl-drag, input")) return;
            x0 = e.clientX; y0 = e.clientY; id = e.pointerId; both = false;
            window.clearTimeout(timer);
            timer = window.setTimeout(start, 280);
        });
        const move = (e: PointerEvent) => {
            e.preventDefault();
            // up (or right, with a mouse); Shift: ten times the step; Alt: four times the distance for each step
            fine = e.shiftKey ? 10 : 1;
            const d = (both ? (y0 - e.clientY) + (e.clientX - x0) : y0 - e.clientY) / (e.altKey ? 4 : 1);
            if (light(v0 + notches(d) * st * editCfg.arrow * fine)) {
                paint(true);
                if (e.pointerType !== "mouse") try { navigator.vibrate?.(8); } catch { /* no haptics */ }
            }
        };
        host.addEventListener("pointermove", (e) => {
            if (e.pointerId !== id || both) return;
            if (!active) { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) { window.clearTimeout(timer); timer = 0; } return; }
            move(e);
        });
        const finish = (keep: boolean) => {
            window.clearTimeout(timer); timer = 0;
            if (!active) return;
            active = false; host.removeClass("is-scrub"); bub?.remove(); bub = null;
            window.clearTimeout(preview); preview = 0;
            put(keep ? get() : v0);   // saved and drawn for good (or put back)
            this.end();
            // the click that ends a drag does not also put the caret in the box
            const eat = (c: Event) => { c.preventDefault(); c.stopPropagation(); };
            host.addEventListener("click", eat, { capture: true, once: true });
            window.setTimeout(() => host.removeEventListener("click", eat, { capture: true }), 400);
        };
        host.addEventListener("pointerup", (e) => { if (e.pointerId === id && !both) finish(true); });
        host.addEventListener("pointercancel", (e) => { if (e.pointerId === id && !both) finish(false); });
    }
    // a choice of words or swatches: a tap is the answer
    // a choice: words, an icon (its words in the tooltip: [value, words, icon]), or a colour swatch alone (bare)
    chips<T extends string | number>(parent: HTMLElement, opts: [T, string, string?][], on: T | undefined, pick: (v: T) => void, swatch?: (v: T) => string, bare = false) {
        const g = parent.createDiv({ cls: "vl-chips" + (opts.some((o) => o[2]) ? " is-icons" : "") + (bare ? " is-swatches" : "") });
        for (const [v, text, icon] of opts) {
            const c = g.createEl("button", { cls: "vl-chip" + (v === on ? " is-on" : "") + (icon ? " is-icon" : "") + (bare ? " is-swatch" : ""), attr: { "aria-label": text } });
            if (swatch) { const s = c.createSpan({ cls: "vl-sw" }); s.style.background = swatch(v); }
            if (icon) { setIcon(c, icon); if (!c.querySelector("svg")) { c.setText(text); c.removeClass("is-icon"); } }
            else if (!bare) c.appendText(text);
            c.addEventListener("click", () => this.edit(() => pick(v)));
        }
        return g;
    }
    text(parent: HTMLElement, get: () => string, set: (v: string) => void, o: { area?: boolean; placeholder?: string; title?: string } = {}) {
        // on a phone: a tap opens the writing window in the middle of the screen (the keyboard does not cover it)
        if (Platform.isMobile) {
            const t = parent.createDiv({ cls: "vl-text vl-tap" + (get() ? "" : " is-empty"), text: get() || o.placeholder || "" });
            t.addEventListener("click", () => this.writer(o.title ?? o.placeholder ?? "Text", get(), (v) => this.edit(() => set(v)), !!o.area));
            return t;
        }
        const i = o.area ? parent.createEl("textarea", { cls: "vl-text", attr: { rows: "2", placeholder: o.placeholder ?? "" } }) : parent.createEl("input", { cls: "vl-text", attr: { type: "text", placeholder: o.placeholder ?? "" } });
        i.value = get();
        i.addEventListener("focus", () => this.begin());
        i.addEventListener("input", () => { set(i.value); this.draftPut(); this.drawPages(); this.drawBar(); });
        i.addEventListener("blur", () => this.end());
        return i;
    }
    // the writing window: centred in the part of the screen the keyboard leaves (visualViewport), Cancel / Done
    writer(title: string, value: string, done: (v: string) => void, multi = true) {
        activeDocument.querySelector(".vl-writer")?.remove();
        const dim = activeDocument.body.createDiv({ cls: "vl-writer" });
        const w = dim.createDiv({ cls: "vl-wbox" });
        const head = w.createDiv({ cls: "vl-whead" });
        const cancel = head.createEl("button", { text: "Cancel" });
        head.createSpan({ text: title });
        const ok = head.createEl("button", { text: "Done", cls: "mod-cta" });
        const box = w.createEl("textarea", { attr: { rows: multi ? "4" : "1", spellcheck: "false" } });
        box.value = value;
        const vv = window.visualViewport;
        const place = () => { const top = vv ? vv.offsetTop + vv.height / 2 : window.innerHeight / 2; w.style.top = `${top}px`; };
        place();
        vv?.addEventListener("resize", place); vv?.addEventListener("scroll", place);
        const close = () => { vv?.removeEventListener("resize", place); vv?.removeEventListener("scroll", place); dim.remove(); };
        for (const ev of ["pointerdown", "mousedown", "click", "touchstart"]) dim.addEventListener(ev, (e) => e.stopPropagation());
        dim.addEventListener("click", (e) => { if (e.target === dim) close(); });
        cancel.addEventListener("click", close);
        ok.addEventListener("click", () => { const v = multi ? box.value : box.value.replace(/\n/g, " "); close(); if (v !== value) done(v); });
        box.addEventListener("keydown", (k) => { if (k.key === "Enter" && (!multi || k.metaKey || k.ctrlKey)) { k.preventDefault(); ok.click(); } if (k.key === "Escape") close(); });
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
    }
    // a colour: a bar showing it (its swatch, its name or value; a tap opens the picker) and a palette row under it (the
    // theme's colours, then the recent ones): one tap picks
    colors(parent: HTMLElement, on: string | undefined, pick: (v: string) => void, none = false) {
        const names = Object.keys(this.theme.colors);
        const bar = parent.createEl("button", { cls: "vl-cbar", attr: { "aria-label": "Colour: open the picker" } });
        const sw = bar.createSpan({ cls: "vl-cbar-sw" }), tx = bar.createSpan({ cls: "vl-cbar-tx" });
        setIcon(bar.createSpan({ cls: "vl-cbar-ch" }), "chevron-down");
        const tiles: HTMLElement[] = [];
        const show = (v?: string) => {
            const empty = !v || v === "none";
            tiles.forEach((x) => x.toggleClass("is-on", x.getAttr("data-v") === (empty ? "none" : v)));
            sw.style.setProperty("--c", empty ? "transparent" : colorOf(this.theme, v));
            sw.toggleClass("is-none", empty); tx.setText(empty ? "None" : v);
            tx.toggleClass("is-name", !empty && names.includes(v));
        };
        show(on);
        bar.addEventListener("click", () => { if (this.picker?.anchor === bar) this.closePicker(); else this.openPicker(bar, on, pick, show, none); });
        // the palette: the theme's colours as named tiles, then the last few custom ones as tiles named by their hex
        const opts: string[] = [...(none ? ["none"] : []), ...names];
        const g = parent.createDiv({ cls: "vl-tiles2" });
        const cur = on ?? (none ? "none" : undefined);
        for (const v of opts) {
            const t = g.createEl("button", { cls: "vl-ctile" + (v === cur ? " is-on" : ""), attr: { "aria-label": v === "none" ? "No colour" : `${v}: ${this.theme.colors[v]}`, "data-v": v } });
            tiles.push(t);
            const sw = t.createSpan({ cls: "vl-ctsw" + (v === "none" ? " is-none" : "") });
            if (v !== "none") sw.style.background = colorOf(this.theme, v);
            t.createSpan({ cls: "vl-ctn", text: v });
            t.addEventListener("click", () => this.edit(() => pick(v)));
        }
        const recent = this.recentColors().filter((c) => !names.includes(c)).slice(0, 4);
        if (recent.length) {
            parent.createDiv({ cls: "vl-recentl", text: "Recent" });
            const rr = parent.createDiv({ cls: "vl-tiles2 is-recent" });
            for (const c of recent) {
                const t = rr.createEl("button", { cls: "vl-ctile" + (c === on ? " is-on" : ""), attr: { "aria-label": c, "data-v": c } });
                tiles.push(t);
                t.createSpan({ cls: "vl-ctsw is-check" }).style.setProperty("--c", c);
                t.createSpan({ cls: "vl-ctn is-hex", text: /^#[0-9a-f]{6,8}$/i.test(c) ? c.slice(1).toUpperCase() : c });
                t.addEventListener("click", () => { this.edit(() => pick(c)); this.keepColor(c); });
            }
        }
    }
    // recent custom colours, newest first (kept on the device for this vault)
    recentColors(): string[] { try { return JSON.parse(getLocal("vellum:recentColors") ?? "[]") as string[]; } catch { return []; } }
    keepColor(c: string) { if (!c || c === "none" || c in this.theme.colors) return; setLocal("vellum:recentColors", JSON.stringify([c, ...this.recentColors().filter((x) => x !== c)].slice(0, 8))); }
    colorMode: "hex" | "rgb" | "hsl" = (getLocal("vellum:colorMode") as "hex" | "rgb" | "hsl") || "hex";
    // the picker: a panel floating by its bar. The colour square (saturation across, brightness down), the hue and opacity
    // bars, then the exact value (hex or any CSS colour, or RGB / HSL numbers), then recent colours.
    // Each drag or typed change is one undo step; a tap anywhere else, or Esc, closes it
    picker: { el: HTMLElement; anchor: HTMLElement; off: () => void } | null = null;
    closePicker() { const p = this.picker; if (!p) return; this.picker = null; p.off(); p.el.remove(); }
    openPicker(anchor: HTMLElement, on: string | undefined, pick: (v: string) => void, show: (v?: string) => void, none: boolean) {
        this.closePicker();
        const R = this.root; if (!R) return;
        const c = this.rgbaOf(on), hsv = rgbToHsv(c.r, c.g, c.b);
        const el = R.createDiv({ cls: "vl-cpop" });
        // the colour square, the hue bar, the opacity bar
        const sq = el.createDiv({ cls: "vl-csq" }), sqk = sq.createDiv({ cls: "vl-cknob" });
        const hue = el.createDiv({ cls: "vl-cstrip is-hue" }), huek = hue.createDiv({ cls: "vl-cknob" });
        const al = el.createDiv({ cls: "vl-cstrip is-alpha" }), alk = al.createDiv({ cls: "vl-cknob" });
        // the exact value
        const vals = el.createDiv({ cls: "vl-cvals" });
        const fields = vals.createDiv({ cls: "vl-cfields" });
        const modes = el.createDiv({ cls: "vl-cmodes" });
        // recent colours, and none where it is allowed
        const foot = el.createDiv({ cls: "vl-cfoot" });
        const paint = () => {
            const hueC = `hsl(${hsv.h}, 100%, 50%)`, solid = `rgb(${c.r}, ${c.g}, ${c.b})`;
            sq.style.setProperty("--hue", hueC);
            sqk.style.left = `${hsv.s}%`; sqk.style.top = `${100 - hsv.v}%`; sqk.style.setProperty("--c", solid);
            huek.style.left = `${(hsv.h / 360) * 100}%`; huek.style.setProperty("--c", hueC);
            al.style.setProperty("--c", solid); alk.style.left = `${c.a * 100}%`; alk.style.setProperty("--c", hexOf(c));
            for (const f of refresh) f();
        };
        const refresh: (() => void)[] = [];
        // a change from the square, the bars or the numbers: the item takes the hex, live
        const set = () => { const h = hexOf(c); pick(h); show(h); this.draftPut(); this.drawPages(); this.drawBar(); paint(); };
        const fromHsv = () => { const r = hsvToRgb(hsv.h, hsv.s, hsv.v); c.r = r.r; c.g = r.g; c.b = r.b; };
        const drag = (area: HTMLElement, at: (x: number, y: number) => void) => {
            area.addEventListener("pointerdown", (e) => {
                e.preventDefault(); this.begin(); area.setPointerCapture(e.pointerId);
                const go = (m: PointerEvent) => { const r = area.getBoundingClientRect(); at(Math.min(1, Math.max(0, (m.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (m.clientY - r.top) / r.height))); set(); };
                go(e);
                const up = () => { area.removeEventListener("pointermove", go); area.removeEventListener("pointerup", up); area.removeEventListener("pointercancel", up); this.end(); this.keepColor(hexOf(c)); };
                area.addEventListener("pointermove", go); area.addEventListener("pointerup", up); area.addEventListener("pointercancel", up);
            });
        };
        drag(sq, (x, y) => { hsv.s = Math.round(x * 100); hsv.v = Math.round((1 - y) * 100); fromHsv(); });
        drag(hue, (x) => { hsv.h = Math.round(x * 360); fromHsv(); });
        drag(al, (x) => { c.a = Math.round(x * 100) / 100; });
        // the exact value: hex (any CSS colour typed is taken as it is: a name, var(--…), rgb()), or numbers
        const drawFields = () => {
            fields.empty(); refresh.length = 0;
            if (this.colorMode === "hex") {
                const t = fields.createEl("input", { cls: "vl-chex", attr: { type: "text", spellcheck: "false", "aria-label": "Hex or any CSS colour" } });
                t.value = on && !(on in this.theme.colors) && on !== "none" && !/^#/.test(on) ? on : hexOf(c);
                refresh.push(() => { if (t.ownerDocument.activeElement !== t) t.value = hexOf(c); });
                t.addEventListener("keydown", (k) => { if (k.key === "Enter") t.blur(); });
                t.addEventListener("change", () => {
                    const v = t.value.trim(); if (!v) return;
                    if (!CSS.supports("color", v)) { t.addClass("is-bad"); return; }
                    t.removeClass("is-bad");
                    Object.assign(c, this.rgbaOf(v)); Object.assign(hsv, rgbToHsv(c.r, c.g, c.b));
                    this.begin(); pick(v); show(v); this.draftPut(); this.drawPages(); this.end(); this.keepColor(v); paint(); t.value = v;
                });
                return;
            }
            const box = (name: string, max: number, get: () => number, put: (v: number) => void) => {
                const w = fields.createDiv({ cls: "vl-num vl-cnum" });
                w.createSpan({ cls: "vl-numl", text: name });
                const i = w.createEl("input", { attr: { type: "number", min: "0", max: String(max), step: "1", "aria-label": name } });
                const val = (v: number) => { put(Math.min(max, Math.max(0, Math.round(v)))); set(); };
                i.addEventListener("focus", () => this.begin());
                i.addEventListener("input", () => { if (i.value !== "" && !Number.isNaN(Number(i.value))) val(Number(i.value)); });
                i.addEventListener("blur", () => { this.end(); this.keepColor(hexOf(c)); });
                i.addEventListener("keydown", (k) => { if (k.key === "Enter") i.blur(); });
                this.numberExtras(w, i, name, get, val, { min: 0, max, arrows: false, handle: w.querySelector<HTMLElement>(".vl-numl") ?? undefined });
                refresh.push(() => { if (i.ownerDocument.activeElement !== i) i.value = String(Math.round(get())); });
            };
            if (this.colorMode === "rgb") {
                box("Red", 255, () => c.r, (v) => { c.r = v; Object.assign(hsv, rgbToHsv(c.r, c.g, c.b)); });
                box("Green", 255, () => c.g, (v) => { c.g = v; Object.assign(hsv, rgbToHsv(c.r, c.g, c.b)); });
                box("Blue", 255, () => c.b, (v) => { c.b = v; Object.assign(hsv, rgbToHsv(c.r, c.g, c.b)); });
            } else {
                const hl = () => rgbToHsl(c.r, c.g, c.b);
                const fromHsl = (h: number, s: number, l: number) => { Object.assign(c, hslToRgb(h, s, l)); Object.assign(hsv, rgbToHsv(c.r, c.g, c.b)); hsv.h = h; };
                box("Hue", 360, () => hsv.h, (v) => { const x = hl(); fromHsl(v, x.s, x.l); });
                box("Sat", 100, () => hl().s, (v) => { fromHsl(hsv.h, v, hl().l); });
                box("Light", 100, () => hl().l, (v) => { fromHsl(hsv.h, hl().s, v); });
            }
            box("Opacity", 100, () => Math.round(c.a * 100), (v) => { c.a = v / 100; });
        };
        for (const [m, label] of [["hex", "HEX"], ["rgb", "RGB"], ["hsl", "HSL"]] as const) {
            const b = modes.createEl("button", { cls: "vl-cmode" + (this.colorMode === m ? " is-on" : ""), text: label });
            b.addEventListener("click", () => { this.colorMode = m; setLocal("vellum:colorMode", m); modes.querySelectorAll(".vl-cmode").forEach((x) => x.toggleClass("is-on", x === b)); drawFields(); paint(); });
        }
        drawFields();
        // the theme's colours by name (a tap keeps the name, so the colour follows the theme)
        const names2 = Object.keys(this.theme.colors), tl = el.createDiv({ cls: "vl-tiles2 is-pop" });
        el.insertBefore(tl, foot);
        for (const v of names2) {
            const t = tl.createEl("button", { cls: "vl-ctile" + (v === on ? " is-on" : ""), attr: { "aria-label": v } });
            t.createSpan({ cls: "vl-ctsw" }).style.background = colorOf(this.theme, v);
            t.createSpan({ cls: "vl-ctn", text: v });
            t.addEventListener("click", () => { this.edit(() => pick(v)); this.closePicker(); });
        }
        const recent = this.recentColors();
        if (none) { const n = foot.createEl("button", { cls: "vl-cdot is-none", attr: { "aria-label": "None" } }); n.addEventListener("click", () => { this.edit(() => pick("none")); this.closePicker(); }); }
        for (const h of recent) {
            const d = foot.createEl("button", { cls: "vl-cdot", attr: { "aria-label": h } }); d.style.setProperty("--c", h);
            d.addEventListener("click", () => { Object.assign(c, this.rgbaOf(h)); Object.assign(hsv, rgbToHsv(c.r, c.g, c.b)); this.begin(); set(); this.end(); this.keepColor(h); });
        }
        if (!recent.length && !none) foot.remove();
        paint();
        // by the bar: under it, or above when there is no room; inside the editor
        const rr = R.getBoundingClientRect(), ar = anchor.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight;
        el.style.left = `${Math.max(8, Math.min(rr.width - pw - 8, ar.left - rr.left))}px`;
        el.style.top = `${ar.bottom - rr.top + 6 + ph > rr.height - 8 ? Math.max(8, ar.top - rr.top - 6 - ph) : ar.bottom - rr.top + 6}px`;
        // a tap anywhere else, or Esc, closes it
        const doc = R.doc;
        const outside = (e: Event) => { const t = e.target as Node; if (!el.contains(t) && !anchor.contains(t)) this.closePicker(); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); this.closePicker(); } };
        window.setTimeout(() => doc.addEventListener("pointerdown", outside, true));
        doc.addEventListener("keydown", esc, true);
        this.picker = { el, anchor, off: () => { doc.removeEventListener("pointerdown", outside, true); doc.removeEventListener("keydown", esc, true); } };
    }
    // any colour (a theme name, CSS) as red, green, blue (0–255) and opacity (0–1), as the browser draws it
    rgbaOf(v?: string): { r: number; g: number; b: number; a: number } {
        const host = this.panel ?? this.root ?? activeDocument.body, el = host.createDiv();
        el.style.color = !v || v === "none" ? "rgb(128, 128, 128)" : colorOf(this.theme, v);
        const m = (getComputedStyle(el).color.match(/[\d.]+/g) ?? []).map(Number);
        el.remove();
        return { r: m[0] ?? 128, g: m[1] ?? 128, b: m[2] ?? 128, a: m.length > 3 ? m[3] : 1 };
    }
    actions(parent: HTMLElement, list: [string, string, () => void][]) {
        const g = parent.createDiv({ cls: "vl-acts" });
        for (const [icon, text, act] of list) { const x = g.createEl("button", { cls: "vl-act" }); setIcon(x.createSpan(), icon); x.appendText(text); x.addEventListener("click", act); }
    }

    // "Opened from": the field shows where the screen sits; its list is the screens rail's tree, with a search. Screens that
    // can't be chosen (this one, those under it: a loop) stay in the list and say why
    parentClose: (() => void) | null = null;
    howKept = new Map<string, string>();   // a main screen has no How: the text comes back if it gets a parent again (this session, not saved)
    chainOf(id?: string) {
        const out: Page[] = [], seen = new Set<string>();
        for (let c = this.doc.pages.find((q) => q.id === id); c && !seen.has(c.id); c = this.doc.pages.find((q) => q.id === c?.parent)) { seen.add(c.id); out.unshift(c); }
        return out;
    }
    parentField(parent: HTMLElement, p: Page) {
        const chain = this.chainOf(p.parent), names = chain.map((c) => c.name);
        const f = parent.createEl("button", { cls: "vl-ppf", attr: { "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `Opened from: ${names.join(" › ") || "Main screen"}` } });
        f.createSpan({ cls: "vl-ppft", text: names.length ? (names.length > 2 ? "… › " : "") + names.slice(-2).join(" › ") : "Main screen" });
        setIcon(f.createSpan({ cls: "vl-chev" }), "chevron-down");
        f.addEventListener("click", () => { if (this.parentClose) this.parentClose(); else this.parentOpen(f, p); });
    }
    parentPick(p: Page, v: string) {
        let reset = false;
        this.edit(() => {
            if (v) {
                const kept = !p.parent ? this.howKept.get(p.id) : undefined;
                if (kept && !p.link) p.link = kept;
                this.howKept.delete(p.id);
                // the frame was the old parent's: a new parent's would change the screen without saying so
                if (p.inherit) { delete p.inherit; reset = true; }
                p.parent = v;
            } else {
                if (p.link) this.howKept.set(p.id, p.link);
                delete p.parent; delete p.link; delete p.inherit;
            }
        });
        const f = this.panel?.querySelector<HTMLElement>(".vl-ppf");
        f?.focus();
        if (reset) this.hint("Layout set back to Its own", f ?? undefined, false);
    }
    parentOpen(field: HTMLElement, p: Page) {
        const R = this.root; if (!R?.isConnected) return;
        const pages = this.doc.pages, under = subtreeOf(pages, p.id), now = this.chainOf(p.parent).pop()?.id ?? "";
        // the rail's order: main screens, each followed by the screens under it (anything left, a loop, as a main screen)
        const tree: { q: Page; depth: number }[] = [], seen = new Set<string>();
        const walk = (q: Page, depth: number) => { if (seen.has(q.id)) return; seen.add(q.id); tree.push({ q, depth }); for (const c of childrenOf(pages, q.id)) walk(c, depth + 1); };
        for (const q of childrenOf(pages)) walk(q, 0);
        for (const q of pages) walk(q, 0);

        const pop = R.createDiv({ cls: "vl-pp" + (Platform.isMobile ? " is-phone" : "") });
        const find = pop.createDiv({ cls: "vl-ppfind" });
        setIcon(find.createSpan({ cls: "vl-ppfi" }), "search");
        const input = find.createEl("input", { attr: { type: "text", placeholder: "Find a screen", "aria-label": "Find a screen", autocomplete: "off", spellcheck: "false" } });
        const opts = pop.createDiv({ attr: { role: "listbox", "aria-label": "Opened from" } });
        const top = opts.createDiv(), sep = opts.createDiv({ cls: "vl-ppsep" }), list = opts.createDiv({ cls: "vl-pplist" });

        // the place: under the field, or over it if there's more room there; the right edges line up
        const rr = R.getBoundingClientRect(), fr = field.getBoundingClientRect(), W = Math.min(290, rr.width - 16);
        pop.style.width = `${W}px`;
        pop.style.left = `${Math.max(8, Math.min(rr.width - W - 8, fr.right - rr.left - W))}px`;
        const below = rr.bottom - fr.bottom - 12, above = fr.top - rr.top - 12, down = below >= 300 || below >= above;
        if (down) pop.style.top = `${fr.bottom - rr.top + 4}px`; else pop.style.bottom = `${rr.bottom - fr.top + 4}px`;
        list.style.maxHeight = `${Math.max(120, Math.min(340, (down ? below : above) - 90))}px`;

        type Opt = { id: string; el: HTMLElement; page?: Page };
        let live: Opt[] = [], at = -1, shown: Page | undefined;
        const look = (q: Page | undefined, el: HTMLElement) => { if (Platform.isMobile || q === shown) return; shown = q; if (q) this.peek(q, el, pop); else this.unpeek(); };
        const unlook = () => { shown = undefined; this.unpeek(); };
        const show = (i: number, scroll: boolean, peek: boolean) => {
            live[at]?.el.removeClass("is-active");
            at = i;
            const o = live[i]; if (!o) return;
            o.el.addClass("is-active");
            if (scroll && list.contains(o.el)) {
                const y = o.el.offsetTop, h = o.el.offsetHeight;
                if (y < list.scrollTop || y + h > list.scrollTop + list.clientHeight) list.scrollTop = y - (list.clientHeight - h) / 2;
            }
            if (peek) look(o.page, o.el);
        };
        const addRow = (to: HTMLElement, id: string, name: string, o: { depth?: number; page?: Page; why?: string; text?: string } = {}) => {
            const el = to.createDiv({ cls: "vl-ppr" + (id === now ? " is-on" : "") + (o.page?.mock ? " is-mock" : "") + (o.why ? " is-off" : ""), attr: { role: "option", "aria-selected": String(id === now) } });
            if (o.why) el.setAttr("aria-disabled", "true");
            if (o.depth) { const ind = el.createDiv({ cls: "vl-pind" }); for (let i = 0; i < o.depth; i++) ind.createSpan({ cls: "vl-pguide" }); }
            const n = el.createSpan({ cls: "vl-ppn" }), m = o.text ? name.toLowerCase().indexOf(o.text) : -1;
            if (m >= 0) { n.appendText(name.slice(0, m)); n.createSpan({ cls: "vl-ppm", text: name.slice(m, m + o.text!.length) }); n.appendText(name.slice(m + o.text!.length)); }
            else n.setText(name);
            if (o.page?.mock) n.appendText(" · mock");
            if (o.text && m < 0) el.addClass("is-ctx");
            if (o.why) el.createSpan({ cls: "vl-pptag", text: o.why });
            else if (id === now) setIcon(el.createSpan({ cls: "vl-ppc" }), "check");
            const opt: Opt = { id, el, page: o.page };
            if (!o.why) { live.push(opt); el.addEventListener("click", () => { close(); if (id !== now) this.parentPick(p, id); else field.focus(); }); }
            if (o.page && Platform.isMobile) this.peekOn(el, o.page);
            // on the move, not on enter: a list scrolled by the arrow keys must not take the row from under them
            if (!Platform.isMobile) el.addEventListener("mousemove", () => {
                const i = live.indexOf(opt);
                if (i >= 0 && i !== at) show(i, false, false);
                look(o.page, el);
            });
        };
        const fill = () => {
            const text = input.value.trim().toLowerCase();
            top.empty(); list.empty(); live = []; at = -1;
            unlook();
            sep.toggle(!text);
            if (!text) addRow(top, "", "Main screen");
            const keep = new Set<string>();
            if (text) for (const { q } of tree) if (q.name.toLowerCase().includes(text)) for (const c of this.chainOf(q.id)) keep.add(c.id);
            for (const { q, depth } of tree) {
                if (text && !keep.has(q.id)) continue;
                addRow(list, q.id, q.name, { depth, page: q, text, why: q.id === p.id ? "this screen" : under.has(q.id) ? "under this screen" : "" });
            }
            if (text && !keep.size) list.createDiv({ cls: "vl-ppnone", text: `No screen has "${input.value.trim()}" in its name` });
            show(text ? Math.max(0, live.findIndex((o) => o.page?.name.toLowerCase().includes(text))) : live.findIndex((o) => o.id === now), true, false);
        };
        input.addEventListener("input", fill);
        input.addEventListener("keydown", (k) => {
            if (k.isComposing) return;   // the Enter that ends typing in Chinese or Japanese isn't a choice
            k.stopPropagation();
            if (k.key === "ArrowDown" || k.key === "ArrowUp") { k.preventDefault(); if (live.length) show((at + (k.key === "ArrowDown" ? 1 : -1) + live.length) % live.length, true, true); }
            else if (k.key === "Enter") { k.preventDefault(); live[at]?.el.click(); }
            else if (k.key === "Escape") { k.preventDefault(); close(); field.focus(); }
        });
        pop.addEventListener("mouseleave", unlook);

        const scroller = field.closest(".vl-pbody"), off = (e: Event) => { if (!pop.isConnected) close(); else if (!pop.contains(e.target as Node) && !field.contains(e.target as Node)) close(); };
        const close = () => {
            if (this.parentClose === close) this.parentClose = null;
            pop.remove(); this.unpeek(); field.setAttr("aria-expanded", "false");
            R.doc.removeEventListener("pointerdown", off, true); R.win.removeEventListener("resize", close); scroller?.removeEventListener("scroll", close);
        };
        this.parentClose = close;
        field.setAttr("aria-expanded", "true");
        R.doc.addEventListener("pointerdown", off, true); R.win.addEventListener("resize", close); scroller?.addEventListener("scroll", close, { passive: true });
        fill();
        if (!Platform.isMobile) input.focus();   // (a phone: the keyboard only if asked for, the list needs the room)
    }

    pagePanel(body: HTMLElement, p: Page) {
        // the marks on this screen: notes, areas, guide lines (for you and the agent; never part of the design)
        const ms = this.section(body, "Marks", true), list = this.marksOf(p);
        for (const m of list) {
            const row = ms.createEl("button", { cls: "vl-markrow" });
            row.createSpan({ cls: "vl-ovsw" }).style.background = markColor(m.color);
            row.createSpan({ text: (m.by ? `${m.by}: ` : "") + (m.text?.split("\n")[0] || ({ note: "Note", area: "Area", line: "Guide line" } as const)[m.kind]) });
            row.addEventListener("click", () => this.choose({ page: p.id, mark: m.id }));
        }
        const { W, H } = this.screen(p);
        this.actions(ms, [
            ["message-square-plus", "Note", () => this.addMark(p, { kind: "note", x: Math.round(W / 2), y: Math.round(H / 3), text: "" })],
            ["square-dashed", "Area", () => this.addMark(p, { kind: "area", x: Math.round(W / 4), y: Math.round(H / 4), w: Math.round(W / 2), h: Math.round(W / 2), text: "" })],
            ["move-horizontal", "Line across", () => this.addMark(p, { kind: "line", axis: "y", x: 0, y: Math.round(H / 2), text: "" })],
            ["move-vertical", "Line down", () => this.addMark(p, { kind: "line", axis: "x", x: Math.round(W / 2), y: 0, text: "" })],
        ]);
        const s = this.section(body, "Screen");
        this.text(this.frow(s, "Name"), () => p.name, (v) => { p.name = v; }, { title: "Screen name" });
        this.seg(this.frow(s, "Status"), [["real", "Real", "badge-check"], ["mock", "Mock", "lightbulb"]], p.mock ? "mock" : "real", (v) => { if (v === "mock") p.mock = true; else delete p.mock; });
        this.parentField(this.frow(s, "Opened from"), p);
        if (p.parent) this.text(this.frow(s, "How"), () => p.link ?? "", (v) => { if (v.trim()) p.link = v; else delete p.link; }, { placeholder: "tap a row, + button…", title: "How you get there" });
        // a frame: the parent's blocks drawn under this screen's own (a layout template)
        const par = p.parent ? this.page(p.parent) : undefined;   // (no parent: page() would answer with the chosen page)
        if (par) this.seg(this.frow(s, "Layout"), [["own", "Its own"], ["frame", `On ${par.name}'s frame`]], p.inherit ? "frame" : "own", (v) => { if (v === "frame") p.inherit = true; else delete p.inherit; });
        // with a frame: its colour unless the screen sets its own
        const fr = frameOf(this.doc.pages, p), was = (fr && bgOf(this.doc.pages, fr)) || "paper";
        this.colors(this.section(body, "Background"), p.bg ?? was, (v) => { if (v === was) delete p.bg; else p.bg = v; });
        const a = this.section(body, "Add a block");
        const g = a.createDiv({ cls: "vl-addgrid" });
        for (const k of this.kinds) {
            const c = g.createEl("button", { cls: "vl-addt", attr: { "aria-label": `Add a ${k.name} block` } });
            c.style.setProperty("--k", k.color);
            setIcon(c.createSpan({ cls: "vl-addi" }), k.icon ?? "square"); c.createSpan({ text: k.name.split(" / ")[0] });
            c.addEventListener("click", () => this.edit(() => {
                const { W, safe } = this.screen(p);
                const low = drawnBlocks(this.doc.pages, p, this.land).reduce((m, x) => Math.max(m, x.y + x.h), safe.top);
                const nb: Block = { id: uid(), name: k.name.split(" / ")[0], kind: k.id, x: 16 + safe.left, y: low + 8, w: W - 32 - safe.left - safe.right, h: 80, items: [] };
                this.blocks(p, true).push(nb); this.sel = { page: p.id, block: nb.id };
            }));
        }
        if (this.land && p.land) this.actions(a, [["trash", "Remove the landscape layout", () => this.edit(() => { delete p.land; this.sel = { page: p.id }; })]]);
        else if (this.land && p.blocks.length) this.actions(a, [["rectangle-horizontal", "Make landscape from portrait", () => this.makeLand(p)]]);
        // the safe areas: the device's, or set for this doc (every screen, this orientation)
        const cur = this.screen(p).safe;
        const sa = this.section(body, "Safe areas", true, { shut: true, hint: `${cur.top} · ${cur.bottom} · ${cur.left} · ${cur.right}` });
        sa.createDiv({ cls: "vl-frameinfo", text: `Every screen, ${this.land ? "landscape" : "portrait"}.` });
        const own = screenOf(deviceOf(p.device ?? this.doc.device), this.land).safe, key = this.land ? "safeLand" : "safe";
        const nums = sa.createDiv({ cls: "vl-nums" });
        // hovering the section lights the safe areas on the phone; a side's number, that side
        const lit = (side?: string) => { const w = this.wall; if (!w) return; if (side === undefined) delete w.dataset.safe; else w.dataset.safe = side; };
        const sec = sa.parentElement!;
        sec.addEventListener("mouseenter", () => lit("all")); sec.addEventListener("mouseleave", () => lit());
        for (const [k, name] of [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]] as const) {
            const nw = this.num(nums, name, () => this.screen(p).safe[k], (v) => {
                const o = { ...this.doc[key] };
                if (v === own[k]) delete o[k]; else o[k] = v;
                if (Object.keys(o).length) this.doc[key] = o; else delete this.doc[key];
            }, { min: 0, max: 400, unit: "pt" });
            nw.addEventListener("mouseenter", () => lit(k)); nw.addEventListener("mouseleave", () => lit("all"));
        }
        if (this.doc[key]) this.actions(sa, [["rotate-ccw", `The device's own (${own.top} · ${own.bottom} · ${own.left} · ${own.right})`, () => this.edit(() => { delete this.doc[key]; })]]);
        const n = this.section(body, "Note", true, { shut: true, hint: p.note ? p.note.split("\n")[0].slice(0, 26) : "empty" });
        this.text(n, () => p.note ?? "", (v) => { if (v.trim()) p.note = v; else delete p.note; }, { area: true, placeholder: "What this screen is for" });
    }
    blockPanel(body: HTMLElement, p: Page, b: Block) {
        const s = this.section(body, "Block");
        this.text(this.frow(s, "Name"), () => b.name, (v) => { b.name = v; }, { title: "Block name" });
        const kc = this.frow(s, "Kind"), kind = this.kinds.find((k) => k.id === b.kind) ?? this.kinds[0];
        const ki = kc.createSpan({ cls: "vl-kindi" }); ki.style.setProperty("--k", kind.color); setIcon(ki, kind.icon ?? "square");
        this.menu(kc, this.kinds.map((k) => [k.id, k.name] as [string, string]), b.kind, (v) => { b.kind = v; }, "Kind");
        // an override: the frame's block it takes the place of, and the way back to it
        const l = this.layers(p).find((x) => x.block === b);
        if (l?.over) {
            const o = this.section(body, "Override");
            o.createDiv({ cls: "vl-frameinfo", text: `Takes the place of ${this.page(l.over)?.name ?? "the frame"}'s ${b.name} on this screen.` });
            this.actions(o, [["undo-2", "Back to the frame", () => this.edit(() => { const own = this.blocks(p); own.splice(own.indexOf(b), 1); this.sel = { page: p.id, block: b.id }; })]]);
        }
        const pl = this.section(body, "Place");
        this.placeTool(pl, p, b);
        this.seg(this.frow(pl, "Bars"), [["in", "Inside the safe area"], ["bleed", "Under them"]], b.bleed ? "bleed" : "in", (v) => { if (v === "bleed") b.bleed = true; else { delete b.bleed; const R = this.room(p, b); if (!inRoom(b, R)) clampTo(b, R, false); } });
        this.lookControls(this.section(body, "Look", true, { shut: !lookOn(b), hint: lookHint(b) }), b, { sides: true });
        const it = this.section(body, "Items", true, { hint: String(b.items.length) });
        this.itemList(it, b, b.items);
        this.addButtons(it, b, b.items, ["text", "rect", "img", "icon", "line", "row", "col", "ellipse"]);
        const n = this.section(body, "Note", true, { shut: true, hint: b.note ? b.note.split("\n")[0].slice(0, 26) : "empty" });
        this.text(n, () => b.note ?? "", (v) => { if (v.trim()) b.note = v; else delete b.note; }, { area: true, placeholder: "What goes here, what is wrong (for the agent)" });
    }
    // several blocks: lined up with each other (to the outline around them all), spaced out evenly, copied, deleted
    groupPanel(body: HTMLElement, many: Block[]) {
        const s = this.section(body, "Blocks");
        s.createDiv({ cls: "vl-frameinfo", text: `${many.length} blocks chosen. Drag one to move them all; Shift+click adds or takes one out.` });
        const L = () => Math.min(...many.map((b) => b.x)), T = () => Math.min(...many.map((b) => b.y));
        const Rr = () => Math.max(...many.map((b) => b.x + b.w)), B = () => Math.max(...many.map((b) => b.y + b.h));
        const spread = (axis: "x" | "y") => {
            const len = axis === "x" ? "w" : "h", list = [...many].sort((a, b) => a[axis] - b[axis]);
            const a = list[0][axis], z = Math.max(...list.map((b) => b[axis] + b[len])), used = list.reduce((n, b) => n + b[len], 0);
            const gap = (z - a - used) / Math.max(1, list.length - 1);
            let at = a; for (const b of list) { b[axis] = Math.round(at); at += b[len] + gap; }
        };
        const al = s.createDiv({ cls: "vl-align" });
        const A: [string, string, () => void][] = [
            ["align-start-vertical", "Line up the left edges", () => { const v = L(); for (const b of many) b.x = v; }],
            ["align-center-vertical", "Line up the middles across", () => { const v = (L() + Rr()) / 2; for (const b of many) b.x = Math.round(v - b.w / 2); }],
            ["align-end-vertical", "Line up the right edges", () => { const v = Rr(); for (const b of many) b.x = v - b.w; }],
            ["|", "", () => {}],
            ["align-start-horizontal", "Line up the tops", () => { const v = T(); for (const b of many) b.y = v; }],
            ["align-center-horizontal", "Line up the middles down", () => { const v = (T() + B()) / 2; for (const b of many) b.y = Math.round(v - b.h / 2); }],
            ["align-end-horizontal", "Line up the bottoms", () => { const v = B(); for (const b of many) b.y = v - b.h; }],
            ["|", "", () => {}],
            ["align-horizontal-distribute-center", "Space out evenly across", () => spread("x")],
            ["align-vertical-distribute-center", "Space out evenly down", () => spread("y")],
        ];
        for (const [icon, label, act] of A) {
            if (icon === "|") { al.createSpan({ cls: "vl-alsep" }); continue; }
            this.icon(this.btn(al, icon, label, () => this.edit(act)), icon, label);
        }
        this.actions(body, [["copy", "Duplicate", () => this.duplicate()], ["trash-2", "Delete", () => this.remove()]]);
    }
    // several items: lined up (to the outline around them all, as drawn), spaced out, copied, deleted
    itemsPanel(body: HTMLElement, mi: { b: Block; it: Item }[]) {
        const s = this.section(body, "Items");
        const nb = new Set(mi.map((x) => x.b)).size;
        s.createDiv({ cls: "vl-frameinfo", text: `${mi.length} items chosen${nb > 1 ? ` in ${nb} blocks` : ""}. Drag one to move them all; Shift+click adds or takes one out.` });
        // each item's box on the screen (its block's place added), and a move by (mx, my) screen points
        const scr = () => this.wall.querySelector<HTMLElement>(".vl-screen");
        const boxes = () => mi.map((x) => { const bEl = scr()?.querySelector<HTMLElement>(`[data-block="${x.b.id}"]`), r = bEl ? this.itemBox(bEl, x.b, x.it) : null; return r ? { ...x, L: r.L + x.b.x, T: r.T + x.b.y, W: r.W, H: r.H } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
        const shift = (it: Item, mx: number, my: number) => { const [ax, ay] = axes(it.g); if (it.w !== "fill") it.dx = Math.round((it.dx ?? 0) + (ax > 0 ? -mx : mx)); if (it.h !== "fill") it.dy = Math.round((it.dy ?? 0) + (ay > 0 ? -my : my)); };
        type Bx = ReturnType<typeof boxes>[number];
        const line = (f: (all: Bx[]) => (x: Bx) => [number, number]) => () => { const all = boxes(); if (!all.length) return; const g = f(all); for (const x of all) { const [mx, my] = g(x); shift(x.it, mx, my); } };
        const spread = (axis: "x" | "y") => () => {
            const all = boxes().sort((a, b) => (axis === "x" ? a.L - b.L : a.T - b.T)); if (all.length < 3) return;
            const p0 = (x: Bx) => (axis === "x" ? x.L : x.T), len = (x: Bx) => (axis === "x" ? x.W : x.H);
            const a = p0(all[0]), z = Math.max(...all.map((x) => p0(x) + len(x))), gap = (z - a - all.reduce((n, x) => n + len(x), 0)) / (all.length - 1);
            let at = a; for (const x of all) { const d = at - p0(x); shift(x.it, axis === "x" ? d : 0, axis === "y" ? d : 0); at += len(x) + gap; }
        };
        const L = (a: Bx[]) => Math.min(...a.map((x) => x.L)), T = (a: Bx[]) => Math.min(...a.map((x) => x.T));
        const Rr = (a: Bx[]) => Math.max(...a.map((x) => x.L + x.W)), B = (a: Bx[]) => Math.max(...a.map((x) => x.T + x.H));
        const al = s.createDiv({ cls: "vl-align" });
        const A: [string, string, () => void][] = [
            ["align-start-vertical", "Line up the left edges", line((a) => { const v = L(a); return (x) => [v - x.L, 0]; })],
            ["align-center-vertical", "Line up the middles across", line((a) => { const v = (L(a) + Rr(a)) / 2; return (x) => [v - x.L - x.W / 2, 0]; })],
            ["align-end-vertical", "Line up the right edges", line((a) => { const v = Rr(a); return (x) => [v - x.L - x.W, 0]; })],
            ["|", "", () => {}],
            ["align-start-horizontal", "Line up the tops", line((a) => { const v = T(a); return (x) => [0, v - x.T]; })],
            ["align-center-horizontal", "Line up the middles down", line((a) => { const v = (T(a) + B(a)) / 2; return (x) => [0, v - x.T - x.H / 2]; })],
            ["align-end-horizontal", "Line up the bottoms", line((a) => { const v = B(a); return (x) => [0, v - x.T - x.H]; })],
            ["|", "", () => {}],
            ["align-horizontal-distribute-center", "Space out evenly across", spread("x")],
            ["align-vertical-distribute-center", "Space out evenly down", spread("y")],
        ];
        for (const [icon, label, act] of A) {
            if (icon === "|") { al.createSpan({ cls: "vl-alsep" }); continue; }
            this.icon(this.btn(al, icon, label, () => this.edit(act)), icon, label);
        }
        this.actions(body, [["group", "Group (Ctrl+G)", () => this.groupSel()], ["copy", "Duplicate", () => this.duplicate()], ["trash-2", "Delete", () => this.remove()]]);
    }
    // a frame's block on a page that inherits it: locked here; copy it in to change it here, or edit it where it belongs
    framePanel(body: HTMLElement, p: Page, l: Layer) {
        const owner = this.page(l.from), s = this.section(body, "From the frame");
        const lk = s.createDiv({ cls: "vl-lock" });
        setIcon(lk.createSpan({ cls: "vl-locki" }), "lock");
        lk.createSpan({ text: `${l.block.name} belongs to ${owner?.name ?? "the frame"}. It is drawn under this screen's own blocks and locked here.` });
        const acts: [string, string, () => void][] = [["copy-plus", "Change it on this screen only", () => this.edit(() => {
            const c = JSON.parse(JSON.stringify(l.block)) as Block;   // the same id (and items): it takes the frame block's place
            this.blocks(p, true).push(c); this.sel = { page: p.id, block: c.id };
        })]];
        if (owner) acts.push(["arrow-up-right", `Edit it in ${owner.name}`, () => { this.setView({ page: owner.id }); this.sel = { page: owner.id, block: l.block.id }; if (Platform.isMobile) this.setView({ rail: false }); this.draw(); }]);
        this.actions(s, acts);
    }
    // where a block sits, on a small phone: the safe areas, every block, the chosen one with its corner to resize; drag it
    // to move, click another to choose it; its distance to each edge of the room on the diagram (a click types it). Under
    // it the numbers (x, y, w, h: their labels drag), the align bar, and whether it may go under the bars
    placeTool(pl: HTMLElement, p: Page, b: Block) {
        const room = this.room(p, b), { W, H, safe } = this.screen(p);
        const gap = { l: () => b.x - room.l, r: () => room.r - b.x - b.w, t: () => b.y - room.t, b: () => room.b - b.y - b.h };
        const setGap = (side: "l" | "t" | "r" | "b", d: number) => {
            if (side === "l") b.x = room.l + d; else if (side === "r") b.x = room.r - b.w - d;
            else if (side === "t") b.y = room.t + d; else b.y = room.b - b.h - d;
        };
        const dia = pl.createDiv({ cls: "vl-gdia" });
        const k = Math.min(200 / H, 180 / W), ph = dia.createDiv({ cls: "vl-gphone" });
        Object.assign(ph.style, { width: `${W * k}px`, height: `${H * k}px` });
        for (const [side, v] of Object.entries(safe)) if (v) {
            const sa = ph.createDiv({ cls: `vl-gsafe is-${side}` });
            sa.style[side === "top" || side === "bottom" ? "height" : "width"] = `${v * k}px`;
        }
        const others = this.layers(p).map((l) => l.block).filter((x) => x.id !== b.id);
        for (const o of others) {
            const r = ph.createDiv({ cls: "vl-gblk", attr: { "aria-label": `Choose ${o.name}` } });
            Object.assign(r.style, { left: `${o.x * k}px`, top: `${o.y * k}px`, width: `${o.w * k}px`, height: `${o.h * k}px` });
            r.addEventListener("click", () => this.choose({ page: p.id, block: o.id }));
        }
        const me = ph.createDiv({ cls: "vl-gblk is-me" }), grip = me.createDiv({ cls: "vl-ggrip", attr: { "aria-label": "Resize" } });
        const tags: Record<string, HTMLElement> = {};
        for (const [side, name] of [["l", "Left"], ["r", "Right"], ["t", "Top"], ["b", "Bottom"]] as const) {
            const t = dia.createEl("button", { cls: `vl-gdist is-${side}`, attr: { "aria-label": `${name} distance: click to type` } });
            tags[side] = t;
            t.addEventListener("click", () => {
                // typed in place: Enter or leaving it sets the distance, Esc keeps it as it was
                const i = createEl("input", { cls: "vl-gdin", attr: { type: "number" } }); i.value = String(gap[side]());
                i.style.left = t.style.left; i.style.top = t.style.top;
                t.replaceWith(i); i.focus(); i.select();
                let done = false;
                const fin = (keep: boolean) => { if (done) return; done = true; const n = Number(i.value); if (keep && i.value !== "" && !Number.isNaN(n)) this.edit(() => setGap(side, Math.round(n))); else this.drawPanel(); };
                i.addEventListener("keydown", (e) => { if (e.key === "Enter") fin(true); if (e.key === "Escape") { e.stopPropagation(); fin(false); } });
                i.addEventListener("blur", () => fin(true));
            });
        }
        const paint = () => {
            Object.assign(me.style, { left: `${b.x * k}px`, top: `${b.y * k}px`, width: `${b.w * k}px`, height: `${b.h * k}px` });
            const pr = ph.offsetLeft, pt = ph.offsetTop;
            tags.l.setText(String(gap.l())); tags.r.setText(String(gap.r())); tags.t.setText(String(gap.t())); tags.b.setText(String(gap.b()));
            Object.assign(tags.l.style, { left: `${pr + (room.l + gap.l() / 2) * k}px`, top: `${pt + (b.y + b.h / 2) * k}px` });
            Object.assign(tags.r.style, { left: `${pr + (b.x + b.w + gap.r() / 2) * k}px`, top: `${pt + (b.y + b.h / 2) * k}px` });
            Object.assign(tags.t.style, { left: `${pr + (b.x + b.w / 2) * k}px`, top: `${pt + (room.t + gap.t() / 2) * k}px` });
            Object.assign(tags.b.style, { left: `${pr + (b.x + b.w / 2) * k}px`, top: `${pt + (b.y + b.h + gap.b() / 2) * k}px` });
        };
        // drag the block (or its corner) on the diagram: the same snapping and safe room as on the phone
        const drag = (el: HTMLElement, resize: boolean) => el.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); this.begin();
            const x0 = e.clientX, y0 = e.clientY, s0 = { ...b }, R = this.room(p, b), keep = !b.bleed && inRoom(b, R);
            const mv = (m: PointerEvent) => {
                const dx = (m.clientX - x0) / k, dy = (m.clientY - y0) / k, sn = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / grid()) * grid());
                if (resize) { b.w = Math.max(8, sn(s0.w + dx)); b.h = Math.max(8, sn(s0.h + dy)); } else { b.x = sn(s0.x + dx); b.y = sn(s0.y + dy); }
                if (keep) clampTo(b, R, resize);
                paint(); this.draftPut(); this.drawPages(); this.livePanel();
            };
            const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); this.end(); this.drawPanel(); };
            el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
        });
        drag(me, false); drag(grip, true);
        window.setTimeout(paint);
        // the numbers
        const nums = pl.createDiv({ cls: "vl-nums is-four" });
        this.num(nums, "X", () => b.x, (v) => { b.x = Math.round(v); });
        this.num(nums, "Y", () => b.y, (v) => { b.y = Math.round(v); });
        this.num(nums, "W", () => b.w, (v) => { b.w = Math.max(8, Math.round(v)); }, { min: 8 });
        this.num(nums, "H", () => b.h, (v) => { b.h = Math.max(8, Math.round(v)); }, { min: 8 });
        // align: to an edge of the room, its middle, or fill its width / all of it
        const al = pl.createDiv({ cls: "vl-align" });
        const A: [string, string, () => void][] = [
            ["align-horizontal-justify-start", "Align left", () => { b.x = room.l; }],
            ["align-horizontal-justify-center", "Centre across", () => { b.x = Math.round((room.l + room.r - b.w) / 2); }],
            ["align-horizontal-justify-end", "Align right", () => { b.x = room.r - b.w; }],
            ["|", "", () => {}],
            ["align-vertical-justify-start", "Align top", () => { b.y = room.t; }],
            ["align-vertical-justify-center", "Centre down", () => { b.y = Math.round((room.t + room.b - b.h) / 2); }],
            ["align-vertical-justify-end", "Align bottom", () => { b.y = room.b - b.h; }],
            ["|", "", () => {}],
            ["move-horizontal", "Full width", () => { b.x = room.l; b.w = room.r - room.l; }],
            ["maximize", "Fill the screen", () => { b.x = room.l; b.y = room.t; b.w = room.r - room.l; b.h = room.b - room.t; }],
        ];
        for (const [icon, label, act] of A) {
            if (icon === "|") { al.createSpan({ cls: "vl-alsep" }); continue; }
            this.icon(this.btn(al, icon, label, () => this.edit(act)), icon, label);
        }
        // the dragged numbers update the diagram too
        const live = dia.createSpan({ cls: "vl-gdlive" });
        this.liveText.set(live, () => { paint(); return ""; });
    }
    // a block kind: its icon in its colour, its name in the tooltip
    kindChip(g: HTMLElement, k: Kind, on: boolean) {
        const c = g.createEl("button", { cls: "vl-chip is-icon is-kind" + (on ? " is-on" : ""), attr: { "aria-label": k.name } });
        c.style.setProperty("--k", k.color);
        setIcon(c, k.icon ?? "square"); if (!c.querySelector("svg")) c.setText(k.name);
        return c;
    }
    // an icon by name, else its words (an icon set may not have every name)
    icon(el: HTMLElement, name: string, words: string) { if (!el.querySelector("svg")) { el.empty(); el.setText(words); el.addClass("is-words"); } return el; }
    itemList(parent: HTMLElement, b: Block, list: Item[]) {
        const l = parent.createDiv({ cls: "vl-list" });
        list.forEach((it, i) => {
            const r = l.createDiv({ cls: "vl-row" });
            const grip = r.createSpan({ cls: "vl-igrip2", attr: { "aria-label": "Drag up or down to reorder" } }); setIcon(grip, "grip-vertical");
            const pick = r.createEl("button", { cls: "vl-rowmain" });
            setIcon(pick.createSpan({ cls: "vl-rowty" }), TYPE_ICON[it.type]);
            pick.createSpan({ cls: "vl-rowtx", text: label(it) });
            const d = detail(it); if (d) pick.createSpan({ cls: "vl-rowsub", text: d });
            pick.addEventListener("click", () => this.choose({ page: this.sel!.page, block: b.id, item: it.id }));
            // the pointer on a row lights its item on the phone
            const lit = (on: boolean) => this.wall?.querySelectorAll(`.vl-block[data-block="${b.id}"] .vl-it[data-id="${it.id}"]`).forEach((x) => x.toggleClass("is-hl", on));
            r.addEventListener("mouseenter", () => lit(true)); r.addEventListener("mouseleave", () => lit(false));
            // reorder: drag the grip; a line shows where it goes
            grip.addEventListener("pointerdown", (e) => {
                e.preventDefault(); grip.setPointerCapture(e.pointerId);
                const rows = [...l.querySelectorAll<HTMLElement>(":scope > .vl-row")];
                let to = i;
                const mv = (m: PointerEvent) => {
                    to = rows.findIndex((x) => m.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2); if (to < 0) to = rows.length;
                    rows.forEach((x, n) => { x.toggleClass("is-drop", n === to); }); l.toggleClass("is-drop-end", to === rows.length);
                    r.addClass("is-moving");
                };
                const up = () => {
                    grip.removeEventListener("pointermove", mv); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
                    rows.forEach((x) => x.removeClass("is-drop")); l.removeClass("is-drop-end"); r.removeClass("is-moving");
                    const dest = to > i ? to - 1 : to;
                    if (dest !== i) this.edit(() => { const [x] = list.splice(i, 1); list.splice(dest, 0, x); });
                };
                grip.addEventListener("pointermove", mv); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
            });
        });
    }
    addButtons(parent: HTMLElement, b: Block, list: Item[], types: ItemType[]) {
        const names: Record<ItemType, string> = { text: "Text", rect: "Shape", ellipse: "Circle", line: "Line", img: "Picture", icon: "Icon", group: "Group", row: "Row", col: "Column" };
        const g = parent.createDiv({ cls: "vl-addgrid is-items" });
        for (const t of types) {
            const c = g.createEl("button", { cls: "vl-addt", attr: { "aria-label": `Add a ${names[t].toLowerCase()}` } });
            setIcon(c.createSpan({ cls: "vl-addi" }), t === "icon" ? "smile-plus" : TYPE_ICON[t]); c.createSpan({ text: names[t] });
            c.addEventListener("click", () => this.edit(() => { const it = newItem(t); const holder = list === b.items ? null : (function find(xs: Item[]): Item | undefined { for (const x of xs) { if (x.items === list) return x; const f = x.items && find(x.items); if (f) return f; } })(b.items); if (holder && holder.type !== "group") { delete it.g; delete it.dx; delete it.dy; } list.push(it); this.sel = { page: this.sel!.page, block: b.id, item: it.id }; }));
        }
    }
    itemPanel(body: HTMLElement, b: Block, it: Item, top: boolean) {
        // one page: its look, where it sits, its note (each section folds)
        this.stylePanel(body, b, it);
        this.placePanel(body, b, it, top);
        this.text(this.section(body, "Note", true), () => it.note ?? "", (v) => { if (v.trim()) it.note = v; else delete it.note; }, { area: true, placeholder: "Why it is here, what to change (for the agent)" });
    }
    stylePanel(body: HTMLElement, b: Block, it: Item) {
        if (it.type === "text") {
            const s = this.section(body, "Text");
            this.text(s, () => it.v ?? "", (v) => { it.v = v; }, { area: true });
            const fc = this.frow(s, "Font");
            this.menu(fc, Object.keys(this.theme.fonts).map((k) => [k, k] as [string, string]), it.font ?? "ui", (v) => { it.font = v === "ui" ? undefined : v; }, "Font");
            this.menu(fc, [["100", "Thin"], ["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["900", "Black"]], String(it.wt ?? 400), (v) => { it.wt = v === "400" ? undefined : Number(v); }, "Weight");
            const r = s.createDiv({ cls: "vl-nums is-three" });
            this.num(r, "Size", () => it.size ?? 15, (v) => { it.size = v; }, { min: 4, max: 400 });
            this.num(r, "Spacing", () => it.ls ?? 0, (v) => { it.ls = v || undefined; }, { step: 0.01 });
            this.num(r, "Line", () => it.lh ?? 1.2, (v) => { it.lh = v; }, { step: 0.05, min: 0.5 });
            this.seg(this.frow(s, "Case"), [["no", "As typed"], ["up", "CAPITALS"]], it.upper ? "up" : "no", (v) => { it.upper = v === "up" || undefined; });
            this.colors(this.section(body, "Colour"), it.color ?? "text", (v) => { it.color = v === "text" ? undefined : v; });
            this.lookControls(this.section(body, "Box", true, { shut: !lookOn(it), hint: lookHint(it) }), it, { pad: true });
        } else if (it.type === "line") {
            const s = this.section(body, "Line");
            const r = s.createDiv({ cls: "vl-nums" });
            this.num(r, "Thickness", () => (typeof it.h === "number" ? it.h : 1), (v) => { it.h = v; }, { min: 1, unit: "pt" });
            this.num(r, "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100, unit: "%" });
            this.colors(this.section(body, "Colour"), it.fill ?? "line", (v) => { it.fill = v; });
        } else if (it.type === "img") {
            this.picturePanel(body, b, it);
        } else if (it.type === "icon") {
            // the name, and the icons it matches (Obsidian's set) to pick from
            const s = this.section(body, "Icon");
            const sug = createDiv({ cls: "vl-chips is-icons vl-iconpick" });
            const fill = () => {
                sug.empty();
                const q = (it.name ?? "").trim().toLowerCase(), all = iconNames();
                const hits = q ? all.filter((n) => n.includes(q)).sort((a, z) => Number(!a.startsWith(q)) - Number(!z.startsWith(q)) || a.length - z.length) : all;
                for (const n of hits.slice(0, 48)) {
                    const c = sug.createEl("button", { cls: "vl-chip is-icon" + (n === it.name ? " is-on" : ""), attr: { "aria-label": n } });
                    setIcon(c, n);
                    c.addEventListener("click", () => this.edit(() => { it.name = n; }));
                }
                if (!hits.length) sug.createDiv({ cls: "vl-frameinfo", text: "No icon by that name: it shows as a ?" });
            };
            this.text(s, () => it.name ?? "", (v) => { it.name = v.trim(); fill(); }, { placeholder: "A Lucide name: sparkles, house…", title: "Icon name" });
            s.appendChild(sug); fill();
            const r = s.createDiv({ cls: "vl-nums is-three" });
            this.num(r, "Size", () => it.size ?? 20, (v) => { it.size = v; }, { min: 4, max: 400 });
            this.num(r, "Stroke", () => it.sw ?? 0, (v) => { it.sw = v || undefined; }, { step: 0.25, min: 0, max: 4 });
            this.num(r, "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100, unit: "%" });
            this.colors(this.section(body, "Colour"), it.color ?? "text", (v) => { it.color = v === "text" ? undefined : v; });
        } else if (it.type === "group") {
            const s = this.section(body, "Group");
            s.createDiv({ cls: "vl-frameinfo", text: `${it.items?.length ?? 0} items, moved as one. Click in it again (or double-click) to choose one of them; Esc goes back up.` });
            const acts: [string, string, () => void][] = [["scan", "Fit to its items", () => { const scr = this.wall.querySelector<HTMLElement>(".vl-screen"); if (scr) this.edit(() => this.refit(scr, b, it)); }]];
            if (b.items.includes(it)) acts.unshift(["ungroup", "Ungroup (Ctrl+Shift+G)", () => this.ungroup()]);
            this.actions(s, acts);
            this.num(s.createDiv({ cls: "vl-nums" }), "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100 });
            const c = this.section(body, "Items in it");
            this.itemList(c, b, it.items ?? (it.items = []));
            this.addButtons(c, b, it.items, ["text", "rect", "ellipse", "img", "icon", "row", "col"]);
        } else if (it.type === "row" || it.type === "col") {
            const s = this.section(body, "Layout"), across = it.type === "row";
            this.seg(this.frow(s, "Direction"), [["row", "Across", "arrow-right"], ["col", "Down", "arrow-down"]], it.type, (v) => { it.type = v as ItemType; });
            this.seg(this.frow(s, "Line up"), across ? [["start", "Top"], ["center", "Middle"], ["end", "Bottom"]] : [["start", "Left"], ["center", "Middle"], ["end", "Right"]], it.cross ?? "start", (v) => { it.cross = v as Item["cross"]; });
            this.seg(this.frow(s, "Spread"), [["start", "Start"], ["center", "Middle"], ["end", "End"], ["between", "Apart"]], it.main ?? "start", (v) => { it.main = v as Item["main"]; });
            const r = s.createDiv({ cls: "vl-nums" });
            this.num(r, "Gap", () => it.gap ?? 0, (v) => { it.gap = v; }, { min: 0, unit: "pt" });
            this.num(r, "Padding", () => it.pad ?? 0, (v) => { it.pad = v || undefined; }, { min: 0, unit: "pt" });
            const c = this.section(body, "Items in it", true, { hint: String(it.items?.length ?? 0) });
            this.itemList(c, b, it.items ?? (it.items = []));
            this.addButtons(c, b, it.items, ["text", "rect", "img", "icon", "row", "col", "ellipse"]);
            this.lookControls(this.section(body, "Look", true, { shut: !lookOn(it), hint: lookHint(it) }), it, {});
        } else { this.shapeStyle(body, it, false); this.sizeNums(body, it, b.items.includes(it)); this.rectToLook(body, b, it); }
    }
    // a picture's settings: the whole picture with the part the box shows framed (click or drag it to choose that part),
    // its address (or a picture of the vault), how it fits, the focus as a 3 × 3 grid, its size
    picturePanel(body: HTMLElement, b: Block, it: Item) {
        const s = this.section(body, "Picture");
        const prev = s.createDiv({ cls: "vl-imgprev" }), info = s.createDiv({ cls: "vl-frameinfo" });
        const fit = () => it.fit ?? "cover";
        const box = () => { const el = (this.wall ?? activeDocument).querySelector<HTMLElement>(`.vl-it[data-id="${it.id}"]`); return { W: el?.offsetWidth || (typeof it.w === "number" ? it.w : 80), H: el?.offsetHeight || (typeof it.h === "number" ? it.h : 80) }; };
        let im: HTMLImageElement | null = null, crop: HTMLElement | null = null;
        // the frame over the picture: the part a cover fit shows, from the focus (object-position as percentages)
        const layout = () => {
            if (!im || !crop || !im.naturalWidth) return;
            const nw = im.naturalWidth, nh = im.naturalHeight, PW = prev.clientWidth || 240;
            const ph = Math.min(180, (PW * nh) / nw), pw = (ph * nw) / nh, k = pw / nw;
            Object.assign(im.style, { width: `${pw}px`, height: `${ph}px` }); prev.style.height = `${ph}px`;
            const { W, H } = box();
            info.setText(`Picture ${nw} × ${nh} px · box ${W} × ${H}`);
            if (fit() !== "cover") { crop.hide(); return; }
            const sc = Math.max(W / nw, H / nh), vw = W / sc, vh = H / sc, [fx, fy] = focusOf(it.pos);
            crop.show();
            Object.assign(crop.style, { left: `${(PW - pw) / 2 + (nw - vw) * fx * k}px`, top: `${(nh - vh) * fy * k}px`, width: `${vw * k}px`, height: `${vh * k}px` });
        };
        const draw = () => {
            prev.empty(); prev.removeClass("is-empty", "is-broken"); prev.setCssStyles({ height: "" }); im = crop = null;
            const url = pictureUrl(it.src);
            if (!url) { prev.addClass("is-empty"); setIcon(prev.createDiv(), "image"); info.setText("No picture yet: an https address or a vault path."); return; }
            info.setText("Loading…");
            im = prev.createEl("img", { attr: { alt: "", draggable: "false" } });
            crop = prev.createDiv({ cls: "vl-imgcrop" }); crop.hide();
            im.addEventListener("load", layout, { once: true });
            im.addEventListener("error", () => { prev.empty(); prev.addClass("is-broken"); setIcon(prev.createDiv(), "image-off"); info.setText("This address can not be loaded."); }, { once: true });
            im.src = url;
            if (im.complete && im.naturalWidth) layout();
        };
        draw();
        // click or drag on the picture: the part under the pointer is the middle of what the box shows
        prev.addEventListener("pointerdown", (e) => {
            if (!im?.naturalWidth || fit() === "fill") return;
            e.preventDefault(); prev.setPointerCapture(e.pointerId); this.begin();
            const at = (m: PointerEvent) => {
                const r = im!.getBoundingClientRect(), nw = im!.naturalWidth, nh = im!.naturalHeight, { W, H } = box();
                const cx = Math.min(1, Math.max(0, (m.clientX - r.left) / r.width)), cy = Math.min(1, Math.max(0, (m.clientY - r.top) / r.height));
                let fx = cx, fy = cy;
                if (fit() === "cover") {
                    const sc = Math.max(W / nw, H / nh), vw = W / sc, vh = H / sc;
                    fx = nw - vw > 1 ? Math.min(1, Math.max(0, (cx * nw - vw / 2) / (nw - vw))) : 0.5;
                    fy = nh - vh > 1 ? Math.min(1, Math.max(0, (cy * nh - vh / 2) / (nh - vh))) : 0.5;
                }
                const pc = (v: number) => Math.round(v * 100);
                if (pc(fx) === 50 && pc(fy) === 50) delete it.pos; else it.pos = `${pc(fx)}% ${pc(fy)}%`;
                this.draftPut(); this.drawPages(); layout();
            };
            at(e);
            const up = () => { prev.removeEventListener("pointermove", at); prev.removeEventListener("pointerup", up); this.end(); this.drawPanel(); };
            prev.addEventListener("pointermove", at); prev.addEventListener("pointerup", up);
        });
        // the address: typed (the preview follows a moment after), or a picture of the vault
        const row = s.createDiv({ cls: "vl-srcrow" });
        let t = 0;
        this.text(row, () => it.src ?? "", (v) => { it.src = v; window.clearTimeout(t); t = window.setTimeout(draw, 400); }, { placeholder: "https://… or a vault path", title: "Picture address" });
        this.btn(row, "folder-open", "A picture of the vault", () => new ImagePick(this.plugin.app, (f) => this.edit(() => { it.src = f.path; })).open());
        const fs = this.section(body, "Fit");
        this.chips(fs, [["cover", "Cover"], ["contain", "Contain"], ["fill", "Stretch"]], fit(), (v) => { it.fit = v; });
        fs.createDiv({ cls: "vl-frameinfo", text: { cover: "Fills the box; the edges are cut off.", contain: "All of the picture, inside the box.", fill: "Pulled to the box's shape." }[fit()] });
        if (fit() !== "fill") {
            const ps = this.section(body, "Focus");
            const wrap = ps.createDiv({ cls: "vl-gwrap" });
            const grid = wrap.createDiv({ cls: "vl-grav" });
            const [fx, fy] = focusOf(it.pos);
            for (const y of [0, 0.5, 1]) for (const x of [0, 0.5, 1]) {
                const name = `${["left", "center", "right"][x * 2]} ${["top", "center", "bottom"][y * 2]}`;
                const d = grid.createEl("button", { cls: fx === x && fy === y ? "is-on" : "", attr: { "aria-label": name === "center center" ? "Middle" : name } });
                d.createSpan();
                d.addEventListener("click", () => this.edit(() => { if (x === 0.5 && y === 0.5) delete it.pos; else it.pos = name; }));
            }
            const side = wrap.createDiv({ cls: "vl-secb" });
            side.createDiv({ cls: "vl-frameinfo", text: "Or click the picture above. Exact (CSS object-position):" });
            this.text(side, () => it.pos ?? "", (v) => { if (v.trim()) it.pos = v; else delete it.pos; }, { placeholder: "center · 50% 30%", title: "Focus" });
        }
        this.sizeNums(body, it, b.items.includes(it));
        this.actions(body.lastElementChild?.querySelector<HTMLElement>(".vl-secb") ?? body, [["ratio", "Height from the picture's shape", () => {
            if (!im?.naturalWidth) { new Notice("Vellum: the picture is not loaded yet"); return; }
            const W = typeof it.w === "number" ? it.w : box().W, H = Math.round((W * im.naturalHeight) / im.naturalWidth);
            this.edit(() => { it.w = W; it.h = H; });
        }]]);
        const r = this.section(body, "Corners and opacity").createDiv({ cls: "vl-nums" });
        this.num(r, "Radius", () => (Array.isArray(it.r) ? it.r[0] ?? 0 : it.r ?? 0), (v) => { it.r = v || undefined; }, { min: 0 });
        this.num(r, "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100 });
    }
    // exact size and offset as numbers (a hug / fill size shows as drawn; typing a number fixes it); the corner handles change them too
    sizeNums(body: HTMLElement, it: Item, top: boolean) {
        const r = this.section(body, "Size and place").createDiv({ cls: "vl-nums" });
        const drawn = (axis: "w" | "h") => { const el = (this.wall ?? activeDocument).querySelector<HTMLElement>(`.vl-it[data-id="${it.id}"]`); return el ? (axis === "w" ? el.offsetWidth : el.offsetHeight) : 40; };
        this.num(r, "W", () => (typeof it.w === "number" ? it.w : drawn("w")), (v) => { it.w = v; }, { min: 1 });
        this.num(r, "H", () => (typeof it.h === "number" ? it.h : drawn("h")), (v) => { it.h = v; }, { min: 1 });
        if (top) { this.num(r, "X", () => it.dx ?? 0, (v) => { it.dx = v; }); this.num(r, "Y", () => it.dy ?? 0, (v) => { it.dy = v; }); }
    }
    // a box's own look (a block, a text): its fill, an outline (all round, or on some sides), a radius, a padding
    lookControls(sec: HTMLElement, o: { fill?: string; stroke?: string; sw?: number; r?: number | number[]; sides?: string; pad?: number }, opt: { sides?: boolean; pad?: boolean } = {}) {
        this.colors(sec, o.fill ?? "none", (v) => { if (v === "none") delete o.fill; else o.fill = v; }, true);
        const r = sec.createDiv({ cls: "vl-nums is-three" });
        this.num(r, "Outline", () => o.sw ?? 0, (v) => { o.sw = v || undefined; }, { min: 0, step: 0.5, unit: "pt" });
        this.num(r, "Radius", () => (Array.isArray(o.r) ? o.r[0] ?? 0 : o.r ?? 0), (v) => { o.r = v || undefined; }, { min: 0, unit: "pt" });
        if (opt.pad) this.num(r, "Padding", () => o.pad ?? 0, (v) => { o.pad = v || undefined; }, { min: 0, unit: "pt" });
        if (opt.sides && o.sw) {
            // the outline's sides: all of them, or only some (a separator: the bottom alone)
            const g = sec.createDiv({ cls: "vl-chips is-icons" }), cur = o.sides || "trbl";
            for (const [k, icon, name] of [["t", "panel-top", "Top"], ["r", "panel-right", "Right"], ["b", "panel-bottom", "Bottom"], ["l", "panel-left", "Left"]] as const) {
                const c = g.createEl("button", { cls: "vl-chip is-icon" + (cur.includes(k) ? " is-on" : ""), attr: { "aria-label": `${name} side` } });
                setIcon(c, icon);
                c.addEventListener("click", () => this.edit(() => {
                    const now = (o.sides || "trbl").includes(k) ? (o.sides || "trbl").replace(k, "") : (o.sides || "") + k;
                    const sorted = "trbl".split("").filter((x) => now.includes(x)).join("");
                    if (!sorted || sorted === "trbl") delete o.sides; else o.sides = sorted;
                }));
            }
        }
        if (o.sw) this.colors(sec, o.stroke ?? "line", (v) => { o.stroke = v; });
    }
    // a rectangle drawn as a frame: one that covers its block becomes the block's look; one under a single text becomes
    // that text's box (a chip, a tile, a button). Agents draw frames with rectangles; this turns them into what they are
    rectToLook(body: HTMLElement, b: Block, it: Item) {
        if (it.type !== "rect" || !b.items.includes(it)) return;
        const bEl = this.wall?.querySelector<HTMLElement>(`.vl-block[data-block="${b.id}"]`); if (!bEl) return;
        const box = this.itemBox(bEl, b, it); if (!box) return;
        const look = (to: { fill?: string; stroke?: string; sw?: number; r?: number | number[] }) => { if (it.fill) to.fill = it.fill; if (it.sw) { to.sw = it.sw; to.stroke = it.stroke; } if (it.r) to.r = it.r; };
        const drop = () => b.items.splice(b.items.indexOf(it), 1);
        if (box.L < 1 && box.T < 1 && Math.abs(box.W - b.w) < 1 && Math.abs(box.H - b.h) < 1) {
            this.actions(body, [["square-dashed-bottom", "Make it the block's look", () => this.edit(() => { look(b); drop(); this.sel = { page: this.sel!.page, block: b.id }; })]]);
            return;
        }
        // the items lying on it: exactly one text, and nothing else
        const on = b.items.filter((x) => x !== it).map((x) => ({ x, r: this.itemBox(bEl, b, x) })).filter((o) => o.r && o.r.L + o.r.W / 2 > box.L && o.r.L + o.r.W / 2 < box.L + box.W && o.r.T + o.r.H / 2 > box.T && o.r.T + o.r.H / 2 < box.T + box.H);
        if (on.length !== 1 || on[0].x.type !== "text") return;
        const t = on[0].x, tr = on[0].r!;
        this.actions(body, [["text-select", "Make it the text's box", () => this.edit(() => {
            look(t);
            const centred = Math.abs(tr.L + tr.W / 2 - (box.L + box.W / 2)) < 3;
            t.w = Math.round(box.W); t.h = Math.round(box.H); t.dy = Math.round(box.T);
            if (centred) { t.g = "t"; t.dx = toD(0, box.L, box.W, b.w); }
            else { t.g = "tl"; t.dx = Math.round(box.L); t.pad = Math.max(0, Math.round(tr.L - box.L)) || undefined; }
            drop(); this.sel = { page: this.sel!.page, block: b.id, item: t.id };
        })]]);
    }
    shapeStyle(body: HTMLElement, it: Item, box: boolean) {
        if (!box) this.seg(this.section(body, "Shape"), [["rect", "Rectangle", "square"], ["ellipse", "Circle", "circle"]], it.type, (v) => { it.type = v as ItemType; });
        this.colors(this.section(body, box ? "Background" : "Fill"), it.fill, (v) => { if (v === "none") delete it.fill; else it.fill = v; }, true);
        const o = this.section(body, "Outline", true, { shut: !it.sw, hint: it.sw ? `${it.sw} pt` : "none" });
        const r = o.createDiv({ cls: "vl-nums is-three" });
        this.num(r, "Width", () => it.sw ?? 0, (v) => { it.sw = v || undefined; }, { min: 0, step: 0.5, unit: "pt" });
        if (it.type !== "ellipse") this.num(r, "Radius", () => (Array.isArray(it.r) ? it.r[0] ?? 0 : it.r ?? 0), (v) => { it.r = v || undefined; }, { min: 0 });
        this.num(r, "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100, unit: "%" });
        if (it.sw) this.colors(o, it.stroke ?? "line", (v) => { it.stroke = v; });
    }
    placePanel(body: HTMLElement, b: Block, it: Item, top: boolean) {
        const s = this.section(body, "Place", true);
        if (top) {
            const bEl = this.wall?.querySelector<HTMLElement>(`.vl-block[data-block="${b.id}"]`), ib = bEl ? this.itemBox(bEl, b, it) : null;
            const k = Math.min(250 / b.w, 110 / b.h), pv = s.createDiv({ cls: "vl-apv" });
            Object.assign(pv.style, { width: `${b.w * k}px`, height: `${b.h * k}px` });
            if (ib) { const r = pv.createDiv({ cls: "vl-abox" }); Object.assign(r.style, { left: `${ib.L * k}px`, top: `${ib.T * k}px`, width: `${Math.max(2, ib.W * k)}px`, height: `${Math.max(2, ib.H * k)}px` }); }
            const [cx, cy] = axes(it.g);
            for (const g of GRAVITIES) {
                const [ax, ay] = axes(g);
                const d = pv.createEl("button", { cls: "vl-adot" + (g === (it.g ?? "tl") ? " is-on" : ""), attr: { "aria-label": `Hold on to the ${({ tl: "top left", t: "top", tr: "top right", l: "left", c: "middle", r: "right", bl: "bottom left", b: "bottom", br: "bottom right" } as Record<string, string>)[g]}` } });
                Object.assign(d.style, { left: `${(ax + 1) * 50}%`, top: `${(ay + 1) * 50}%` });
                d.addEventListener("click", () => this.edit(() => {
                    // the item stays where it is: its offset is worked out from the new point
                    if (ib) { if (it.w !== "fill") it.dx = toD(ax, ib.L, ib.W, b.w); if (it.h !== "fill") it.dy = toD(ay, ib.T, ib.H, b.h); }
                    it.g = g;
                }));
            }
            // the line from the point it holds on to, to the same point of the item
            if (ib) {
                const px = (cx + 1) / 2, py = (cy + 1) / 2;
                const svg = pv.createSvg("svg", { cls: "vl-aline", attr: { width: b.w * k, height: b.h * k } });
                svg.createSvg("line", { attr: { x1: px * b.w * k, y1: py * b.h * k, x2: (ib.L + px * ib.W) * k, y2: (ib.T + py * ib.H) * k } });
            }
            const nums = s.createDiv({ cls: "vl-nums is-four" });
            if (it.w !== "fill") this.num(nums, cx < 0 ? "← X" : cx > 0 ? "X →" : "X ↔", () => it.dx ?? 0, (v) => { it.dx = v; });
            if (it.h !== "fill") this.num(nums, cy < 0 ? "↑ Y" : cy > 0 ? "Y ↓" : "Y ↕", () => it.dy ?? 0, (v) => { it.dy = v; });
        }
        if (it.type === "icon") { s.createDiv({ cls: "vl-frameinfo", text: "An icon is as big as its Size." }); return; }
        for (const [axis, name] of [["w", "Width"], ["h", "Height"]] as const) {
            const row = s.createDiv({ cls: "vl-frow" });
            row.createSpan({ cls: "vl-frowl", text: name });
            const ctl = row.createDiv({ cls: "vl-frowc" });
            const cur = it[axis];
            const rule = cur === "fill" ? "fill" : typeof cur === "number" ? "fixed" : "hug";
            this.chips(ctl, [["hug", "Hug: as big as its content", axis === "w" ? "fold-horizontal" : "fold-vertical"], ["fixed", "Fixed: a set size", "lock"], ["fill", "Fill: the block's room", axis === "w" ? "unfold-horizontal" : "unfold-vertical"]], rule, (v) => {
                if (v === "fixed") { const el = (this.wall ?? activeDocument).querySelector<HTMLElement>(`.vl-it[data-id="${it.id}"]`); it[axis] = Math.round(el ? (axis === "w" ? el.offsetWidth : el.offsetHeight) : 40); }
                else it[axis] = v;
            });
            if (rule === "fixed") this.num(ctl, "pt", () => it[axis] as number, (v) => { it[axis] = v; }, { min: 1 });
            if (rule === "fill" && top) this.num(ctl, "Margin", () => Math.abs((axis === "w" ? it.dx : it.dy) ?? 0), (v) => { if (axis === "w") it.dx = v; else it.dy = v; }, { min: 0 });
        }
    }
}

// object-position as two fractions (0 left / top … 1 right / bottom); keywords and percentages, anything else the middle
const focusOf = (pos?: string): [number, number] => {
    const w = (pos ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const kw: Record<string, [number, "x" | "y" | ""]> = { left: [0, "x"], right: [1, "x"], top: [0, "y"], bottom: [1, "y"], center: [0.5, ""] };
    let x = 0.5, y = 0.5, i = 0;
    for (const t of w.slice(0, 2)) {
        const k = kw[t], n = /^(-?\d+(?:\.\d+)?)%$/.exec(t);
        if (k) { if (k[1] === "y") y = k[0]; else if (k[1] === "x") x = k[0]; }
        else if (n) { if (i === 0 && w.length > 1) x = Number(n[1]) / 100; else if (i === 0) x = Number(n[1]) / 100; else y = Number(n[1]) / 100; }
        i++;
    }
    return [x, y];
};
// a picture of the vault, typed to find
class ImagePick extends FuzzySuggestModal<TFile> {
    constructor(app: App, readonly pick: (f: TFile) => void) { super(app); this.setPlaceholder("A picture of the vault"); }
    getItems() { return this.app.vault.getFiles().filter((f) => /^(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(f.extension)); }
    getItemText(f: TFile) { return f.path; }
    onChooseItem(f: TFile) { this.pick(f); }
}
// a block inside a room; kept in it: moved back in (resize: its size cut to the room instead)
const inRoom = (b: Block, R: { l: number; t: number; r: number; b: number }) => b.x >= R.l && b.y >= R.t && b.x + b.w <= R.r && b.y + b.h <= R.b;
const clampTo = (b: Block, R: { l: number; t: number; r: number; b: number }, resize: boolean) => {
    if (resize) { b.w = Math.max(8, Math.min(b.w, R.r - b.x)); b.h = Math.max(8, Math.min(b.h, R.b - b.y)); return; }
    b.x = Math.max(R.l, Math.min(b.x, R.r - b.w)); b.y = Math.max(R.t, Math.min(b.y, R.b - b.h));
};
// colour conversions: red, green, blue 0–255; hue 0–360, saturation and lightness 0–100; a hex with opacity when below 1
export const hexOf = (c: { r: number; g: number; b: number; a: number }) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") + (c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, "0") : "");
const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
};
const hslToRgb = (h: number, s: number, l: number) => {
    s /= 100; l /= 100;
    const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
};
export const rgbToHsv = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, d = mx - mn, h = rgbToHsl(r, g, b).h;
    return { h, s: Math.round(mx ? (d / mx) * 100 : 0), v: Math.round(mx * 100) };
};
export const hsvToRgb = (h: number, s: number, v: number) => {
    s /= 100; v /= 100;
    const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
};
// an item's type as an icon (the item list, the add buttons)
const TYPE_ICON: Record<ItemType, string> = { text: "type", rect: "square", ellipse: "circle", line: "minus", img: "image", icon: "smile", group: "group", row: "columns-3", col: "rows-3" };
// a short detail beside an item's name in the list
const detail = (it: Item): string => it.type === "text" ? `${it.font ?? "ui"} ${it.size ?? 15}` : it.type === "icon" ? `${it.size ?? 20}` : it.type === "img" ? it.fit ?? "cover"
    : it.type === "row" || it.type === "col" ? `${it.items?.length ?? 0} in it` : it.fill && typeof it.fill === "string" && !it.fill.includes("(") ? it.fill : "";
// a box's look, in short (a folded section's summary)
const lookOn = (o: { fill?: string; sw?: number }) => !!(o.fill && o.fill !== "none") || !!o.sw;
const lookHint = (o: { fill?: string; sw?: number; sides?: string; r?: number | number[] }) => {
    const f = o.fill && o.fill !== "none" ? (o.fill.includes("(") ? "custom fill" : o.fill) : "", line = o.sw ? `outline ${o.sw}${o.sides ? ` ${o.sides}` : ""}` : "";
    return [f, line].filter(Boolean).join(" · ") || "none";
};
const RESIZE: ItemType[] = ["img", "rect", "ellipse"];   // items with corner handles
const ZOOMMAX = 16, MAPMAX = 6;   // 1600 % for a screen, 600 % for the map
const label = (it: Item) => (it.type === "text" ? (it.v ?? "").split("\n")[0].slice(0, 24) || "(empty text)" : it.type === "row" || it.type === "col" || it.type === "group" ? `${it.items?.length ?? 0} items`
    : it.type === "img" ? (it.src ?? "").split(/[/?#]/).filter(Boolean).pop()?.slice(0, 24) || "picture" : it.type === "icon" ? it.name || "icon" : it.type === "ellipse" ? "circle" : it.type);
// Obsidian's icon names (Lucide without its prefix, and any an app added), for the icon item's suggestions
let icons: string[] | null = null;
const iconNames = () => (icons ??= [...new Set(getIconIds().map((n) => n.replace(/^lucide-/, "")))].sort());

// a folder doc's editor: the one already open, else read from the folder
let ref: { plugin: Plugin; host: () => VellumHost } | null = null;
async function folderEditor(dir: string): Promise<Editor | undefined> {
    if (!ref) return undefined;
    const ex = editors.get(`vellum:${dir}`); if (ex) return ex;
    const store = new FolderStore(ref.plugin.app, dir);
    return new Editor(ref.plugin, ref.host(), "", undefined, undefined, store, await store.load());
}
// open the editor on a folder of screens (its own window on a computer, the full screen on a phone); the folder is made on
// the first save
export function refreshLook() { if (ref) for (const ed of editors.values()) ed.relook(ref.host()); }
export async function openVellum(dir: string, page?: string): Promise<void> { (await folderEditor(dir))?.openWs(page); }

// host: the look (colours, fonts, block kinds); a function is read each time a block is drawn (settings may change)
export function registerVellum(plugin: Plugin, host: VellumHost | (() => VellumHost) = {}): void {
    ref = { plugin, host: () => (typeof host === "function" ? host() : host) };
    // a picture's vault path: the file's own address (it changes when the file does), else the path as the adapter has it
    const vault = plugin.app.vault;
    setPictureResolver((src) => { const path = normalizePath(src), f = vault.getAbstractFileByPath(path); return f instanceof TFile ? vault.getResourcePath(f) : vault.adapter.getResourcePath(path); });
    // collapse icons: Obsidian's own sidebar frame and divider, without its little lines (so both states are the same width)
    const frame = (x: number) => `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3H3C1.89543 3 1 3.89543 1 5V19C1 20.1046 1.89543 21 3 21H21C22.1046 21 23 20.1046 23 19V5C23 3.89543 22.1046 3 21 3Z"/><path d="M${x} 4V20"/></g>`;
    addIcon("vellum-side-left", frame(7));    // the line near the edge: the sidebar is folded in (a click opens it)
    addIcon("vellum-side-right", frame(17));
    plugin.registerView(VIEW, (leaf: WorkspaceLeaf) => new VellumWindow(leaf));
    plugin.registerMarkdownCodeBlockProcessor("vellum", async (source, el, ctx) => {
        const h = typeof host === "function" ? host() : host, dir = srcOf(source);
        if (!dir) { new Editor(plugin, h, source, el, ctx); return; }
        const store = new FolderStore(plugin.app, dir);
        new Editor(plugin, h, source, el, ctx, store, await store.load());
    });
    // a doc kept in a folder: changes made outside (the agent, a sync) are read again, a moment after the last one
    const due = new Map<Editor, number>();
    const touched = (path: string) => {
        for (const ed of live) {
            const st = ed.store;
            if (!st || !st.watches(path) || Date.now() < st.ownUntil) continue;
            window.clearTimeout(due.get(ed));
            due.set(ed, window.setTimeout(() => { due.delete(ed); void ed.outside(); }, 400));
        }
    };
    const v = plugin.app.vault;
    for (const ev of ["create", "modify", "delete"] as const) plugin.registerEvent(v.on(ev as "modify", (f) => touched(f.path)));
    plugin.registerEvent(v.on("rename", (f, old) => { touched(f.path); touched(old); }));
}
