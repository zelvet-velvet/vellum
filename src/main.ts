import { addIcon, App, FuzzySuggestModal, Plugin, PluginSettingTab, setIcon, SliderComponent, TFolder, ToggleComponent } from "obsidian";
import { EDIT_DEFAULT, EditCfg, openVellum, registerVellum, setEdit, setSnap, SnapCfg, SNAP_DEFAULT, hexOf, hsvToRgb, refreshLook, rgbToHsv } from "./editor";
import { getLocal, setLocal, useApp } from "./local";
import { BASE_THEME, Theme, UI_COLORS } from "./render";

// the mark (ribbon, the editor's tab): a sheet behind a phone with two blocks on its screen; 100 × 100, line icons
const ICON = `<g fill="none" stroke="currentColor" stroke-width="7.3" stroke-linecap="round" stroke-linejoin="round"><rect x="38" y="8" width="48" height="84" rx="11"/><path d="M38 28H20a6 6 0 0 0-6 6v46a6 6 0 0 0 6 6h18"/></g><rect x="50" y="24" width="24" height="10" rx="3" fill="currentColor"/><rect x="50" y="42" width="24" height="33" rx="4" fill="currentColor"/>`;

// Vellum: phone screens drawn and edited in a note (```vellum blocks). The look (named colours and fonts that items use)
// comes from the settings; by default it follows the Obsidian theme.
// folder: the screens the ribbon button opens (one JSON file per screen); made on the first save
// snap: how drags and resizes snap (to the grid, edges, middles, margins, other items)
// edit: number boxes (the arrows' step, hold-and-drag)
// ui: the editor's own colours that differ from Obsidian's (the rest follow it); colors: the phones' named colours
interface Settings { folder: string; colors: Record<string, string>; ui: Record<string, string>; fonts: Record<string, string>; snap: SnapCfg; edit: EditCfg }
const DEFAULTS: Settings = { folder: "Screens", colors: { ...BASE_THEME.colors }, ui: {}, fonts: { ...BASE_THEME.fonts }, snap: { ...SNAP_DEFAULT }, edit: { ...EDIT_DEFAULT } };

export default class VellumPlugin extends Plugin {
    settings: Settings = structuredClone(DEFAULTS);
    async onload() {
        const saved = (await this.loadData()) as Partial<Settings> | null;
        this.settings = { folder: saved?.folder || DEFAULTS.folder, colors: { ...DEFAULTS.colors, ...saved?.colors }, ui: { ...saved?.ui }, fonts: { ...DEFAULTS.fonts, ...saved?.fonts }, snap: { ...SNAP_DEFAULT, ...saved?.snap }, edit: { ...EDIT_DEFAULT, ...saved?.edit } };
        useApp(this.app);
        addIcon("vellum", ICON);
        registerVellum(this, () => ({ theme: this.theme(), ui: this.settings.ui }));
        // Obsidian's theme changed: the screens' copies of its colours need its new values
        this.registerEvent(this.app.workspace.on("css-change", () => { if (Object.keys(this.settings.ui).length) refreshLook(); }));
        setSnap(this.settings.snap, () => { void this.save(); });
        setEdit(this.settings.edit);
        // the editor straight on the screens folder: no note or block needed
        this.addRibbonIcon("vellum", "Open Vellum", () => { void openVellum(this.settings.folder); });
        this.addCommand({ id: "open", name: "Open the screens", callback: () => { void openVellum(this.settings.folder); } });
        this.addCommand({ id: "open-folder", name: "Open screens from another folder", callback: () => new FolderPick(this.app, async (f) => { this.settings.folder = f.path; await this.save(); void openVellum(f.path); }).open() });
        this.addSettingTab(new VellumSettings(this.app, this));
    }
    theme(): Theme { return { colors: { ...this.settings.colors }, fonts: { ...this.settings.fonts } }; }
    async save() { await this.saveData(this.settings); }
}

