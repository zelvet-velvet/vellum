import { ItemView, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Platform, Plugin, setIcon, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { deviceOf, DEVICES, screenOf } from "./devices";
import { axes, Block, childrenOf, cloneItem, Doc, findItem, GRAVITIES, subtreeOf, Item, ItemType, newItem, Page, parseDoc, serialiseDoc, Size, uid } from "./model";
import { BASE_KINDS, BASE_THEME, colorOf, drawItem, Kind, Theme } from "./render";
import { FolderStore, srcOf } from "./store";

// The Vellum editor in a ```vellum block. Desktop first (the phone checks): the pages as phones side by side; a tap on the
// screen chooses the page, on a block the block, on an item the item; drag moves it (blocks by x / y, items by their offset
// from their gravity point), a block's corner resizes it; the panel shows only what is chosen, as controls (no syntax).
// Keys: arrows nudge 1 px (shift 4), Delete, Ctrl+Z / Ctrl+Shift+Z, Ctrl+D duplicate, Ctrl+S save, Esc goes up a level.
// Unsaved work is kept on the device (localStorage) until saved into the note.
export interface VellumHost { theme?: Partial<Theme>; kinds?: Kind[] }

const SNAP = 4;
type View = { zoom: number; fit: boolean; show: boolean; page?: string; rail: boolean; panel?: boolean; map?: boolean; mapZoom?: number; mapFit?: boolean };   // map: the whole tree in the stage   // panel: false = folded (computer)
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
    getIcon() { return "pencil-ruler"; }
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
    block() { return this.page()?.blocks.find((b) => b.id === this.sel?.block); }
    item() { const b = this.block(); return b && this.sel?.item ? findItem(b.items, this.sel.item) : null; }
    choose(s: Sel) { this.sel = s; this.drawPanel(); this.drawPages(); }
    fixSel() { if (!this.page()) this.sel = null; else if (this.sel?.block && !this.block()) this.sel = { page: this.sel.page }; else if (this.sel?.item && !this.item()) this.sel = { page: this.sel!.page, block: this.sel!.block }; }

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
        const rt = l.createEl("button", { cls: "vl-railbtn" + (this.v.rail ? " is-on" : ""), attr: { title: "Screens" } });
        setIcon(rt.createSpan(), Platform.isMobile ? "layers" : "panel-left");
        rt.createSpan({ cls: "vl-pg", text: cur?.name ?? "No screens" });
        if (Platform.isMobile) setIcon(rt.createSpan({ cls: "vl-chev" }), "chevron-down");
        rt.addEventListener("click", () => { this.setView({ rail: !this.v.rail }); this.draw(); });
        const r = b.createDiv({ cls: "vl-tr" });
        this.btn(r, "undo-2", "Undo (Ctrl+Z)", () => this.undo(), !this.past.length);
        this.btn(r, "redo-2", "Redo (Ctrl+Shift+Z)", () => this.redo(), !this.future.length);
        const sv = r.createEl("button", { cls: "vl-save is-savebtn" + (this.dirty ? " is-dirty" : ""), attr: { title: "Save into the note (Ctrl+S)" } });
        setIcon(sv.createSpan(), this.dirty ? "save" : "check"); sv.appendText(this.dirty ? "Save" : "Saved");
        sv.addEventListener("click", () => { if (this.dirty) this.save(); });
        if (!Platform.isMobile) {
            r.createSpan({ cls: "vl-zsep" });
            const pt = this.btn(r, "panel-right", this.v.panel === false ? "Show the settings" : "Hide the settings", () => { this.setView({ panel: this.v.panel === false }); this.draw(); });
            pt.toggleClass("is-on", this.v.panel !== false);
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
            const x = seg.createEl("button", { text: label, cls: mode === m ? "is-on" : "", attr: { title: m === "map" ? "Every screen as a tree" : m === "show" ? "The screen alone" : "Frames and safe areas" } });
            x.addEventListener("click", () => { if (mode === m) return; this.setView({ show: m === "show", map: m === "map" }); if (m !== "edit") this.sel = null; this.draw(); });
        }
        pill.createSpan({ cls: "vl-zsep" });
        this.btn(pill, "minus", "Zoom out (Ctrl+wheel)", () => this.zoomBy(1 / 1.25));
        pill.createSpan({ cls: "vl-zoom", text: `${Math.round((this.v.map ? this.v.mapZoom ?? 1 : this.v.zoom) * 100)}%` });
        this.btn(pill, "plus", "Zoom in (Ctrl+wheel)", () => this.zoomBy(1.25));
        const fitOn = this.v.map ? this.v.mapFit !== false : this.v.fit;
        const fit = pill.createEl("button", { cls: "vl-zfit" + (fitOn ? " is-on" : ""), text: "Fit", attr: { title: "Fit to the window" } });
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
        const x = parent.createEl("button", { cls: "vl-btn" + (off ? " is-off" : ""), attr: { "aria-label": label, title: label } });
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
                const slots = this.drawMap(box, BASE, pick);
                tw = Math.max(48, Math.min(200, Math.floor(room / Math.max(1, slots) - 40)));
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
                const dev = deviceOf(cur.device ?? this.doc.device), { W, H } = screenOf(dev, cur.side);
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
        r.empty(); r.toggleClass("is-on", this.v.rail);
        if (!this.v.rail) return;
        // its width: the right border drags it (computer), kept on the device
        if (!Platform.isMobile) {
            r.style.width = `${Number(localStorage.getItem("vellum:railW")) || 248}px`;
            const g = r.createDiv({ cls: "vl-rgrip", attr: { title: "Drag to resize" } });
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
            const off = (e: Event) => { if (!m.isConnected) return R.doc.removeEventListener("pointerdown", off, true); if (!m.contains(e.target as Node) && !dev.contains(e.target as Node)) { m.remove(); R.doc.removeEventListener("pointerdown", off, true); } };
            window.setTimeout(() => R.doc.addEventListener("pointerdown", off, true));
        });
    }
    // a large look at a screen without opening it: the pointer resting on its row (computer), a long press (phone)
    peekOn(row: HTMLElement, p: Page) {
        let t = 0;
        if (!Platform.isMobile) {
            row.addEventListener("mouseenter", () => { t = window.setTimeout(() => this.peek(p, row), 280); });
            row.addEventListener("mouseleave", () => { window.clearTimeout(t); this.unpeek(); });
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
        const d = deviceOf(p.device ?? this.doc.device), sc = screenOf(d, p.side), k = TW / sc.W;
        const el = createDiv({ cls: "vl-pthumb" });
        el.style.width = `${TW}px`; el.style.height = `${Math.round(sc.H * k)}px`; el.style.borderRadius = `${Math.max(3, d.radius * k)}px`;
        const scr = el.createDiv({ cls: "vl-screen is-show" });
        Object.assign(scr.style, { width: `${sc.W}px`, height: `${sc.H}px`, transform: `scale(${k})` });
        if (p.bg) scr.style.background = colorOf(this.theme, p.bg);
        const keep = this.sel; this.sel = null;
        for (const b of p.blocks) this.drawBlock(scr, p, b, true);
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
        const sig = JSON.stringify(p) + this.doc.device + tw, hit = this.thumbs.get(p.id);
        if (hit && hit.sig === sig) return hit.el;
        const el = this.pic(p, tw);
        this.thumbs.set(p.id, { sig, el });
        return el;
    }
    // the map in the note's card: every page as a small screen; main pages along the top, each page's sub pages under it,
    // joined by lines (with how you get there); a click opens the editor on that page
    // TW: a screen's width in the map; pick: what a click does (the card: open the editor there); returns the slots across
    drawMap(m: HTMLElement, TW = 76, pick: (p: Page) => void = (p) => this.openWs(p.id)): number {
        m.empty();
        if (!this.doc.pages.length) { m.createDiv({ cls: "vl-empty", text: "No screens yet: open the editor to add one." }); return 0; }
        const pages = this.doc.pages, cur = this.root?.isConnected ? this.current() : undefined;
        const GAP = 40, LABEL = 46, slotW = TW + GAP;
        const dims = (p: Page) => { const d = deviceOf(p.device ?? this.doc.device), sc = screenOf(d, p.side); const k = TW / Math.max(sc.W, d.w); return { k, w: sc.W * k, h: sc.H * k, d, sc }; };
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
            if (p.bg) { scr.style.background = colorOf(this.theme, p.bg); ph.style.background = scr.style.background; }
            Object.assign(scr.style, { width: `${d.sc.W}px`, height: `${d.sc.H}px`, transform: `scale(${d.k})` });
            for (const b of p.blocks) this.drawBlock(scr, p, b, true);
            t.createDiv({ cls: "vl-tname", text: p.name });
            t.addEventListener("click", () => pick(p));
            if (p.id === cur?.id) t.addClass("is-on");
        }
        this.sel = keep;
        return x;
    }
    drawPage(p: Page) {
        const dev = deviceOf(p.device ?? this.doc.device), { W, H, safe } = screenOf(dev, p.side), z = this.v.zoom, show = this.v.show;
        const fig = this.wall.createDiv({ cls: "vl-page" + (p.mock ? " is-mock" : "") + (this.sel?.page === p.id ? " is-sel" : "") });
        fig.createDiv({ cls: "vl-pname", text: p.name + (p.mock ? "  · mock" : "") });
        const phone = fig.createDiv({ cls: "vl-phone" });
        phone.style.width = `${W * z}px`; phone.style.height = `${H * z}px`; phone.style.borderRadius = `${dev.radius * z}px`;
        const scr = phone.createDiv({ cls: "vl-screen" + (show ? " is-show" : "") });
        if (p.bg) { scr.style.background = colorOf(this.theme, p.bg); phone.style.background = scr.style.background; }
        Object.assign(scr.style, { width: `${W}px`, height: `${H}px`, transform: `scale(${z})`, borderRadius: `${dev.radius}px` });
        // the device: status bar, cut-out, home indicator; safe areas shaded while editing
        if (!p.side) {
            const sb = scr.createDiv({ cls: "vl-status" }); sb.style.height = `${dev.top}px`;
            const cutW = dev.cut === "island" ? 125 : dev.cut === "notch" ? 209 : 0;
            sb.style.setProperty("--ear", `${(W - cutW) / 2}px`);
            sb.createDiv({ cls: "vl-ear" }).createSpan({ cls: "vl-time", text: "9:41" });
            const r = sb.createDiv({ cls: "vl-ear" });
            r.innerHTML = '<svg class="vl-bars" viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="7.5" width="3" height="4.5" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2.5" width="3" height="9.5" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><span class="vl-net">5G</span><svg class="vl-batt" viewBox="0 0 28 13" width="28" height="13"><rect x="0.5" y="0.5" width="24" height="12" rx="3.8" fill="none" stroke="currentColor" opacity="0.4"/><rect x="2" y="2" width="16" height="9" rx="2.4"/><path d="M26 4.5v4a2.2 2.2 0 0 0 0-4z" opacity="0.45"/></svg>';
        }
        if (dev.cut !== "none") scr.createDiv({ cls: `vl-cut is-${dev.cut}` + (p.side ? " is-side" : "") });
        if (safe.bottom) scr.createDiv({ cls: "vl-home" });
        if (!show) for (const [k, v] of Object.entries(safe)) if (v) { const s = scr.createDiv({ cls: `vl-safe is-${k}` }); s.style[k === "top" || k === "bottom" ? "height" : "width"] = `${v}px`; }
        for (const b of p.blocks) this.drawBlock(scr, p, b, show);
        // pointer: choose and drag
        if (!show) scr.addEventListener("pointerdown", (e) => this.down(e, p, scr));
        if (!show) scr.addEventListener("dblclick", (e) => this.typeInPlace(e, p));
    }
    // one block again, in its place (a drag keeps its screen element, which holds the pointer)
    redrawBlock(scr: HTMLElement, p: Page, b: Block) {
        const old = scr.querySelector(`[data-block="${b.id}"]`);
        const el = this.drawBlock(scr, p, b, false);
        if (old) old.replaceWith(el);
    }
    drawBlock(scr: HTMLElement, p: Page, b: Block, show: boolean): HTMLElement {
        const kind = this.kinds.find((k) => k.id === b.kind) ?? this.kinds[0];
        const sel = this.sel?.page === p.id && this.sel.block === b.id;
        const el = scr.createDiv({ cls: "vl-block" + (sel ? " is-sel" : ""), attr: { "data-block": b.id } });
        Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
        el.style.setProperty("--k", kind?.color ?? "var(--text-faint)");
        if (!show) el.createDiv({ cls: "vl-tag", text: b.name });
        for (const it of b.items) drawItem(this.theme, el, it);
        if (sel) {
            const id = this.sel?.item;
            if (id) {
                el.querySelector(`[data-id="${id}"]`)?.addClass("is-sel");
                const it = findItem(b.items, id)?.item;
                // the gravity point the item keeps, on the block
                if (it && b.items.includes(it)) { const [ax, ay] = axes(it.g); const d = el.createDiv({ cls: "vl-anchor" }); d.style.left = `${(ax + 1) * 50}%`; d.style.top = `${(ay + 1) * 50}%`; }
            } else el.createDiv({ cls: "vl-grip", attr: { "data-grip": "1" } });
        }
        return el;
    }

    // ---- pointer: a tap chooses, a drag moves (snaps to 4 px, Alt for 1 px)
    down(e: PointerEvent, p: Page, scr: HTMLElement) {
        if (e.button !== 0) return;
        const t = e.target as HTMLElement;
        const bEl = t.closest<HTMLElement>("[data-block]"), b = bEl ? p.blocks.find((x) => x.id === bEl.dataset.block) : undefined;
        const grip = !!t.closest("[data-grip]");
        const itEl = t.closest<HTMLElement>(".vl-it");
        // an item inside a row moves with its row: the drag takes the top-level item, the tap chooses the inner one
        const topEl = t.closest<HTMLElement>("[data-top]");
        const pickId = itEl?.dataset.id, dragId = topEl?.dataset.id;
        const before = this.sel;
        if (!b) { this.choose({ page: p.id }); return; }
        // first tap on a block chooses the block; an item is chosen once its block is (or straight away with a double tap)
        const blockChosen = before?.page === p.id && before.block === b.id;
        const target: Sel = pickId && blockChosen ? { page: p.id, block: b.id, item: pickId } : { page: p.id, block: b.id };
        const dragItem = target?.item ? findItem(b.items, dragId!)?.item : undefined;
        const x0 = e.clientX, y0 = e.clientY, z = this.v.zoom, start = { ...b }, istart = dragItem ? { dx: dragItem.dx ?? 0, dy: dragItem.dy ?? 0 } : null;
        let moved = false;
        scr.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
            const dx = (m.clientX - x0) / z, dy = (m.clientY - y0) / z;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            if (!moved) { moved = true; this.begin(); if (!blockChosen || target?.item !== this.sel?.item) { this.sel = target; this.drawPanel(); } }
            const sn = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / SNAP) * SNAP);
            if (dragItem && istart) {
                const [ax, ay] = axes(dragItem.g);
                if (dragItem.w !== "fill") dragItem.dx = sn(istart.dx + (ax > 0 ? -dx : dx));
                if (dragItem.h !== "fill") dragItem.dy = sn(istart.dy + (ay > 0 ? -dy : dy));
            } else if (grip) { b.w = Math.max(8, sn(start.w + dx)); b.h = Math.max(8, sn(start.h + dy)); }
            else { b.x = sn(start.x + dx); b.y = sn(start.y + dy); }
            this.redrawBlock(scr, p, b);
            this.livePanel();
        };
        const up = () => {
            scr.removeEventListener("pointermove", move); scr.removeEventListener("pointerup", up); scr.removeEventListener("pointercancel", up);
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
        const b = bEl ? p.blocks.find((x) => x.id === bEl.dataset.block) : undefined;
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
        if (d && this.sel?.block) { this.nudge(d[0] * (e.shiftKey ? SNAP : 1), d[1] * (e.shiftKey ? SNAP : 1)); return true; }
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
        if (f) this.edit(() => { const c = cloneItem(f.item); f.list.splice(f.list.indexOf(f.item) + 1, 0, c); this.sel = { ...this.sel!, item: c.id }; });
        else if (b && p) this.edit(() => { const c: Block = { ...JSON.parse(JSON.stringify(b)), id: uid(), y: b.y + b.h + 8 }; c.items = b.items.map(cloneItem); p.blocks.push(c); this.sel = { page: p.id, block: c.id }; });
        else if (p) this.edit(() => { const c: Page = { ...JSON.parse(JSON.stringify(p)), id: uid(), name: p.name + " copy" }; this.doc.pages.splice(this.doc.pages.indexOf(p) + 1, 0, c); this.sel = { page: c.id }; });
    }
    remove() {
        const f = this.item(), b = this.block(), p = this.page();
        if (f) this.edit(() => { f.list.splice(f.list.indexOf(f.item), 1); this.sel = { page: p!.id, block: b!.id }; });
        else if (b && p) this.edit(() => { p.blocks.splice(p.blocks.indexOf(b), 1); this.sel = { page: p.id }; });
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
            const g = P.createDiv({ cls: "vl-pgrip", attr: { title: "Drag to resize" } });
            g.addEventListener("pointerdown", (e) => {
                e.preventDefault(); g.setPointerCapture(e.pointerId); g.addClass("is-on");
                const x0 = e.clientX, w0 = P.offsetWidth;
                const mv = (m: PointerEvent) => { P.style.width = `${Math.min(600, Math.max(240, w0 - (m.clientX - x0)))}px`; };
                const up = () => { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeClass("is-on"); try { localStorage.setItem("vellum:panelW", String(P.offsetWidth)); } catch { /* */ } if (this.v.fit) this.drawPages(); };
                g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up);
            });
        }
        const b = this.block(), f = this.item();
        // breadcrumb: page › block › item, each a way back up
        const head = P.createDiv({ cls: "vl-crumb" });
        const crumb = (text: string, s: Sel, on: boolean) => { const c = head.createEl("button", { text, cls: on ? "is-on" : "" }); c.addEventListener("click", () => this.choose(s)); };
        crumb(p.name, { page: p.id }, !b);
        if (b) { head.createSpan({ text: "›" }); crumb(b.name, { page: p.id, block: b.id }, !f); }
        if (f) { head.createSpan({ text: "›" }); crumb(label(f.item), this.sel, true); }
        if (this.sel) this.btn(head, "x", "Let go (Esc)", () => this.choose(null)).addClass("vl-close");
        if (!Platform.isMobile) this.btn(head, "panel-right-close", "Hide the settings", () => { this.setView({ panel: false }); this.draw(); }).addClass(this.sel ? "vl-fold" : "vl-close");
        const body = P.createDiv({ cls: "vl-pbody" });
        if (f && b) this.itemPanel(body, b, f.item, b.items.includes(f.item));
        else if (b) this.blockPanel(body, p, b);
        else this.pagePanel(body, p);
        body.scrollTop = this.keepTop; this.keepTop = 0;
    }
    keepTop = 0;
    // while dragging: only the numbers change (the panel stays as it is)
    livePanel() { this.panel?.querySelectorAll<HTMLInputElement>("input[data-live]").forEach((i) => { const g = this.getters.get(i); if (g && i.doc.activeElement !== i) i.value = String(g()); }); }
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
    chips<T extends string | number>(parent: HTMLElement, opts: [T, string][], on: T | undefined, pick: (v: T) => void, swatch?: (v: T) => string) {
        const g = parent.createDiv({ cls: "vl-chips" });
        for (const [v, text] of opts) {
            const c = g.createEl("button", { cls: "vl-chip" + (v === on ? " is-on" : ""), attr: { title: text } });
            if (swatch) { const s = c.createSpan({ cls: "vl-sw" }); s.style.background = swatch(v); }
            c.appendText(text);
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
        const g = this.chips(parent, opts, on ?? (none ? "none" : undefined), pick, (v) => colorOf(this.theme, v));
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
        this.chips(s, [["up", "Upright"], ["side", "Sideways"]], p.side ? "side" : "up", (v) => { if (v === "side") p.side = true; else delete p.side; });
        this.chips(s, [["real", "Real page"], ["mock", "Mock (a proposal)"]], p.mock ? "mock" : "real", (v) => { if (v === "mock") p.mock = true; else delete p.mock; });
        this.colors(this.section(body, "Screen colour"), p.bg ?? "paper", (v) => { if (v === "paper") delete p.bg; else p.bg = v; });
        const st = this.section(body, "Opened from");
        const under = subtreeOf(this.doc.pages, p.id);
        this.chips(st, [["", "Main page (a tab)"], ...this.doc.pages.filter((q) => !under.has(q.id)).map((q) => [q.id, q.name] as [string, string])], p.parent ?? "", (v) => { if (v) p.parent = v; else { delete p.parent; delete p.link; } });
        if (p.parent) this.text(st, () => p.link ?? "", (v) => { if (v.trim()) p.link = v; else delete p.link; }, { placeholder: "How you get there (tap a row, + button…)" });
        const n = this.section(body, "Note");
        this.text(n, () => p.note ?? "", (v) => { if (v.trim()) p.note = v; else delete p.note; }, { area: true, placeholder: "What this page is for" });
        const a = this.section(body, "Add a block");
        const g = a.createDiv({ cls: "vl-chips" });
        for (const k of this.kinds) {
            const c = g.createEl("button", { cls: "vl-chip" }); c.createSpan({ cls: "vl-sw" }).style.background = k.color; c.appendText(k.name);
            c.addEventListener("click", () => this.edit(() => {
                const dev = deviceOf(p.device ?? this.doc.device), { W, safe } = screenOf(dev, p.side);
                const low = p.blocks.reduce((m, x) => Math.max(m, x.y + x.h), safe.top);
                const nb: Block = { id: uid(), name: k.name.split(" / ")[0], kind: k.id, x: 16 + safe.left, y: low + 8, w: W - 32 - safe.left - safe.right, h: 80, items: [] };
                p.blocks.push(nb); this.sel = { page: p.id, block: nb.id };
            }));
        }
        this.actions(body, [["copy", "Duplicate page", () => this.duplicate()], ["trash-2", "Delete page", () => this.edit(() => { this.doc.pages.splice(this.doc.pages.indexOf(p), 1); this.sel = null; })]]);
    }
    blockPanel(body: HTMLElement, p: Page, b: Block) {
        const s = this.section(body, "Block");
        this.text(s, () => b.name, (v) => { b.name = v; }, { title: "Block name" });
        const g = s.createDiv({ cls: "vl-chips" });
        for (const k of this.kinds) {
            const c = g.createEl("button", { cls: "vl-chip" + (k.id === b.kind ? " is-on" : "") }); c.createSpan({ cls: "vl-sw" }).style.background = k.color; c.appendText(k.name);
            c.addEventListener("click", () => this.edit(() => { b.kind = k.id; }));
        }
        const pl = this.section(body, "Place");
        const row = pl.createDiv({ cls: "vl-nums" });
        this.num(row, "X", () => b.x, (v) => { b.x = v; });
        this.num(row, "Y", () => b.y, (v) => { b.y = v; });
        this.num(row, "W", () => b.w, (v) => { b.w = v; }, { min: 8 });
        this.num(row, "H", () => b.h, (v) => { b.h = v; }, { min: 8 });
        const it = this.section(body, "Items");
        this.itemList(it, b, b.items);
        this.addButtons(it, b, b.items, ["text", "rect", "ellipse", "line", "row", "col"]);
        const n = this.section(body, "Note");
        this.text(n, () => b.note ?? "", (v) => { if (v.trim()) b.note = v; else delete b.note; }, { area: true, placeholder: "What goes here, what is wrong (for the agent)" });
        this.actions(body, [["copy", "Duplicate", () => this.duplicate()], ["trash-2", "Delete", () => this.remove()]]);
    }
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
        const names: Record<ItemType, [string, string]> = { text: ["type", "Text"], rect: ["square", "Rect"], ellipse: ["circle", "Circle"], line: ["minus", "Line"], row: ["columns-3", "Row"], col: ["rows-3", "Column"] };
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
            this.chips(f, [["no", "As typed"], ["up", "CAPS"]], it.upper ? "up" : "no", (v) => { it.upper = v === "up" || undefined; });
            this.colors(this.section(body, "Colour"), it.color ?? "text", (v) => { it.color = v === "text" ? undefined : v; });
        } else if (it.type === "line") {
            const s = this.section(body, "Line");
            this.num(s.createDiv({ cls: "vl-nums" }), "Thickness", () => (typeof it.h === "number" ? it.h : 1), (v) => { it.h = v; }, { min: 1 });
            this.colors(this.section(body, "Colour"), it.fill ?? "line", (v) => { it.fill = v; });
        } else if (it.type === "row" || it.type === "col") {
            const s = this.section(body, it.type === "row" ? "Row" : "Column");
            this.chips(s, [["row", "Across"], ["col", "Down"]], it.type, (v) => { it.type = v; });
            const r = s.createDiv({ cls: "vl-nums" });
            this.num(r, "Gap", () => it.gap ?? 0, (v) => { it.gap = v; }, { min: 0 });
            this.num(r, "Padding", () => it.pad ?? 0, (v) => { it.pad = v || undefined; }, { min: 0 });
            this.chips(s, [["start", "Start"], ["center", "Middle"], ["end", "End"]], it.cross ?? "start", (v) => { it.cross = v; });
            this.chips(s, [["start", "Packed"], ["center", "Centred"], ["end", "To the end"], ["between", "Spread"]], it.main ?? "start", (v) => { it.main = v; });
            const c = this.section(body, "Items in it");
            this.itemList(c, b, it.items ?? (it.items = []));
            this.addButtons(c, b, it.items, ["text", "rect", "ellipse", "row", "col"]);
            this.shapeStyle(body, it, true);
        } else this.shapeStyle(body, it, false);
    }
    shapeStyle(body: HTMLElement, it: Item, box: boolean) {
        if (!box) this.chips(this.section(body, "Shape"), [["rect", "Rect"], ["ellipse", "Circle"]], it.type as string, (v) => { it.type = v as ItemType; });
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
            const s = this.section(body, "Gravity: the point of the block it keeps");
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
        for (const [axis, name] of [["w", "Width"], ["h", "Height"]] as const) {
            const s = this.section(body, name);
            const cur = it[axis];
            const rule = cur === "fill" ? "fill" : typeof cur === "number" ? "fixed" : "hug";
            this.chips(s, [["hug", "Hug content"], ["fixed", "Fixed"], ["fill", "Fill"]], rule, (v) => {
                if (v === "fixed") { const el = (this.wall ?? document).querySelector<HTMLElement>(`.vl-it[data-id="${it.id}"]`); it[axis] = Math.round(el ? (axis === "w" ? el.offsetWidth : el.offsetHeight) : 40) as Size; }
                else it[axis] = v as Size;
            });
            if (rule === "fixed") this.num(s.createDiv({ cls: "vl-nums" }), "px", () => it[axis] as number, (v) => { it[axis] = v; }, { min: 1 });
            if (rule === "fill" && top) this.num(s.createDiv({ cls: "vl-nums" }), "Margin", () => Math.abs((axis === "w" ? it.dx : it.dy) ?? 0), (v) => { if (axis === "w") it.dx = v; else it.dy = v; }, { min: 0 });
        }
    }
}

const label = (it: Item) => (it.type === "text" ? (it.v ?? "").split("\n")[0].slice(0, 24) || "(empty text)" : it.type === "row" || it.type === "col" ? `${it.items?.length ?? 0} items` : it.type === "ellipse" ? "circle" : it.type);

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
