import { addIcon, App, FuzzySuggestModal, getIconIds, ItemView, MarkdownPostProcessorContext, MarkdownRenderChild, normalizePath, Notice, Platform, Plugin, setIcon, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { customDevice, deviceOf, DEVICES, screenOf } from "./devices";
import { axes, bgOf, Block, childrenOf, cloneItem, Doc, drawnBlocks, findItem, frameOf, GRAVITIES, subtreeOf, Item, ItemType, Layer, layersOf, newItem, Page, parseDoc, serialiseDoc, Size, uid } from "./model";
import { BASE_KINDS, BASE_THEME, colorOf, drawItem, Kind, pictureUrl, setPictureResolver, Theme } from "./render";
import { FolderStore, srcOf } from "./store";

// The Vellum editor in a ```vellum block. Desktop first (the phone checks): the pages as phones side by side; a tap on the
// screen chooses the page, on a block the block, on an item the item; drag moves it (blocks by x / y, items by their offset
// from their gravity point), a block's corner resizes it; the panel shows only what is chosen, as controls (no syntax).
// Keys: arrows nudge 1 px (shift 4), Delete, Ctrl+Z / Ctrl+Shift+Z, Ctrl+D duplicate, Ctrl+S save, Esc goes up a level.
// Unsaved work is kept on the device (localStorage) until saved into the note.
export interface VellumHost { theme?: Partial<Theme>; kinds?: Kind[] }

// snapping while dragging / resizing: to the grid, and (on) to the edges and middles of the frame (an item's block, a
// block's screen and safe area), margin lines inside it and the other items / blocks; Alt: none (1 px). Set in the plugin's
// settings; the magnet in the pill turns it on and off
export interface SnapCfg { on: boolean; dist: number; grid: number; margins: number[]; frame: boolean; others: boolean; guides: boolean }
export const SNAP_DEFAULT: SnapCfg = { on: true, dist: 6, grid: 4, margins: [16], frame: true, others: true, guides: true };
let snap: SnapCfg = { ...SNAP_DEFAULT }, keepSnap = () => {};
export const setSnap = (c: SnapCfg, save: () => void) => { snap = c; keepSnap = save; };
const grid = () => Math.max(1, snap.grid || 1);
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
type Sel = { page: string; block?: string; item?: string } | null;
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

class Editor {
    doc: Doc; saved: string; past: string[] = []; future: string[] = []; sel: Sel = null; pending: string | null = null;
    wall!: HTMLElement; panel: HTMLElement | null = null; theme: Theme; kinds: Kind[];
    tab: "style" | "place" | "note" = "style";
    // store: the folder the doc is kept in (src: in the block), with the doc as read; none = the JSON in the block itself
    // el / ctx: the ```vellum block it is drawn in; none = opened straight on a folder (the ribbon, a command)
    constructor(readonly plugin: Plugin, host: VellumHost, source: string, readonly el: HTMLElement | undefined, readonly ctx: MarkdownPostProcessorContext | undefined, readonly store?: FolderStore, loaded?: { doc: Doc; error?: string }) {
        this.theme = { colors: { ...BASE_THEME.colors, ...host.theme?.colors }, fonts: { ...BASE_THEME.fonts, ...host.theme?.fonts } };
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
    paint(e: HTMLElement) { for (const c of Object.keys(this.theme.colors)) e.style.setProperty(`--vl-${c}`, this.theme.colors[c]); for (const ev of ["pointerdown", "mousedown", "click", "touchstart", "dblclick"]) e.addEventListener(ev, (x) => x.stopPropagation()); }

    // ---- state, undo, drafts, save
    get v(): View { return view.get(this.doc.id) ?? { zoom: 0.75, fit: true, show: false, rail: !Platform.isMobile && window.innerWidth >= 1000 }; }
    setView(p: Partial<View>) { view.set(this.doc.id, { ...this.v, ...p }); }
    snap() { return JSON.stringify(this.doc); }
    get dirty() { return serialiseDoc(this.doc) !== this.saved; }
    draftKey() { return this.store ? `vellum:${this.store.dir}` : `vellum:${this.ctx!.sourcePath}:${this.doc.id}`; }
    draftGet() { try { return localStorage.getItem(this.draftKey()); } catch { return null; } }
    draftPut() { try { if (this.dirty) localStorage.setItem(this.draftKey(), JSON.stringify({ base: this.saved, doc: this.doc })); else if (!this.stale) localStorage.removeItem(this.draftKey()); } catch { /* private mode */ } }
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
        if (!was && this.dirty) this.hint("Unsaved: kept on this device until you save");
    }
    // a short note under the Save button for a few seconds (floats: nothing moves)
    hint(text: string) {
        const R = this.root; if (!R?.isConnected) return;
        R.querySelector(".vl-hint")?.remove();
        const sv = this.bar?.querySelector<HTMLElement>(".is-savebtn");
        const h = R.createDiv({ cls: "vl-hint", text });
        if (sv) { const rr = R.getBoundingClientRect(), sr = sv.getBoundingClientRect(); h.style.left = `${sr.right - rr.left}px`; h.style.top = `${sr.bottom - rr.top + 6}px`; h.style.transform = "translateX(-100%)"; }
        window.setTimeout(() => h.addClass("is-out"), 2200);
        window.setTimeout(() => h.remove(), 2600);
    }
    undo() { const s = this.past.pop(); if (!s) return; this.future.push(this.snap()); this.doc = JSON.parse(s); this.fixSel(); this.draftPut(); this.draw(); }
    redo() { const s = this.future.pop(); if (!s) return; this.past.push(this.snap()); this.doc = JSON.parse(s); this.fixSel(); this.draftPut(); this.draw(); }
    save() {
        if (this.store) {
            const text = serialiseDoc(this.doc), st = this.store;
            st.save(this.doc).then(() => {
                this.saved = text;
                try { localStorage.removeItem(this.draftKey()); } catch { /* */ }
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
            try { localStorage.removeItem(this.draftKey()); } catch { /* */ }
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
        const d = deviceOf(p.device ?? this.doc.device), up = screenOf(d, false), sd = screenOf(d, true);
        const roomUp = up.W - up.safe.left - up.safe.right, roomSd = sd.W - sd.safe.left - sd.safe.right;
        p.land = p.blocks.map((b) => {
            const c: Block = JSON.parse(JSON.stringify(b));
            const m = b.x - up.safe.left, wide = b.w >= roomUp - 2 * m - 4;
            c.x = sd.safe.left + m; c.w = wide ? Math.max(8, roomSd - 2 * m) : b.w;
            c.y = Math.max(sd.safe.top, b.y - up.safe.top);
            return c;
        });
    }); }
    // the blocks drawn on a page (its frame's under its own) in the layout on show; layer(): the chosen one among them
    layers(p: Page): Layer[] { return layersOf(this.doc.pages, p, this.land); }
    layer() { const p = this.page(); return p && this.sel?.block ? this.layers(p).find((l) => l.block.id === this.sel?.block) : undefined; }
    item() { const b = this.block(); return b && this.sel?.item ? findItem(b.items, this.sel.item) : null; }
    choose(s: Sel) { this.sel = s; this.drawPanel(); this.drawPages(); }
    fixSel() { if (!this.page()) this.sel = null; else if (this.sel?.block && !this.layer()) this.sel = { page: this.sel.page }; else if (this.sel?.item && !this.item()) this.sel = { page: this.sel!.page, block: this.sel!.block }; }

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
        if (Platform.isMobile) { if (!this.root?.isConnected) this.mount(document.body); else this.draw(); return; }
        const key = this.draftKey(), w = windows.get(key);
        if (w) { if (page) this.draw(); w.contentEl.win.focus(); return; }
        let size: { width: number; height: number } | undefined;
        try { size = JSON.parse(localStorage.getItem("vellum:winsize") ?? "") ?? undefined; } catch { /* */ }
        const leaf = this.plugin.app.workspace.openPopoutLeaf({ size: size ?? { width: 1280, height: 880 } });
        void leaf.setViewState({ type: VIEW, active: true, state: { key } });
    }
    mount(container: HTMLElement) {
        this.root?.remove();
        container.empty();
        const pop = container !== document.body;
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
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                    try { localStorage.setItem("vellum:winsize", JSON.stringify({ width: R.win.outerWidth, height: R.win.outerHeight })); } catch { /* */ }
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
        R.empty(); this.panel = null;
        this.bar = R.createDiv({ cls: "vl-top" });
        this.drawStale();
        const body = R.createDiv({ cls: "vl-body" });
        this.rail = body.createDiv({ cls: "vl-rail" });
        this.rail.addEventListener("click", (e) => { if (e.target === this.rail) { this.setView({ rail: false }); this.draw(); } });   // phone: a tap on the dim closes the list
        const mid = body.createDiv({ cls: "vl-mid" });
        this.wall = mid.createDiv({ cls: "vl-stage" });
        this.wall.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
        this.wall.addEventListener("click", (e) => { if (e.target === this.wall && this.sel) this.choose(null); });   // a tap beside the phone lets go
        this.zbar = mid.createDiv({ cls: "vl-zbar" });
        this.side = Platform.isMobile ? R : body;
        this.drawPanel(); this.drawPages();
    }
    zbar!: HTMLElement; rail!: HTMLElement; side!: HTMLElement;
    // unsaved work from before the note changed: offered back, never applied by itself
    drawStale() {
        if (!this.stale || !this.root) return;
        const s = this.root.createDiv({ cls: "vl-stale" });
        s.createSpan({ text: "The note changed since your unsaved edits on this device. The note is shown." });
        const keep = s.createEl("button", { text: "Restore my edits" });
        keep.addEventListener("click", () => { const d = this.stale!; this.stale = null; this.edit(() => { this.doc = d; }); this.draw(); });
        const drop = s.createEl("button", { text: "Drop them" });
        drop.addEventListener("click", () => { this.stale = null; try { localStorage.removeItem(this.draftKey()); } catch { /* */ } this.draw(); });
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
        if (Platform.isMobile) this.btn(l, "x", "Close the editor (Esc)", () => this.closeWs()).addClass("vl-x");
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
            this.btn(pill, "magnet", snap.on ? "Snapping on: to edges, middles and other items (Alt while dragging: off; details in Settings → Vellum)" : "Snapping off: the grid only", () => { snap.on = !snap.on; keepSnap(); this.drawZoom(); }).toggleClass("is-on", snap.on);
        }
        pill.createSpan({ cls: "vl-zsep" });
        this.btn(pill, "minus", "Zoom out (Ctrl+wheel)", () => this.zoomBy(1 / 1.25));
        pill.createSpan({ cls: "vl-zoom", text: `${Math.round((this.v.map ? this.v.mapZoom ?? 1 : this.v.zoom) * 100)}%` });
        this.btn(pill, "plus", "Zoom in (Ctrl+wheel)", () => this.zoomBy(1.25));
        const fitOn = this.v.map ? this.v.mapFit !== false : this.v.fit;
        const fit = pill.createEl("button", { cls: "vl-zfit" + (fitOn ? " is-on" : ""), text: "Fit", attr: { "aria-label": "Fit to the window" } });
        fit.addEventListener("click", () => { this.setView(this.v.map ? { mapFit: true } : { fit: true }); this.drawPages(); });
    }
    zoomBy(f: number) {
        if (this.v.map) this.setView({ mapFit: false, mapZoom: Math.min(3, Math.max(0.3, Math.round((this.v.mapZoom ?? 1) * f * 100) / 100)) });
        else this.setView({ fit: false, zoom: Math.min(4, Math.max(0.2, Math.round(this.v.zoom * f * 100) / 100)) });
        this.drawPages();
    }
    // a new main page, or one opened from a page
    addPage(parent?: Page) { this.edit(() => {
        const n: Page = { id: uid(), name: "New page", blocks: [{ id: uid(), name: "Title", kind: "nav", x: 16, y: 64, w: 370, h: 48, items: [{ id: uid(), type: "text", v: "Title", size: 30, wt: 800, font: "display", g: "l", dx: 0 }] }] };
        const pages = this.doc.pages;
        if (parent) { n.parent = parent.id; pages.splice(pages.indexOf(parent) + 1, 0, n); } else pages.push(n);
        this.sel = { page: n.id }; this.setView({ page: n.id });
    }); this.draw(); }
    btn(parent: HTMLElement, icon: string, label: string, act: () => void, off = false) {
        const x = parent.createEl("button", { cls: "vl-btn" + (off ? " is-off" : ""), attr: { "aria-label": label } });
        setIcon(x, icon);
        x.addEventListener("click", () => { if (!off) act(); });
        return x;
    }
    drawPages() {
        if (!this.wall?.isConnected) return;
        this.wall.empty();
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
            this.drawZoom();
            return;
        }
        const cur = this.current();
        if (cur) {
            // fit: the whole phone in the stage, the pill and a margin kept clear
            if (this.v.fit) {
                const dev = deviceOf(cur.device ?? this.doc.device), { W, H } = screenOf(dev, this.land);
                const ph = Platform.isMobile; const sw = this.wall.clientWidth - (ph ? 44 : 64), sh = this.wall.clientHeight - (ph ? 100 : 120);
                if (sw > 0 && sh > 0) view.set(this.doc.id, { ...this.v, zoom: Math.max(0.2, Math.min(2, Math.floor(Math.min(sw / W, sh / H) * 100) / 100)) });
            }
            this.drawPage(cur);
        }
        this.drawZoom();
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
            r.style.width = `${Number(localStorage.getItem("vellum:railW")) || 248}px`;
            const g = r.createDiv({ cls: "vl-rgrip" });
            g.addEventListener("pointerdown", (e) => {
                e.preventDefault(); g.setPointerCapture(e.pointerId); g.addClass("is-on");
                const x0 = e.clientX, w0 = r.offsetWidth;
                const tw0 = this.picW(w0);
                // the pictures grow with the width while dragging (scaled), drawn again at their new size on release
                const mv = (m: PointerEvent) => { const w = Math.min(560, Math.max(180, w0 + m.clientX - x0)); r.style.width = `${w}px`; r.style.setProperty("--vl-pz", String(this.picW(w) / tw0)); };
                const up = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeClass("is-on"); try { localStorage.setItem("vellum:railW", String(r.offsetWidth)); } catch { /* */ } r.style.removeProperty("--vl-pz"); this.drawPages(); };
                g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up);
            });
        }
        const box = r.createDiv({ cls: "vl-railbox" });
        box.addEventListener("scroll", () => this.unpeek(), { passive: true });
        box.addEventListener("mouseleave", () => this.unpeek());
        const pics = localStorage.getItem("vellum:pics") === "1";
        const hd = box.createDiv({ cls: "vl-railhead" });
        hd.createDiv({ cls: "vl-sech", text: `Screens · ${this.doc.pages.length}` });
        this.btn(hd, "image", pics ? "Hide the pictures" : "Show a picture of each screen", () => { try { localStorage.setItem("vellum:pics", pics ? "0" : "1"); } catch { /* */ } this.drawRail(); }).toggleClass("is-on", pics);
        // the tree: main screens at the left, each screen's sub screens under it on guide lines; a chevron folds a branch;
        // each row has a small picture of its screen
        const list = box.createDiv({ cls: "vl-plist" });
        const pages = this.doc.pages, cur = this.current(), seen = new Set<string>(), fold = this.folds();
        const row = (p: Page, depth: number) => {
            if (seen.has(p.id)) return; seen.add(p.id);
            const kids = childrenOf(pages, p.id).filter((c) => !seen.has(c.id));
            const w = list.createDiv({ cls: "vl-prow" + (p.id === cur?.id ? " is-on" : "") + (p.mock ? " is-mock" : "") });
            const ind = w.createDiv({ cls: "vl-pind" });
            for (let i = 0; i < depth; i++) ind.createSpan({ cls: "vl-pguide" });
            if (kids.length) {
                const ch = w.createEl("button", { cls: "vl-pchev", attr: { "aria-label": fold.has(p.id) ? "Unfold" : "Fold" } });
                setIcon(ch, fold.has(p.id) ? "chevron-right" : "chevron-down");
                ch.addEventListener("click", (e) => { e.stopPropagation(); if (fold.has(p.id)) fold.delete(p.id); else fold.add(p.id); this.keepFolds(fold); this.drawRail(); });
            } else w.createSpan({ cls: "vl-pchev is-leaf" });
            if (pics) w.appendChild(this.thumb(p));
            this.peekOn(w, p);
            const t = w.createDiv({ cls: "vl-ptext" });
            t.createDiv({ cls: "vl-pn", text: p.name + (p.mock ? " · mock" : "") });
            if (p.link) t.createDiv({ cls: "vl-pl", text: p.link });
            w.addEventListener("click", () => this.openPage(p));
            const add = this.btn(w, "plus", `Add a screen opened from ${p.name}`, () => this.addPage(p));
            add.addClass("vl-padd"); add.addEventListener("click", (e) => e.stopPropagation());
            if (!fold.has(p.id)) for (const c of kids) row(c, depth + 1);
            else for (const c of subtreeOf(pages, p.id)) if (c !== p.id) seen.add(c);
        };
        for (const p of childrenOf(pages)) row(p, 0);
        for (const p of pages) row(p, 0);   // anything left (a loop) as a main page
        const na = box.createEl("button", { cls: "vl-act vl-newp" }); setIcon(na.createSpan(), "plus"); na.appendText("New screen");
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
    peek(p: Page, row: HTMLElement) {
        const R = this.root; if (!R?.isConnected) return;
        this.unpeek();
        const W = Platform.isMobile ? Math.min(300, R.clientWidth * 0.72) : 240;
        const box = R.createDiv({ cls: "vl-peek" });
        box.createDiv({ cls: "vl-peekname", text: p.name });
        box.appendChild(this.pic(p, W));
        const rr = R.getBoundingClientRect(), wr = row.getBoundingClientRect(), br = this.rail.getBoundingClientRect();
        if (Platform.isMobile) { box.style.left = `${(rr.width - W) / 2 - 8}px`; box.style.top = `${Math.max(56, (rr.height - box.offsetHeight) / 2)}px`; }
        else { box.style.left = `${br.right - rr.left + 10}px`; box.style.top = `${Math.max(8, Math.min(rr.height - box.offsetHeight - 8, wr.top - rr.top - 40))}px`; }
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
    folds(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(`vellum:fold:${this.draftKey()}`) ?? "[]")); } catch { return new Set(); } }
    keepFolds(f: Set<string>) { try { localStorage.setItem(`vellum:fold:${this.draftKey()}`, JSON.stringify([...f])); } catch { /* */ } }
    // a screen as a small picture (the rail's rows): drawn again only when the screen changed
    thumbs = new Map<string, { sig: string; el: HTMLElement }>();
    thumb(p: Page): HTMLElement {
        const tw = this.picW(this.rail?.offsetWidth || Number(localStorage.getItem("vellum:railW")) || 248);
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
        const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "vl-maplines"); svg.setAttribute("width", String(x * slotW)); svg.setAttribute("height", String((depthMax + 1) * rowH - GAP + 4));
        box.appendChild(svg);
        const at = (p: Page) => { const q = pos.get(p.id)!, d = dims(p); return { cx: q.x * slotW + slotW / 2, top: q.y * rowH, h: d.h }; };
        for (const p of pages) {
            const par = pages.find((q) => q.id === p.parent);
            if (!par || !pos.has(par.id)) continue;
            // from under the parent's name, down, across, down to the sub page (its link label sits just above it)
            const a = at(par), b = at(p);
            const y0 = a.top + a.h + 26, midY = y0 + 8;
            const path = document.createElementNS(NS, "path");
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
        const dev = deviceOf(p.device ?? this.doc.device), { W, H, safe } = screenOf(dev, this.land), z = this.v.zoom, show = this.v.show;
        const fig = this.wall.createDiv({ cls: "vl-page" + (p.mock ? " is-mock" : "") + (this.sel?.page === p.id ? " is-sel" : "") });
        fig.createDiv({ cls: "vl-pname", text: p.name + (p.mock ? "  · mock" : "") });
        const phone = fig.createDiv({ cls: "vl-phone" });
        phone.style.width = `${W * z}px`; phone.style.height = `${H * z}px`; phone.style.borderRadius = `${dev.radius * z}px`;
        const scr = phone.createDiv({ cls: "vl-screen" + (show ? " is-show" : "") });
        const bg = bgOf(this.doc.pages, p);
        if (bg) { scr.style.background = colorOf(this.theme, bg); phone.style.background = scr.style.background; }
        Object.assign(scr.style, { width: `${W}px`, height: `${H}px`, transform: `scale(${z})`, borderRadius: `${dev.radius}px` });
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
        for (const l of layers) this.drawBlock(scr, p, l.block, show, show ? undefined : l);
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
        const el = scr.createDiv({ cls: "vl-block" + (sel ? " is-sel" : "") + (inh ? " is-inh" : "") + (l?.over ? " is-over" : ""), attr: { "data-block": b.id } });
        Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
        el.style.setProperty("--k", kind?.color ?? "var(--text-faint)");
        if (!show) {
            const tag = el.createDiv({ cls: "vl-tag" });
            if (inh) setIcon(tag.createSpan({ cls: "vl-tagi" }), "lock");
            tag.appendText(b.name + (inh ? ` · ${this.page(l!.from)?.name ?? "frame"}` : ""));
        }
        for (const it of b.items) drawItem(this.theme, el, it);
        if (l?.over && !show) setIcon(el.createDiv({ cls: "vl-overmark", attr: { "aria-label": `Overrides ${this.page(l.over)?.name ?? "the frame"}'s ${b.name}` } }), "layers-2");
        if (sel && inh) { /* locked: no grip, no items to choose */ }
        else if (sel) {
            const id = this.sel?.item;
            if (id) {
                el.querySelector(`[data-id="${id}"]`)?.addClass("is-sel");
                const it = findItem(b.items, id)?.item;
                // the gravity point the item keeps, on the block
                if (it && b.items.includes(it)) { const [ax, ay] = axes(it.g); const d = el.createDiv({ cls: "vl-anchor" }); d.style.left = `${(ax + 1) * 50}%`; d.style.top = `${(ay + 1) * 50}%`; }
                if (it && b.items.includes(it) && RESIZE.includes(it.type)) this.itemGrips(el, b, it);
            } else el.createDiv({ cls: "vl-grip", attr: { "data-grip": "1" } });
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
        const x: number[] = [], y: number[] = [];
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
    blockLines(p: Page, b: Block): Lines {
        const { W, H, safe } = screenOf(deviceOf(p.device ?? this.doc.device), this.land), x: number[] = [], y: number[] = [];
        if (snap.frame) {
            const l = safe.left, r = W - safe.right, t = safe.top, bo = H - safe.bottom;
            x.push(0, W / 2, W, l, r); y.push(0, H / 2, H, t, bo);
            for (const m of snap.margins) { x.push(l + m, r - m); y.push(t + m, bo - m); }
        }
        if (snap.others) for (const { block: o } of this.layers(p)) {
            if (o.id === b.id) continue;
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
        const t = e.target as HTMLElement;
        const bEl = t.closest<HTMLElement>("[data-block]"), b = bEl ? this.blocks(p).find((x) => x.id === bEl.dataset.block) : undefined;
        const grip = !!t.closest("[data-grip]");
        const itEl = t.closest<HTMLElement>(".vl-it");
        // an item inside a row moves with its row: the drag takes the top-level item, the tap chooses the inner one
        const topEl = t.closest<HTMLElement>("[data-top]");
        const pickId = itEl?.dataset.id, dragId = topEl?.dataset.id;
        const before = this.sel;
        if (!b) {
            // a frame's block (locked here): chosen, to override it or go and edit it in its page
            const l = bEl ? this.layers(p).find((x) => x.block.id === bEl.dataset.block) : undefined;
            this.choose(l ? { page: p.id, block: l.block.id } : { page: p.id });
            return;
        }
        const ig = t.closest<HTMLElement>("[data-igrip]");
        if (ig && this.sel?.item && this.sel.block === b.id) { this.resizeItem(e, p, b, scr, ig.dataset.igrip as "bl" | "br"); return; }
        // first tap on a block chooses the block; an item is chosen once its block is (or straight away with a double tap)
        const blockChosen = before?.page === p.id && before.block === b.id;
        const target: Sel = pickId && blockChosen ? { page: p.id, block: b.id, item: pickId } : { page: p.id, block: b.id };
        const dragItem = target?.item ? findItem(b.items, dragId!)?.item : undefined;
        const x0 = e.clientX, y0 = e.clientY, z = this.v.zoom, start = { ...b }, istart = dragItem ? { dx: dragItem.dx ?? 0, dy: dragItem.dy ?? 0 } : null;
        let moved = false;
        // what the drag snaps to, measured once as it starts (the rest stays put): the item's box and its block's lines,
        // or the block's lines on the screen
        let ib: { L: number; T: number; W: number; H: number } | null = null, lines: Lines = { x: [], y: [] };
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            const dx = (m.clientX - x0) / z, dy = (m.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            if (!moved) {
                moved = true; this.begin();
                const be = scr.querySelector<HTMLElement>(`[data-block="${b.id}"]`);
                if (dragItem && be) { ib = this.itemBox(be, b, dragItem); lines = this.itemLines(be, b, dragItem); } else lines = this.blockLines(p, b);
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
            this.redrawBlock(scr, p, b);
            this.guides(scr, gx.map((v) => v + ox), gy.map((v) => v + oy));
            this.livePanel();
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
            this.guides(scr);
            if (moved) { this.end(); return; }
            const again = target?.item && before?.item === target.item;
            this.choose(target);
            if (again && Platform.isMobile) this.writeItem(b, target!.item!);
        };
        scr.addEventListener("pointermove", move); scr.addEventListener("pointerup", up); scr.addEventListener("pointercancel", up);
    }

    typeInPlace(e: MouseEvent, p: Page) {
        const at = (this.root?.doc ?? document).elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const itEl = at?.closest<HTMLElement>(".vl-it"), bEl = at?.closest<HTMLElement>("[data-block]");
        const b = bEl ? this.blocks(p).find((x) => x.id === bEl.dataset.block) : undefined;
        const f = b && itEl?.dataset.id ? findItem(b.items, itEl.dataset.id) : null;
        if (!b || !f) return;
        this.choose({ page: p.id, block: b.id, item: f.item.id });
        if (f.item.type !== "text") return;
        if (Platform.isMobile) { this.writeItem(b, f.item.id); return; }
        const el = (this.wall ?? document).querySelector<HTMLElement>(`.vl-it[data-id="${f.item.id}"]`);
        if (!el) return;
        el.contentEditable = "true";
        el.addClass("is-typing");
        el.focus();
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
        if (typing) return false;
        if (mod && k === "z") { if (e.shiftKey) this.redo(); else this.undo(); return true; }
        if (mod && k === "y") { this.redo(); return true; }
        if (mod && k === "d") { this.duplicate(); return true; }
        if (e.key === "Escape" && !this.sel) { this.closeWs(); return true; }
        if (e.key === "Escape") { const s = this.sel; this.choose(s?.item ? { page: s.page, block: s.block } : s?.block ? { page: s.page } : null); return true; }
        if (e.key === "Delete" || e.key === "Backspace") { this.remove(); return true; }
        const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
        if (d && this.sel?.block) { this.nudge(d[0] * (e.shiftKey ? grid() : 1), d[1] * (e.shiftKey ? grid() : 1)); return true; }
        return false;
    }
    nudge(dx: number, dy: number) {
        const f = this.item(), b = this.block();
        this.edit(() => {
            if (f) { const [ax, ay] = axes(f.item.g); if (f.item.w !== "fill") f.item.dx = (f.item.dx ?? 0) + (ax > 0 ? -dx : dx); if (f.item.h !== "fill") f.item.dy = (f.item.dy ?? 0) + (ay > 0 ? -dy : dy); }
            else if (b) { b.x += dx; b.y += dy; }
        });
    }
    duplicate() {
        const f = this.item(), b = this.block(), p = this.page();
        if (this.sel?.block && !b) return;   // a frame's block: locked here
        if (f) this.edit(() => { const c = cloneItem(f.item); f.list.splice(f.list.indexOf(f.item) + 1, 0, c); this.sel = { ...this.sel!, item: c.id }; });
        else if (b && p) this.edit(() => { const c: Block = { ...JSON.parse(JSON.stringify(b)), id: uid(), y: b.y + b.h + 8 }; c.items = b.items.map(cloneItem); this.blocks(p).push(c); this.sel = { page: p.id, block: c.id }; });
        else if (p) this.edit(() => { const c: Page = { ...JSON.parse(JSON.stringify(p)), id: uid(), name: p.name + " copy" }; this.doc.pages.splice(this.doc.pages.indexOf(p) + 1, 0, c); this.sel = { page: c.id }; });
    }
    remove() {
        const f = this.item(), b = this.block(), p = this.page();
        if (f) this.edit(() => { f.list.splice(f.list.indexOf(f.item), 1); this.sel = { page: p!.id, block: b!.id }; });
        else if (b && p) this.edit(() => { const l = this.blocks(p); l.splice(l.indexOf(b), 1); this.sel = { page: p.id }; });
    }

    // ---- the panel: only what is chosen, as controls
    drawPanel() {
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
            const pw = Number(localStorage.getItem("vellum:panelW")) || 300;
            P.style.width = `${pw}px`;
            const g = P.createDiv({ cls: "vl-pgrip" });
            g.addEventListener("pointerdown", (e) => {
                e.preventDefault(); g.setPointerCapture(e.pointerId); g.addClass("is-on");
                const x0 = e.clientX, w0 = P.offsetWidth;
                const mv = (m: PointerEvent) => { P.style.width = `${Math.min(600, Math.max(240, w0 - (m.clientX - x0)))}px`; };
                const up = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeClass("is-on"); try { localStorage.setItem("vellum:panelW", String(P.offsetWidth)); } catch { /* */ } if (this.v.fit) this.drawPages(); };
                g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up);
            });
        }
        const b = this.block(), f = this.item(), inh = !b ? this.layer() : undefined;
        // breadcrumb: page › block › item, each a way back up
        const head = P.createDiv({ cls: "vl-crumb" });
        const crumb = (text: string, s: Sel, on: boolean) => { const c = head.createEl("button", { text, cls: on ? "is-on" : "" }); c.addEventListener("click", () => this.choose(s)); };
        crumb(p.name, { page: p.id }, !b);
        if (b) { head.createSpan({ text: "›" }); crumb(b.name, { page: p.id, block: b.id }, !f); }
        else if (inh) { head.createSpan({ text: "›" }); crumb(inh.block.name, { page: p.id, block: inh.block.id }, true); }
        if (f) { head.createSpan({ text: "›" }); crumb(label(f.item), this.sel, true); }
        if (this.sel) this.btn(head, "x", "Let go (Esc)", () => this.choose(null)).addClass("vl-close");
        const body = P.createDiv({ cls: "vl-pbody" });
        if (f && b) this.itemPanel(body, b, f.item, b.items.includes(f.item));
        else if (b) this.blockPanel(body, p, b);
        else if (inh) this.framePanel(body, p, inh);
        else this.pagePanel(body, p);
        body.scrollTop = this.keepTop; this.keepTop = 0;
    }
    keepTop = 0;
    // while dragging: only the numbers change (the panel stays as it is)
    liveText = new Map<HTMLElement, () => string>();   // numbers shown as text (the gaps) kept live while dragging too
    livePanel() { for (const [el, g] of this.liveText) if (el.isConnected) el.setText(g()); else this.liveText.delete(el); this.panel?.querySelectorAll<HTMLInputElement>("input[data-live]").forEach((i) => { const g = this.getters.get(i); if (g && i.doc.activeElement !== i) i.value = String(g()); }); }
    getters = new Map<HTMLInputElement, () => number | string>();

    // controls
    section(parent: HTMLElement, title: string) { const s = parent.createDiv({ cls: "vl-sec" }); s.createDiv({ cls: "vl-sech", text: title }); return s.createDiv({ cls: "vl-secb" }); }
    // a number: type it, or drag its label sideways to scrub; live while it changes, one undo step for the whole change
    num(parent: HTMLElement, name: string, get: () => number, set: (v: number) => void, o: { step?: number; min?: number; max?: number } = {}) {
        const w = parent.createDiv({ cls: "vl-num" });
        const l = w.createSpan({ cls: "vl-numl", text: name });
        const i = w.createEl("input", { attr: { type: "number", step: String(o.step ?? 1), "data-live": "1" } });
        i.value = String(get());
        this.getters.set(i, get);
        const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
        const apply = (v: number) => { set(clamp(Math.round(v / (o.step ?? 1)) * (o.step ?? 1))); this.draftPut(); this.drawPages(); this.drawBar(); };
        i.addEventListener("focus", () => this.begin());
        i.addEventListener("input", () => { if (i.value !== "" && !Number.isNaN(Number(i.value))) apply(Number(i.value)); });
        i.addEventListener("blur", () => { this.end(); i.value = String(get()); });
        i.addEventListener("keydown", (k) => { if (k.key === "Enter") i.blur(); });
        l.addEventListener("pointerdown", (e) => {
            e.preventDefault(); this.begin();
            const x0 = e.clientX, v0 = get();
            l.setPointerCapture(e.pointerId);
            const mv = (m: PointerEvent) => { apply(v0 + Math.round((m.clientX - x0) / 3) * (o.step ?? 1)); i.value = String(get()); };
            const up = () => { l.removeEventListener("pointermove", mv); l.removeEventListener("pointerup", up); this.end(); };
            l.addEventListener("pointermove", mv); l.addEventListener("pointerup", up);
        });
        return w;
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
        document.querySelector(".vl-writer")?.remove();
        const dim = document.body.createDiv({ cls: "vl-writer" });
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
    colors(parent: HTMLElement, on: string | undefined, pick: (v: string) => void, none = false) {
        const names = Object.keys(this.theme.colors);
        const opts: [string, string][] = [...(none ? [["none", "none"] as [string, string]] : []), ...names.map((n) => [n, n] as [string, string])];
        const g = this.chips(parent, opts, on ?? (none ? "none" : undefined), pick, (v) => colorOf(this.theme, v), true);
        const hex = g.createEl("input", { cls: "vl-hex", attr: { type: "text", placeholder: "#hex", value: on && !names.includes(on) && on !== "none" ? on : "" } });
        hex.addEventListener("change", () => { if (/^#[0-9a-f]{3,8}$/i.test(hex.value.trim())) this.edit(() => pick(hex.value.trim())); });
    }
    actions(parent: HTMLElement, list: [string, string, () => void][]) {
        const g = parent.createDiv({ cls: "vl-acts" });
        for (const [icon, text, act] of list) { const x = g.createEl("button", { cls: "vl-act" }); setIcon(x.createSpan(), icon); x.appendText(text); x.addEventListener("click", act); }
    }

    pagePanel(body: HTMLElement, p: Page) {
        const s = this.section(body, "Page");
        this.text(s, () => p.name, (v) => { p.name = v; }, { title: "Page name" });
        this.chips(s, [["real", "Real screen: as built", "badge-check"], ["mock", "Mock: a proposal to pick", "lightbulb"]], p.mock ? "mock" : "real", (v) => { if (v === "mock") p.mock = true; else delete p.mock; });
        // with a frame: its colour unless the page sets its own
        const fr = frameOf(this.doc.pages, p), was = (fr && bgOf(this.doc.pages, fr)) || "paper";
        this.colors(this.section(body, "Screen colour"), p.bg ?? was, (v) => { if (v === was) delete p.bg; else p.bg = v; });
        const st = this.section(body, "Opened from");
        const under = subtreeOf(this.doc.pages, p.id);
        const sel = st.createEl("select", { cls: "dropdown vl-select" });
        sel.createEl("option", { value: "", text: "Nothing: a main screen" });
        for (const q of this.doc.pages) if (!under.has(q.id)) sel.createEl("option", { value: q.id, text: q.name });
        sel.value = p.parent ?? "";
        sel.addEventListener("change", () => this.edit(() => { if (sel.value) p.parent = sel.value; else { delete p.parent; delete p.link; delete p.inherit; } }));
        if (p.parent) this.text(st, () => p.link ?? "", (v) => { if (v.trim()) p.link = v; else delete p.link; }, { placeholder: "How you get there: tap a row, + button…" });
        // a frame: the parent's blocks drawn under this page's own (a layout template); the page keeps only its own and overrides
        const par = this.page(p.parent);
        if (par) this.chips(st, [["own", "Own blocks only"], ["frame", `On ${par.name}'s frame`]], p.inherit ? "frame" : "own", (v) => { if (v === "frame") p.inherit = true; else delete p.inherit; });
        const n = this.section(body, "Note");
        this.text(n, () => p.note ?? "", (v) => { if (v.trim()) p.note = v; else delete p.note; }, { area: true, placeholder: "What this page is for" });
        const a = this.section(body, "Add a block");
        const g = a.createDiv({ cls: "vl-chips is-icons" });
        for (const k of this.kinds) {
            const c = this.kindChip(g, k, false);
            c.addEventListener("click", () => this.edit(() => {
                const dev = deviceOf(p.device ?? this.doc.device), { W, safe } = screenOf(dev, this.land);
                const low = drawnBlocks(this.doc.pages, p, this.land).reduce((m, x) => Math.max(m, x.y + x.h), safe.top);
                const nb: Block = { id: uid(), name: k.name.split(" / ")[0], kind: k.id, x: 16 + safe.left, y: low + 8, w: W - 32 - safe.left - safe.right, h: 80, items: [] };
                this.blocks(p, true).push(nb); this.sel = { page: p.id, block: nb.id };
            }));
        }
        if (this.land && p.land) this.actions(body, [["trash", "Remove the landscape layout", () => this.edit(() => { delete p.land; this.sel = { page: p.id }; })]]);
        else if (this.land && p.blocks.length) this.actions(body, [["rectangle-horizontal", "Make landscape from portrait", () => this.makeLand(p)]]);
        this.actions(body, [["copy", "Duplicate page", () => this.duplicate()], ["trash-2", "Delete page", () => this.edit(() => { this.doc.pages.splice(this.doc.pages.indexOf(p), 1); this.sel = null; })]]);
    }
    blockPanel(body: HTMLElement, p: Page, b: Block) {
        const s = this.section(body, "Block");
        this.text(s, () => b.name, (v) => { b.name = v; }, { title: "Block name" });
        const g = s.createDiv({ cls: "vl-chips is-icons" });
        for (const k of this.kinds) this.kindChip(g, k, k.id === b.kind).addEventListener("click", () => this.edit(() => { b.kind = k.id; }));
        // an override: the frame's block it takes the place of, and the way back to it
        const l = this.layers(p).find((x) => x.block === b);
        if (l?.over) {
            const o = this.section(body, "Override");
            o.createDiv({ cls: "vl-frameinfo", text: `Takes the place of ${this.page(l.over)?.name ?? "the frame"}'s ${b.name} on this screen.` });
            this.actions(o, [["undo-2", "Back to the frame", () => this.edit(() => { const own = this.blocks(p); own.splice(own.indexOf(b), 1); this.sel = { page: p.id, block: b.id }; })]]);
        }
        this.placeTool(this.section(body, "Place"), p, b);
        const it = this.section(body, "Items");
        this.itemList(it, b, b.items);
        this.addButtons(it, b, b.items, ["text", "rect", "ellipse", "line", "img", "icon", "row", "col"]);
        const n = this.section(body, "Note");
        this.text(n, () => b.note ?? "", (v) => { if (v.trim()) b.note = v; else delete b.note; }, { area: true, placeholder: "What goes here, what is wrong (for the agent)" });
        this.actions(body, [["copy", "Duplicate", () => this.duplicate()], ["trash-2", "Delete", () => this.remove()]]);
    }
    // a frame's block on a page that inherits it: locked here; copy it in to change it here, or edit it where it belongs
    framePanel(body: HTMLElement, p: Page, l: Layer) {
        const owner = this.page(l.from), s = this.section(body, "From the frame");
        s.createDiv({ cls: "vl-frameinfo", text: `${l.block.name} belongs to ${owner?.name ?? "the frame"}: drawn here under this screen's own blocks, locked. Override it to change it on this screen only.` });
        const acts: [string, string, () => void][] = [["copy-plus", "Override here", () => this.edit(() => {
            const c = JSON.parse(JSON.stringify(l.block)) as Block;   // the same id (and items): it takes the frame block's place
            this.blocks(p, true).push(c); this.sel = { page: p.id, block: c.id };
        })]];
        if (owner) acts.push(["arrow-up-right", `Edit in ${owner.name}`, () => { this.setView({ page: owner.id }); this.sel = { page: owner.id, block: l.block.id }; if (Platform.isMobile) this.setView({ rail: false }); this.draw(); }]);
        this.actions(body, acts);
    }
    // where a block sits: align it in the screen's room (inside the safe areas), its size in the middle, its distance to
    // each edge around it; a distance chosen is changed by the stepper under it
    gapSide: "l" | "t" | "r" | "b" = "l";
    placeTool(pl: HTMLElement, p: Page, b: Block) {
        const dev = deviceOf(p.device ?? this.doc.device), { W, H, safe } = screenOf(dev, this.land);
        const room = { l: safe.left, t: safe.top, r: W - safe.right, b: H - safe.bottom };
        const gap = { l: () => b.x - room.l, r: () => room.r - b.x - b.w, t: () => b.y - room.t, b: () => room.b - b.y - b.h };
        const setGap = (side: "l" | "t" | "r" | "b", d: number) => {
            if (side === "l") b.x = room.l + d; else if (side === "r") b.x = room.r - b.w - d;
            else if (side === "t") b.y = room.t + d; else b.y = room.b - b.h - d;
        };
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
        // the box: distances around, the size in the middle
        const box = pl.createDiv({ cls: "vl-gbox" });
        const side = (k: "l" | "t" | "r" | "b", name: string) => {
            const x = box.createEl("button", { cls: `vl-gap is-${k}` + (this.gapSide === k ? " is-on" : ""), text: String(gap[k]()), attr: { "aria-label": `${name} gap` } });
            this.liveText.set(x, () => String(gap[k]()));
            x.addEventListener("click", () => { this.gapSide = k; this.drawPanel(); });
        };
        side("t", "Top"); side("l", "Left"); side("r", "Right"); side("b", "Bottom");
        const mid = box.createDiv({ cls: "vl-gsize" });
        const dim = (get: () => number, set: (v: number) => void, label: string) => {
            const i = mid.createEl("input", { attr: { type: "number", min: "8", "aria-label": label, "data-live": "1" } });
            i.value = String(get()); this.getters.set(i, get);
            i.addEventListener("focus", () => this.begin());
            i.addEventListener("input", () => { const v = Number(i.value); if (v >= 8) { set(Math.round(v)); this.draftPut(); this.drawPages(); } });
            i.addEventListener("blur", () => { this.end(); this.drawPanel(); });
            i.addEventListener("keydown", (k) => { if (k.key === "Enter") i.blur(); });
        };
        dim(() => b.w, (v) => { b.w = v; }, "Width");
        mid.createSpan({ text: "×" });
        dim(() => b.h, (v) => { b.h = v; }, "Height");
        // the stepper for the chosen side (Shift: 8 at a time)
        const names = { l: "Left", r: "Right", t: "Top", b: "Bottom" } as const;
        const st = pl.createDiv({ cls: "vl-step" });
        st.createSpan({ cls: "vl-steplabel", text: `${names[this.gapSide]} gap` });
        const k = this.gapSide;
        const step = (e: MouseEvent, d: number) => this.edit(() => setGap(k, gap[k]() + d * (e.shiftKey ? 8 : 1)));
        const minus = st.createEl("button", { cls: "vl-stepbtn", attr: { "aria-label": "Less (Shift: 8)" } }); setIcon(minus, "minus"); minus.addEventListener("click", (e) => step(e, -1));
        const v = st.createEl("input", { cls: "vl-stepval", attr: { type: "number", "aria-label": `${names[k]} gap` } });
        v.value = String(gap[k]());
        v.addEventListener("change", () => { const n = Number(v.value); if (!Number.isNaN(n)) this.edit(() => setGap(k, Math.round(n))); });
        const plus = st.createEl("button", { cls: "vl-stepbtn", attr: { "aria-label": "More (Shift: 8)" } }); setIcon(plus, "plus"); plus.addEventListener("click", (e) => step(e, 1));
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
            const pick = r.createEl("button", { cls: "vl-rowmain" });
            pick.createSpan({ cls: "vl-type", text: it.type });
            pick.appendText(label(it));
            pick.addEventListener("click", () => this.choose({ page: this.sel!.page, block: b.id, item: it.id }));
            this.btn(r, "arrow-up", "Earlier", () => this.edit(() => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; }), i === 0);
            this.btn(r, "arrow-down", "Later", () => this.edit(() => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; }), i === list.length - 1);
        });
    }
    addButtons(parent: HTMLElement, b: Block, list: Item[], types: ItemType[]) {
        const names: Record<ItemType, [string, string]> = { text: ["type", "Text"], rect: ["square", "Rect"], ellipse: ["circle", "Circle"], line: ["minus", "Line"], img: ["image", "Picture"], icon: ["smile-plus", "Icon"], row: ["columns-3", "Row"], col: ["rows-3", "Column"] };
        this.actions(parent, types.map((t) => [names[t][0], names[t][1], () => this.edit(() => { const it = newItem(t); if (list !== b.items) { delete it.g; delete it.dx; delete it.dy; } list.push(it); this.sel = { page: this.sel!.page, block: b.id, item: it.id }; })] as [string, string, () => void]));
    }
    itemPanel(body: HTMLElement, b: Block, it: Item, top: boolean) {
        const tabs = body.createDiv({ cls: "vl-tabs" });
        for (const [k, t] of [["style", "Style"], ["place", "Place"], ["note", "Note"]] as const) {
            const x = tabs.createEl("button", { text: t, cls: this.tab === k ? "is-on" : "" });
            x.addEventListener("click", () => { this.tab = k; this.drawPanel(); });
        }
        if (this.tab === "style") this.stylePanel(body, b, it);
        else if (this.tab === "place") this.placePanel(body, it, top);
        else this.text(this.section(body, "Note"), () => it.note ?? "", (v) => { if (v.trim()) it.note = v; else delete it.note; }, { area: true, placeholder: "Why it is here, what to change (for the agent)" });
        this.actions(body, [["copy", "Duplicate", () => this.duplicate()], ["trash-2", "Delete", () => this.remove()]]);
    }
    stylePanel(body: HTMLElement, b: Block, it: Item) {
        if (it.type === "text") {
            const s = this.section(body, "Text");
            this.text(s, () => it.v ?? "", (v) => { it.v = v; }, { area: true });
            const r = s.createDiv({ cls: "vl-nums" });
            this.num(r, "Size", () => it.size ?? 15, (v) => { it.size = v; }, { min: 4, max: 400 });
            this.num(r, "Spacing", () => it.ls ?? 0, (v) => { it.ls = v || undefined; }, { step: 0.01 });
            this.num(r, "Line h", () => it.lh ?? 1.2, (v) => { it.lh = v; }, { step: 0.05, min: 0.5 });
            const t = this.section(body, "Thickness");
            this.chips(t, [[100, "Thin"], [300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semi"], [700, "Bold"], [900, "Black"]], it.wt ?? 400, (v) => { it.wt = v === 400 ? undefined : v; });
            const f = this.section(body, "Font");
            this.chips(f, Object.keys(this.theme.fonts).map((k) => [k, k] as [string, string]), it.font ?? "ui", (v) => { it.font = v === "ui" ? undefined : v; });
            this.chips(f, [["no", "As typed", "case-sensitive"], ["up", "Capitals", "case-upper"]], it.upper ? "up" : "no", (v) => { it.upper = v === "up" || undefined; });
            this.colors(this.section(body, "Colour"), it.color ?? "text", (v) => { it.color = v === "text" ? undefined : v; });
        } else if (it.type === "line") {
            const s = this.section(body, "Line");
            this.num(s.createDiv({ cls: "vl-nums" }), "Thickness", () => (typeof it.h === "number" ? it.h : 1), (v) => { it.h = v; }, { min: 1 });
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
            const r = s.createDiv({ cls: "vl-nums" });
            this.num(r, "Size", () => it.size ?? 20, (v) => { it.size = v; }, { min: 4, max: 400 });
            this.num(r, "Stroke", () => it.sw ?? 0, (v) => { it.sw = v || undefined; }, { step: 0.25, min: 0, max: 4 });
            this.num(r, "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100 });
            this.colors(this.section(body, "Colour"), it.color ?? "text", (v) => { it.color = v === "text" ? undefined : v; });
        } else if (it.type === "row" || it.type === "col") {
            const s = this.section(body, it.type === "row" ? "Row" : "Column");
            this.chips(s, [["row", "Across", "arrow-right"], ["col", "Down", "arrow-down"]], it.type, (v) => { it.type = v; });
            const r = s.createDiv({ cls: "vl-nums" });
            this.num(r, "Gap", () => it.gap ?? 0, (v) => { it.gap = v; }, { min: 0 });
            this.num(r, "Padding", () => it.pad ?? 0, (v) => { it.pad = v || undefined; }, { min: 0 });
            const across = it.type === "row";
            this.chips(s, [["start", across ? "Line up at the top" : "Line up at the left", across ? "align-start-horizontal" : "align-start-vertical"], ["center", "Line up in the middle", across ? "align-center-horizontal" : "align-center-vertical"], ["end", across ? "Line up at the bottom" : "Line up at the right", across ? "align-end-horizontal" : "align-end-vertical"]], it.cross ?? "start", (v) => { it.cross = v; });
            this.chips(s, [["start", "Packed at the start", across ? "align-horizontal-justify-start" : "align-vertical-justify-start"], ["center", "Packed in the middle", across ? "align-horizontal-justify-center" : "align-vertical-justify-center"], ["end", "Packed at the end", across ? "align-horizontal-justify-end" : "align-vertical-justify-end"], ["between", "Spread out", across ? "align-horizontal-space-between" : "align-vertical-space-between"]], it.main ?? "start", (v) => { it.main = v; });
            const c = this.section(body, "Items in it");
            this.itemList(c, b, it.items ?? (it.items = []));
            this.addButtons(c, b, it.items, ["text", "rect", "ellipse", "img", "icon", "row", "col"]);
            this.shapeStyle(body, it, true);
        } else { this.shapeStyle(body, it, false); this.sizeNums(body, it, b.items.includes(it)); }
    }
    // a picture's settings: the whole picture with the part the box shows framed (click or drag it to choose that part),
    // its address (or a picture of the vault), how it fits, the focus as a 3 × 3 grid, its size
    picturePanel(body: HTMLElement, b: Block, it: Item) {
        const s = this.section(body, "Picture");
        const prev = s.createDiv({ cls: "vl-imgprev" }), info = s.createDiv({ cls: "vl-frameinfo" });
        const fit = () => it.fit ?? "cover";
        const box = () => { const el = (this.wall ?? document).querySelector<HTMLElement>(`.vl-it[data-id="${it.id}"]`); return { W: el?.offsetWidth || (typeof it.w === "number" ? it.w : 80), H: el?.offsetHeight || (typeof it.h === "number" ? it.h : 80) }; };
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
            prev.empty(); prev.removeClass("is-empty", "is-broken"); prev.style.height = ""; im = crop = null;
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
        this.num(r, "Radius", () => it.r ?? 0, (v) => { it.r = v || undefined; }, { min: 0 });
        this.num(r, "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100 });
    }
    // exact size and offset as numbers (a hug / fill size shows as drawn; typing a number fixes it); the corner handles change them too
    sizeNums(body: HTMLElement, it: Item, top: boolean) {
        const r = this.section(body, "Size and place").createDiv({ cls: "vl-nums" });
        const drawn = (axis: "w" | "h") => { const el = (this.wall ?? document).querySelector<HTMLElement>(`.vl-it[data-id="${it.id}"]`); return el ? (axis === "w" ? el.offsetWidth : el.offsetHeight) : 40; };
        this.num(r, "W", () => (typeof it.w === "number" ? it.w : drawn("w")), (v) => { it.w = v; }, { min: 1 });
        this.num(r, "H", () => (typeof it.h === "number" ? it.h : drawn("h")), (v) => { it.h = v; }, { min: 1 });
        if (top) { this.num(r, "X", () => it.dx ?? 0, (v) => { it.dx = v; }); this.num(r, "Y", () => it.dy ?? 0, (v) => { it.dy = v; }); }
    }
    shapeStyle(body: HTMLElement, it: Item, box: boolean) {
        if (!box) this.chips(this.section(body, "Shape"), [["rect", "Rectangle", "square"], ["ellipse", "Circle", "circle"]], it.type as string, (v) => { it.type = v as ItemType; });
        this.colors(this.section(body, box ? "Background" : "Fill"), it.fill, (v) => { if (v === "none") delete it.fill; else it.fill = v; }, true);
        const o = this.section(body, "Outline");
        const r = o.createDiv({ cls: "vl-nums" });
        this.num(r, "Thickness", () => it.sw ?? 0, (v) => { it.sw = v || undefined; }, { min: 0 });
        if (it.type !== "ellipse") this.num(r, "Radius", () => it.r ?? 0, (v) => { it.r = v || undefined; }, { min: 0 });
        this.num(r, "Opacity", () => it.op ?? 100, (v) => { it.op = v >= 100 ? undefined : v; }, { min: 0, max: 100 });
        this.colors(o, it.stroke ?? "line", (v) => { it.stroke = v; });
    }
    placePanel(body: HTMLElement, it: Item, top: boolean) {
        if (top) {
            const s = this.section(body, "Anchor");
            s.parentElement?.setAttr("aria-label", "The point of the block it keeps when the block grows");
            const wrap = s.createDiv({ cls: "vl-gwrap" });
            const grid = wrap.createDiv({ cls: "vl-grav" });
            for (const g of GRAVITIES) {
                const d = grid.createEl("button", { cls: g === (it.g ?? "tl") ? "is-on" : "", attr: { "aria-label": g } });
                d.createSpan();
                d.addEventListener("click", () => this.edit(() => { it.g = g; }));
            }
            const [ax, ay] = axes(it.g);
            const nums = wrap.createDiv({ cls: "vl-nums is-col" });
            if (it.w !== "fill") this.num(nums, ax < 0 ? "From left" : ax > 0 ? "From right" : "Off centre →", () => it.dx ?? 0, (v) => { it.dx = v; });
            if (it.h !== "fill") this.num(nums, ay < 0 ? "From top" : ay > 0 ? "From bottom" : "Off centre ↓", () => it.dy ?? 0, (v) => { it.dy = v; });
        }
        if (it.type === "icon") { this.section(body, "Size").createDiv({ cls: "vl-frameinfo", text: "An icon is as big as its Size (Style)." }); return; }
        for (const [axis, name] of [["w", "Width"], ["h", "Height"]] as const) {
            const s = this.section(body, name);
            const cur = it[axis];
            const rule = cur === "fill" ? "fill" : typeof cur === "number" ? "fixed" : "hug";
            this.chips(s, [["hug", "Hug: as big as its content", axis === "w" ? "fold-horizontal" : "fold-vertical"], ["fixed", "Fixed: a set size", "lock"], ["fill", "Fill: the block's room", axis === "w" ? "unfold-horizontal" : "unfold-vertical"]], rule, (v) => {
                if (v === "fixed") { const el = (this.wall ?? document).querySelector<HTMLElement>(`.vl-it[data-id="${it.id}"]`); it[axis] = Math.round(el ? (axis === "w" ? el.offsetWidth : el.offsetHeight) : 40) as Size; }
                else it[axis] = v as Size;
            });
            if (rule === "fixed") this.num(s.createDiv({ cls: "vl-nums" }), "px", () => it[axis] as number, (v) => { it[axis] = v; }, { min: 1 });
            if (rule === "fill" && top) this.num(s.createDiv({ cls: "vl-nums" }), "Margin", () => Math.abs((axis === "w" ? it.dx : it.dy) ?? 0), (v) => { if (axis === "w") it.dx = v; else it.dy = v; }, { min: 0 });
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
const RESIZE: ItemType[] = ["img", "rect", "ellipse"];   // items with corner handles
const label = (it: Item) => (it.type === "text" ? (it.v ?? "").split("\n")[0].slice(0, 24) || "(empty text)" : it.type === "row" || it.type === "col" ? `${it.items?.length ?? 0} items`
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