// The settings: a few cards (screens, colours, fonts, snapping) that fold, each a list of compact rows (name and a word
// on the left, the control on the right, centred); colours and fonts as tokens with a swatch / a sample to try them
class VellumSettings extends PluginSettingTab {
    constructor(app: App, readonly plugin: VellumPlugin) { super(app, plugin); }
    save() { void this.plugin.save(); }
    // a card: a heading (a click unfolds it; at first only Screens is open, the open ones kept on the device) with a short summary at its
    // right, and its body
    card(c: HTMLElement, key: string, title: string, summary: string): HTMLElement {
        const KEY = "vellum:setopen3";
        let open: string[] = [];
        try { open = JSON.parse(getLocal(KEY) ?? '["screens"]'); } catch { /* */ }   // at first only Screens is open
        const card = c.createDiv({ cls: "vls-card" + (open.includes(key) ? "" : " is-folded") });
        const head = card.createDiv({ cls: "vls-head", attr: { role: "button", tabindex: "0" } });
        setIcon(head.createSpan({ cls: "vls-chev" }), "chevron-down");
        head.createSpan({ cls: "vls-title", text: title });
        head.createSpan({ cls: "vls-sum", text: summary });
        const flip = () => {
            card.toggleClass("is-folded", !card.hasClass("is-folded"));
            open = card.hasClass("is-folded") ? open.filter((k) => k !== key) : [...new Set([...open, key])];
            try { setLocal(KEY, JSON.stringify(open)); } catch { /* */ }
        };
        head.addEventListener("click", flip);
        head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
        return card.createDiv({ cls: "vls-body" });
    }
    // a row: its name (and a line under it) on the left, the control on the right
    row(parent: HTMLElement, name: string, desc?: string): HTMLElement {
        const r = parent.createDiv({ cls: "vls-row" });
        const l = r.createDiv({ cls: "vls-label" });
        l.createDiv({ cls: "vls-name", text: name });
        if (desc) l.createDiv({ cls: "vls-desc", text: desc });
        return r.createDiv({ cls: "vls-ctl" });
    }
    input(parent: HTMLElement, value: string, set: (v: string) => void, o: { cls?: string; placeholder?: string; type?: string } = {}) {
        const i = parent.createEl("input", { cls: "vls-input" + (o.cls ? " " + o.cls : ""), attr: { type: o.type ?? "text", placeholder: o.placeholder ?? "", spellcheck: "false" } });
        i.value = value;
        i.addEventListener("input", () => set(i.value));
        return i;
    }
    // saved and shown a moment after the last change (a drag in the colour picker makes many)
    lookT = 0;
    queueLook() { window.clearTimeout(this.lookT); this.lookT = window.setTimeout(() => { this.save(); refreshLook(); }, 120); }
    hide() { this.pickerOff?.(); super.hide(); }
    syncs: (() => void)[] = [];
    // a list of colours: a tile (Vellum's picker), the name, the value ("Obsidian" while it follows), a way back. Follow Obsidian
    // sets the list back, with an undo; rules: pairs [text, background, least contrast, name] that warn on the text's row
    swatches(body: HTMLElement, blurb: string, pages: [string, [string, Swatch[]][]][], rules: [string, string, number, string][], changed: () => void, demo: HTMLElement) {
        const bar = body.createDiv({ cls: "vls-colbar" }), msg = bar.createSpan({ text: blurb });
        const undo = bar.createEl("button", { text: "Undo" }); undo.hide();
        const follow = bar.createEl("button", { text: "Follow Obsidian" });
        const sum = body.closest(".vls-card")?.querySelector(".vls-sum");
        const rows = new Map<string, { e: Swatch; chip: HTMLElement; paint: () => void; warn: HTMLElement; field: HTMLElement }>();
        // pages of colours, ‹ › between them (one page: no arrows)
        const all = pages.flatMap((p) => p[1].flatMap((g) => g[1]));
        const pager = pages.length > 1 ? body.createDiv({ cls: "vls-pager" }) : null;
        const holder = body.createDiv({ cls: "vls-pages" + (pager ? " is-paged" : "") }), boxes: HTMLElement[] = [];
        for (const [page, groups] of pages) {
        const wrap = holder.createDiv({ cls: "vls-groups" }); boxes.push(wrap);
        for (const [title, list] of groups) {
            const g = wrap.createDiv({ cls: "vls-group" });
            if (title && title !== page) g.createDiv({ cls: "vls-grp", text: title });
            for (const e of list) {
                // the name (and what it colours) on the left; one field on the right: the colour, its value, the way back
                const r = g.createDiv({ cls: "vls-colour" });
                const n = r.createDiv({ cls: "vls-cname" });
                n.createDiv({ cls: "vls-cn", text: e.name });
                if (e.desc) n.createDiv({ cls: "vls-cdesc", text: e.desc });
                const warn = n.createDiv({ cls: "vls-cwarn" });
                const field = r.createDiv({ cls: "vls-cf" });
                const sw = field.createEl("button", { cls: "vls-chip", attr: { "aria-label": `Pick ${e.name}` } }), chip = sw.createSpan();
                const val = field.createEl("input", { cls: "vls-cv", attr: { type: "text", spellcheck: "false", placeholder: "Obsidian", "aria-label": `${e.name} value` } });
                const back = field.createEl("button", { cls: "vls-cb", attr: { "aria-label": e.drop ? `Remove ${e.name}` : "Back to Obsidian" } });
                setIcon(back, e.drop ? "x" : "rotate-ccw");
                const shown = (v?: string) => (v && v.startsWith("#") ? v.toUpperCase() : v ?? "");
                const paint = () => {
                    const v = e.get();
                    chip.style.background = v ?? e.follow ?? "transparent";
                    if (val.ownerDocument.activeElement !== val) val.value = shown(v);
                    back.toggleVisibility(!!(v || e.drop));
                    field.toggleClass("is-custom", !!v);
                };
                rows.set(e.key, { e, chip, paint, warn, field });
                sw.addEventListener("click", () => this.picker(field, chip, (h) => { e.set(h); changed(); }));
                back.addEventListener("click", () => { if (e.drop) { e.drop(); this.queueLook(); this.display(); } else { e.set(undefined); changed(); } });
                val.addEventListener("keydown", (k) => { if (k.key === "Enter") val.blur(); });
                val.addEventListener("change", () => {
                    const v = val.value.trim();
                    if (v && !CSS.supports("color", v)) { field.addClass("is-bad"); return; }
                    field.removeClass("is-bad");
                    if (v) e.set(v); else e.set(undefined);
                    changed();
                });
                // outline where the colour is used; a hover colour also puts its element in that state (data-state)
                const lit = (on: boolean) => {
                    demo.querySelectorAll(`[data-use~="${e.key}"]`).forEach((d) => d.toggleClass("is-lit", on));
                    demo.querySelectorAll(`[data-state~="${e.key}"]`).forEach((d) => d.toggleClass("is-state", on));
                };
                r.addEventListener("mouseenter", () => lit(true)); r.addEventListener("mouseleave", () => lit(false));
            }
        }
        }
        if (pager) this.pager(pager, pages.map((p) => p[0]), boxes);
        this.syncs.push(() => {
            for (const r of rows.values()) r.paint();
            for (const r of rows.values()) {
                let text = "";
                for (const [fg, bg, least, on] of rules) {
                    const b = rows.get(bg);
                    if (fg !== r.e.key || !b || !(r.e.get() || b.e.get())) continue;
                    const x = solid(r.chip), y = solid(b.chip);
                    if (x && y && contrast(x, y) < least) { text = `Hard to read on ${on}`; break; }
                }
                r.warn.setText(text); r.field.toggleClass("is-warn", !!text);
            }
            const n = all.filter((e) => !e.drop && e.get()).length;
            sum?.setText(n ? `${n} changed` : "Following Obsidian");
            follow.disabled = !n;
        });
        let timer = 0;
        const calm = () => { window.clearTimeout(timer); msg.setText(blurb); undo.hide(); };
        follow.addEventListener("click", () => {
            const before = all.filter((e) => !e.drop).map((e) => [e, e.get()] as const);
            for (const [e] of before) e.set(undefined);
            changed();
            msg.setText("Now following Obsidian"); undo.show();
            undo.onclick = () => { for (const [e, v] of before) e.set(v); calm(); changed(); };
            window.clearTimeout(timer); timer = window.setTimeout(calm, 7000);
        });
        this.syncs[this.syncs.length - 1]();
    }
    // ‹ the page's name and a dot for each page ›; the arrow keys too. The page is kept while the settings are open
    colourPages: Record<string, number> = {};   // each card's page, by its pages' names
    pager(el: HTMLElement, titles: string[], boxes: HTMLElement[]) {
        const n = titles.length, key = titles.slice(0, 3).join("|");
        let at = this.colourPages[key] ?? 0;
        const prev = el.createEl("button", { cls: "vls-pgb", attr: { "aria-label": "Previous colours" } }); setIcon(prev, "chevron-left");
        const mid = el.createDiv({ cls: "vls-pgm" }), name = mid.createDiv({ cls: "vls-pgn" }), dots = mid.createDiv({ cls: "vls-pgd" });
        const next = el.createEl("button", { cls: "vls-pgb", attr: { "aria-label": "Next colours" } }); setIcon(next, "chevron-right");
        const go = (i: number) => {
            at = this.colourPages[key] = (i + n) % n;
            boxes.forEach((b, j) => b.toggle(j === at));
            name.setText(titles[at]);
            dots.querySelectorAll(".vls-dot").forEach((d, j) => d.toggleClass("is-on", j === at));
        };
        titles.forEach((t, i) => dots.createEl("button", { cls: "vls-dot", attr: { "aria-label": t } }).addEventListener("click", () => go(i)));
        prev.addEventListener("click", () => go(at - 1));
        next.addEventListener("click", () => go(at + 1));
        el.addEventListener("keydown", (k) => { if (k.key === "ArrowLeft" || k.key === "ArrowRight") { k.preventDefault(); go(at + (k.key === "ArrowLeft" ? -1 : 1)); } });
        go(Math.min(at, n - 1));
    }
    // Vellum's colour picker (the square, hue, opacity, the value), for a tile in the settings
    pickerOff: (() => void) | null = null;
    pickerAt: HTMLElement | null = null;
    picker(anchor: HTMLElement, from: HTMLElement, set: (v: string) => void) {   // from: what shows the colour now
        const again = this.pickerAt === anchor;
        this.pickerOff?.();
        if (again) return;
        const doc = anchor.doc, rgba = (css: string) => { const m = (css.match(/[\d.]+/g) ?? []).map(Number); return { r: m[0] ?? 128, g: m[1] ?? 128, b: m[2] ?? 128, a: m.length > 3 ? m[3] : 1 }; };
        const c = rgba(getComputedStyle(from).backgroundColor), hsv = rgbToHsv(c.r, c.g, c.b);
        const el = doc.body.createDiv({ cls: "vl-cpop vls-pop" });
        const sq = el.createDiv({ cls: "vl-csq" }), sqk = sq.createDiv({ cls: "vl-cknob" });
        const hue = el.createDiv({ cls: "vl-cstrip is-hue" }), huek = hue.createDiv({ cls: "vl-cknob" });
        const al = el.createDiv({ cls: "vl-cstrip is-alpha" }), alk = al.createDiv({ cls: "vl-cknob" });
        const hex = el.createEl("input", { attr: { type: "text", spellcheck: "false", "aria-label": "Hex or any CSS colour" } });
        const show = () => {
            const hueC = `hsl(${hsv.h}, 100%, 50%)`, solidC = `rgb(${c.r}, ${c.g}, ${c.b})`;
            sq.style.setProperty("--hue", hueC);
            sqk.style.left = `${hsv.s}%`; sqk.style.top = `${100 - hsv.v}%`; sqk.style.setProperty("--c", solidC);
            huek.style.left = `${(hsv.h / 360) * 100}%`; huek.style.setProperty("--c", hueC);
            al.style.setProperty("--c", solidC); alk.style.left = `${c.a * 100}%`; alk.style.setProperty("--c", hexOf(c));
            if (doc.activeElement !== hex) hex.value = hexOf(c);
        };
        const put = () => { set(hexOf(c)); show(); };
        const fromHsv = () => { Object.assign(c, hsvToRgb(hsv.h, hsv.s, hsv.v)); };
        const drag = (area: HTMLElement, at: (x: number, y: number) => void) => area.addEventListener("pointerdown", (e) => {
            e.preventDefault(); area.setPointerCapture(e.pointerId);
            const go = (m: PointerEvent) => { const r = area.getBoundingClientRect(); at(Math.min(1, Math.max(0, (m.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (m.clientY - r.top) / r.height))); put(); };
            go(e);
            const up = () => { area.removeEventListener("pointermove", go); area.removeEventListener("pointerup", up); area.removeEventListener("pointercancel", up); };
            area.addEventListener("pointermove", go); area.addEventListener("pointerup", up); area.addEventListener("pointercancel", up);
        });
        drag(sq, (x, y) => { hsv.s = Math.round(x * 100); hsv.v = Math.round((1 - y) * 100); fromHsv(); });
        drag(hue, (x) => { hsv.h = Math.round(x * 360); fromHsv(); });
        drag(al, (x) => { c.a = Math.round(x * 100) / 100; });
        hex.addEventListener("keydown", (k) => { if (k.key === "Enter") hex.blur(); });
        hex.addEventListener("change", () => {
            const v = hex.value.trim();
            if (!v || !CSS.supports("color", v)) { hex.addClass("is-bad"); return; }
            hex.removeClass("is-bad");
            el.style.color = v; Object.assign(c, rgba(getComputedStyle(el).color)); el.style.color = "";
            Object.assign(hsv, rgbToHsv(c.r, c.g, c.b));
            set(v); show();
        });
        show();
        const a = anchor.getBoundingClientRect(), win = doc.win;
        el.style.left = `${Math.max(8, Math.min(win.innerWidth - el.offsetWidth - 8, a.left))}px`;
        el.style.top = `${a.bottom + 6 + el.offsetHeight > win.innerHeight - 8 ? Math.max(8, a.top - el.offsetHeight - 6) : a.bottom + 6}px`;
        const outside = (e: Event) => { const t = e.target as Node; if (!el.contains(t) && !anchor.contains(t)) off(); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); off(); } };
        const off = () => { this.pickerOff = null; this.pickerAt = null; el.remove(); doc.removeEventListener("pointerdown", outside, true); doc.removeEventListener("keydown", esc, true); };
        this.pickerOff = off; this.pickerAt = anchor;
        doc.addEventListener("pointerdown", outside, true); doc.addEventListener("keydown", esc, true);
    }
    // a phone's contents, in the screen colours; editing: one card mid-drag, snapped both ways. data-use: every colour
    // that paints the element (its background, border or text), so a row outlines exactly what it colours
    phoneArt(ph: HTMLElement, editing: boolean) {
        if (editing) div(ph, "vlsd-g is-v", "", "guide");
        div(ph, "vlsd-title", "Today", "s-text"); div(ph, "vlsd-d", "3 sessions left", "s-dim");
        const pair = div(ph, "vlsd-pair");
        if (editing) div(pair, "vlsd-g", "", "guide");
        const run = div(pair, "vlsd-t", "Run", "s-tile s-text"); div(run, "vlsd-d", "30 min", "s-dim");
        const swim = div(pair, "vlsd-t" + (editing ? " is-drag" : ""), "Swim", "s-tile s-text" + (editing ? " accent" : "")); div(swim, "vlsd-d", "45 min", "s-dim");
        if (editing) div(swim, "vlsd-grip", "", "accent");
        div(ph, "vlsd-line", "", "s-line");
        const read = div(ph, "vlsd-t", "Reading", "s-tile s-text"); div(read, "vlsd-loud", "Overdue", "s-loud");
        div(ph, "vlsd-a", "Start", "s-accent");
    }
    // the previews: a small editor, and a phone. The row under the pointer outlines where its colour is used
    demo(parent: HTMLElement): HTMLElement {
        const d = parent.createDiv({ cls: "vls-demo" });
        const bar = div(d, "vlsd-bar is-area", "", "panels border"); bar.createSpan({ text: "Weekly plan", attr: { "data-use": "muted" } });
        const saves = div(bar, "vlsd-saves");
        div(saves, "vlsd-save", "Save", "accent onaccent accenth").setAttr("data-state", "accenth");
        const body = div(d, "vlsd-body");
        const rail = div(body, "vlsd-rail is-area", "", "panels border");
        div(rail, "vlsd-h", "Screens · 5", "faint");
        div(rail, "vlsd-r", "Home", "text"); div(rail, "vlsd-r is-sub", "Search", "muted"); div(rail, "vlsd-r is-on", "Plans", "accent"); div(rail, "vlsd-r", "Detail", "hover text").setAttr("data-state", "hover"); div(rail, "vlsd-r", "Settings", "text");
        const stage = div(body, "vlsd-stage is-area", "", "side");
        this.phoneArt(div(stage, "vlsd-phone"), true);
        const side = div(body, "vlsd-side is-area", "", "panels border");
        div(side, "vlsd-h", "Block", "faint");
        const label = (t: string) => { const f = div(side, ""); f.createSpan({ text: t, attr: { "data-use": "muted" } }); return f; };
        div(label("Name"), "vlsd-in", "Header", "field border text");
        div(label("Height"), "vlsd-in", "80", "field border borderh text").setAttr("data-state", "borderh");
        const seg = div(label("Status"), "vlsd-seg", "", "border");
        seg.createSpan({ cls: "is-on", text: "Real", attr: { "data-use": "accent onaccent" } }); seg.createSpan({ text: "Mock", attr: { "data-use": "muted" } });
        div(side, "vlsd-del", "Delete block", "red");
        return d;
    }
    demoPhone(parent: HTMLElement): HTMLElement {
        const d = parent.createDiv({ cls: "vlsd-solo" });
        this.phoneArt(div(d, "vlsd-phone is-area", "", "s-paper s-text"), false);
        return d;
    }
    paintDemo(d: HTMLElement) {
        const s = this.plugin.settings, obsidian = getComputedStyle(d.doc.body);
        for (const u of UI_COLORS) for (const name of u.vars) { if (s.ui[u.id]) d.style.setProperty(name, s.ui[u.id]); else d.style.removeProperty(name); }
        // the phone is in Obsidian's colours whatever the editor's are
        for (const name of Object.keys(DEFAULTS.colors)) d.style.setProperty(`--vls-${name}`, s.colors[name].replace(/var\((--[\w-]+)[^)]*\)/g, (_, v: string) => obsidian.getPropertyValue(v).trim()));
    }
    display() {
        const { containerEl: c } = this, s = this.plugin.settings;
        this.pickerOff?.(); this.syncs = [];
        c.empty(); c.addClass("vl-settings");
        c.createDiv({ cls: "vls-intro", text: "Colours and fonts follow your Obsidian theme until you change them. An open editor updates at once." });

        // screens
        const sc = this.card(c, "screens", "Screens", s.folder);
        this.input(this.row(sc, "Screens folder", "What the ribbon button opens: one JSON file per screen, made on the first save."), s.folder, (v) => { s.folder = v.trim().replace(/\/+$/, "") || DEFAULTS.folder; this.save(); }, { placeholder: "Screens" });

        // colours: the editor's own and the phones', each card a list with its own preview
        // the preview on top, the colours under it
        const stack = (body: HTMLElement) => [body.createDiv({ cls: "vls-prev" }), body.createDiv({ cls: "vls-list" })];
        const [edPrev, edList] = stack(this.card(c, "editortheme", "Editor theme", ""));
        const [scPrev, co] = stack(this.card(c, "colours", "Screen colours", "").createDiv({ cls: "vls-beside" }));   // the phone beside its colours
        const edDemo = this.demo(edPrev), scDemo = this.demoPhone(scPrev);
        for (const pv of [edPrev, scPrev]) pv.createDiv({ cls: "vls-prevcap", text: "Point at a colour below to see where it is used." });
        const paintDemos = () => { this.paintDemo(edDemo); this.paintDemo(scDemo); };
        const changed = () => { for (const f of this.syncs) f(); paintDemos(); this.queueLook(); };

        const uiGroups: [string, Swatch[]][] = [];
        for (const u of UI_COLORS) {
            let g = uiGroups.find((x) => x[0] === u.group);
            if (!g) uiGroups.push((g = [u.group, []]));
            g[1].push({ key: u.id, name: u.name, follow: u.follow ?? `var(${u.vars[0]})`, get: () => s.ui[u.id], set: (v) => { if (v) s.ui[u.id] = v; else delete s.ui[u.id]; } });
        }
        const pageOf = (title: string, names: string[]): [string, [string, Swatch[]][]] => [title, uiGroups.filter((g) => names.includes(g[0]))];
        this.swatches(edList, "The editor's panels and controls.", [pageOf("Surfaces and lines", ["Surfaces", "Lines"]), pageOf("Text", ["Text"]), pageOf("Accent and signals", ["Accent", "Signals"])],
            [["text", "panels", 4.5, "Panels"], ["text", "field", 4.5, "Input boxes"], ["muted", "panels", 3, "Panels"], ["onaccent", "accent", 3, "Accent"]], changed, edDemo);

        const screens: Swatch[] = Object.keys(s.colors).map((name) => name in DEFAULTS.colors
            ? { key: `s-${name}`, name, desc: SCREEN_USE[name], follow: DEFAULTS.colors[name], get: () => (s.colors[name] === DEFAULTS.colors[name] ? undefined : s.colors[name]), set: (v) => { s.colors[name] = v ?? DEFAULTS.colors[name]; } }
            : { key: `s-${name}`, name, desc: "Your colour", get: () => s.colors[name], set: (v) => { if (v) s.colors[name] = v; }, drop: () => { delete s.colors[name]; } });
        const scPage = (title: string, names: string[]): [string, [string, Swatch[]][]] => [title, [["", screens.filter((e) => !e.drop && names.includes(e.name))]]];
        const scPages = [scPage("Background and lines", ["paper", "tile", "line"]), scPage("Text", ["text", "dim"]), scPage("Accent and warnings", ["accent", "loud"])];
        const mine = screens.filter((e) => e.drop);
        if (mine.length) scPages.push(["Your colours", [["", mine]]]);
        this.swatches(co, "The named colours of the phones you design.", scPages, [["s-text", "s-paper", 4.5, "paper"], ["s-dim", "s-paper", 3, "paper"]], changed, scDemo);
        const add = co.createDiv({ cls: "vls-add" });
        let fresh = "";
        const ni = this.input(add, "", (v) => { fresh = v.trim(); }, { placeholder: "A new colour name" });
        const ab = add.createEl("button", { text: "Add colour" });
        const doAdd = () => { if (!fresh || fresh in s.colors) { ni.focus(); return; } s.colors[fresh] = "#888888"; this.queueLook(); this.display(); };
        ab.addEventListener("click", doAdd);
        ni.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
        paintDemos();

        // fonts: a sample in the font, the name, its CSS value
        const fo = this.card(c, "fonts", "Fonts", `${Object.keys(s.fonts).length} named`);
        const fl = fo.createDiv({ cls: "vls-tokens" });
        for (const name of Object.keys(s.fonts)) {
            const t = fl.createDiv({ cls: "vls-token" });
            const aa = t.createDiv({ cls: "vls-aa", text: "Aa" });
            aa.style.fontFamily = s.fonts[name];
            t.createDiv({ cls: "vls-tname", text: name });
            this.input(t, s.fonts[name], (v) => { s.fonts[name] = v.trim(); aa.style.fontFamily = v; this.queueLook(); }, { cls: "is-mono" });
            t.createDiv();
        }

        // snapping
        const sn = s.snap;
        // editing: number boxes
        const ed = s.edit;
        const eg = this.card(c, "editing", "Editing", `Drag step ×${ed.arrow}`);
        this.input(this.row(eg, "Drag step", "How many steps a number box moves for each notch of a drag (Shift: ten times that)."), String(ed.arrow), (v) => { const n = Number(v); if (n > 0 && n <= 1000) { ed.arrow = n; eg.parentElement?.querySelector(".vls-sum")?.setText(`Drag step ×${n}`); this.save(); } }, { cls: "is-num", type: "number" });
        new ToggleComponent(this.row(eg, "Hold and drag", "Hold a number box, then drag up or down to change it. A click types the value.")).setValue(ed.hold).onChange((v) => { ed.hold = v; this.save(); });

        const sp = this.card(c, "snapping", "Snapping", sn.on ? "On" : "Off");
        const master = this.row(sp, "Snap while dragging", "Blocks and items snap to the lines near them. Alt turns it off for one drag; the magnet under the phone switches it too.");
        const rest = sp.createDiv({ cls: "vls-group" + (sn.on ? "" : " is-off") });
        new ToggleComponent(master).setValue(sn.on).onChange((v) => { sn.on = v; rest.toggleClass("is-off", !v); sp.parentElement?.querySelector(".vls-sum")?.setText(v ? "On" : "Off"); this.save(); });
        const to = this.row(rest, "Snap to", "The frame: an item's block, or a block's screen and safe area.");
        const pill = (text: string, on: () => boolean, flip: () => void) => {
            const b = to.createEl("button", { cls: "vls-pill" + (on() ? " is-on" : ""), text });
            b.addEventListener("click", () => { flip(); b.toggleClass("is-on", on()); this.save(); });
        };
        pill("The frame", () => sn.frame, () => { sn.frame = !sn.frame; });
        pill("Other items", () => sn.others, () => { sn.others = !sn.others; });
        const di = this.row(rest, "Distance", "How near a line pulls, in screen pixels.");
        new SliderComponent(di).setLimits(2, 16, 1).setValue(sn.dist).setDynamicTooltip().onChange((v) => { sn.dist = v; this.save(); });   // Obsidian shows its value
        this.input(this.row(rest, "Grid", "Points a drag steps by when no line is near (1: free); Shift + arrow keys too."), String(sn.grid), (v) => { const n = Math.round(Number(v)); if (n >= 1 && n <= 64) { sn.grid = n; this.save(); } }, { cls: "is-num", type: "number" });
        this.input(this.row(rest, "Margins", "Lines this far inside each edge, comma separated."), sn.margins.join(", "), (v) => { sn.margins = v.split(/[,\s]+/).map(Number).filter((n) => n > 0 && n < 400); this.save(); }, { cls: "is-short", placeholder: "16, 24" });
        new ToggleComponent(this.row(rest, "Guide lines", "Show the line a drag snapped to.")).setValue(sn.guides).onChange((v) => { sn.guides = v; this.save(); });

        // the editor's own colours last: the screens' look comes first
        const edCard = edPrev.closest(".vls-card"); if (edCard) c.appendChild(edCard);

        // back to the theme
        const foot = c.createDiv({ cls: "vls-foot" });
        foot.createSpan({ text: "Back to your Obsidian theme's colours and fonts." });
        const rb = foot.createEl("button", { cls: "mod-warning", text: "Reset look" });
        rb.addEventListener("click", () => { this.plugin.settings = { ...structuredClone(DEFAULTS), folder: s.folder, snap: s.snap, edit: s.edit }; this.queueLook(); this.display(); });
    }
}
const div = (p: HTMLElement, cls: string, text = "", use = "") => { const e = p.createDiv({ cls }); if (text) e.setText(text); if (use) e.setAttr("data-use", use); return e; };
// a row of a colour list. get: undefined while it follows Obsidian; drop: a colour of the user's, removable
type Swatch = { key: string; name: string; desc?: string; follow?: string; get: () => string | undefined; set: (v?: string) => void; drop?: () => void };
const SCREEN_USE: Record<string, string> = { paper: "Screen background", text: "Main text", dim: "Secondary text", line: "Borders", tile: "Cards", loud: "Warnings", accent: "Buttons, highlights" };
// a tile's colour as [r, g, b], if it is solid
const solid = (e: HTMLElement) => { const css = getComputedStyle(e).backgroundColor; if (!css.startsWith("rgb")) return null; const m = (css.match(/[\d.]+/g) ?? []).map(Number); return m.length === 3 || m[3] === 1 ? m : null; };
const luma = (c: number[]) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: number[], b: number[]) => { const x = luma(a), y = luma(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// a folder of the vault, typed to find
class FolderPick extends FuzzySuggestModal<TFolder> {
    constructor(app: App, readonly pick: (f: TFolder) => void) { super(app); this.setPlaceholder("A folder of screens"); }
    getItems() { return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== "/"); }
    getItemText(f: TFolder) { return f.path; }
    onChooseItem(f: TFolder) { this.pick(f); }
}
