import { addIcon, App, FuzzySuggestModal, Menu, normalizePath, Notice, Plugin, PluginSettingTab, setIcon, SliderComponent, TFile, TFolder, ToggleComponent } from "obsidian";
import { EDIT_DEFAULT, EditCfg, FIXED_KEYS, KEY_ACTIONS, comboOf, keyOf, keyText, setKeys, LOOK_WORDS, openVellum, refreshAuto, registerVellum, setEdit, setSnap, SnapCfg, SNAP_DEFAULT, hexOf, hsvToRgb, refreshLook, rgbToHsv } from "./editor";
import { getLocal, setLocal, useApp } from "./local";
import { coloursOfDoc, Doc, docColours, hasAuto } from "./model";
import { NewsModal, newsSince } from "./news";
import { BASE_THEME, Theme, UI_COLORS } from "./render";
import { ungroupBlock } from "./flatten";
import { FolderStore, pageText, storeHooks } from "./store";
import { refreshGuides, writeGuide, writeSkill } from "./guide";

// the mark (ribbon, the editor's tab): a sheet behind a phone with two blocks on its screen; 100 × 100, line icons
const ICON = `<g fill="none" stroke="currentColor" stroke-width="7.3" stroke-linecap="round" stroke-linejoin="round"><rect x="38" y="8" width="48" height="84" rx="11"/><path d="M38 28H20a6 6 0 0 0-6 6v46a6 6 0 0 0 6 6h18"/></g><rect x="50" y="24" width="24" height="10" rx="3" fill="currentColor"/><rect x="50" y="42" width="24" height="33" rx="4" fill="currentColor"/>`;

// Vellum: phone screens drawn and edited in a note (```vellum blocks). The look (named colours and fonts that items use)
// comes from the settings; by default it follows the Obsidian theme.
// folder: the screens the ribbon button opens (one JSON file per screen); made on the first save
// snap: how drags and resizes snap (to the grid, edges, middles, margins, other items)
// edit: number boxes (the arrows' step, hold-and-drag)
// ui: the editor's own colours that differ from Obsidian's (the rest follow it); colors: the phones' named colours
interface Settings { folder: string; colors: Record<string, string>; ui: Record<string, string>; fonts: Record<string, string>; snap: SnapCfg; edit: EditCfg; keys: Record<string, string>; news: boolean; seen?: string }   // news: what's new after an update; seen: the version it was last shown for
const DEFAULTS: Settings = { folder: "Vellum/App", colors: { ...BASE_THEME.colors }, ui: {}, fonts: { ...BASE_THEME.fonts }, snap: { ...SNAP_DEFAULT }, edit: { ...EDIT_DEFAULT }, keys: {}, news: true };

// the folder a path is in; none at the vault's root
const parentOf = (path: string) => { const i = path.lastIndexOf("/"); return i > 0 ? path.slice(0, i) : null; };

export default class VellumPlugin extends Plugin {
    settings: Settings = structuredClone(DEFAULTS);
    async onload() {
        const saved = (await this.loadData()) as Partial<Settings> | null;
        this.settings = { folder: saved?.folder || DEFAULTS.folder, colors: { ...DEFAULTS.colors, ...saved?.colors }, ui: { ...saved?.ui }, fonts: { ...DEFAULTS.fonts, ...saved?.fonts }, snap: { ...SNAP_DEFAULT, ...saved?.snap }, edit: { ...EDIT_DEFAULT, ...saved?.edit }, keys: { ...saved?.keys }, news: saved?.news ?? true, seen: saved?.seen };
        useApp(this.app);
        addIcon("vellum", ICON);
        registerVellum(this, () => ({ theme: this.theme(), ui: this.settings.ui, onFolder: (dir) => { this.settings.folder = dir; void this.save(); } }));
        // Obsidian's theme changed: the screens' copies of its colours need its new values
        this.registerEvent(this.app.workspace.on("css-change", () => { if (Object.keys(this.settings.ui).length) refreshLook(); else refreshAuto(); }));
        setSnap(this.settings.snap, () => { void this.save(); });
        setEdit(this.settings.edit);
        setKeys(this.settings.keys);
        // the editor straight on the screens folder: no note or block needed
        this.addRibbonIcon("vellum", "Open Vellum", () => this.openScreens());
        this.addCommand({ id: "open", name: "Open the screens", callback: () => this.openScreens() });
        this.addCommand({ id: "open-folder", name: "Open screens from another folder", callback: () => new FolderPick(this.app, (f) => { this.settings.folder = f.path; void this.save().then(() => openVellum(f.path)); }).open() });
        this.addCommand({ id: "ungroup-folder", name: "Ungroup every row and column in a folder of screens", callback: () => new FolderPick(this.app, (f) => { void this.ungroupFolder(f.path); }).open() });
        // the guide for agents, written into the vault (no network): VELLUM.md beside the app folders (by itself when a new
        // app is made in a folder that has none), or as a Claude Code skill
        storeHooks.newApp = async (dir) => { const up = parentOf(dir); if (up) await writeGuide(this.app, up, this.manifest.version); };
        this.addCommand({ id: "agent-guide", name: "Add the agent guide", callback: () => {
            const homes = this.vellumFolders();
            new FolderPick(this.app, (f) => { void this.addGuide(f.path); }, homes.length ? homes : undefined, "The folder that holds your app folders (VELLUM.md goes in it)").open();
        } });
        this.addCommand({ id: "agent-skill", name: "Add the agent guide as a Claude Code skill", callback: () => { void writeSkill(this.app, this.manifest.version).then((p) => new Notice(`Vellum: the agent guide is in ${p}`), (e) => new Notice(`Vellum: could not write the skill (${String(e)})`)); } });
        this.addSettingTab(new VellumSettings(this.app, this));
        // after an update: what's new since the version last seen, once. A fresh install shows nothing; settings saved
        // before this existed (no version kept) were made by 0.8.3 or older
        this.app.workspace.onLayoutReady(() => {
            const now = this.manifest.version, seen = this.settings.seen ?? (saved ? "0.8.3" : now);
            if (seen === now && this.settings.seen === now) return;
            const news = newsSince(seen, now);
            this.settings.seen = now; void this.save();
            void refreshGuides(this.app, now).catch(() => { /* the guides stay as they were */ });
            if (news.length && this.settings.news) new NewsModal(this.app, news, () => { this.settings.news = false; void this.save(); }).open();
        });
    }
    theme(): Theme { return { colors: { ...this.settings.colors }, fonts: { ...this.settings.fonts } }; }
    // the screens folder; when it has none (an agent wrote them somewhere else), the folders that do (a _doc.json in
    // them): one opens and becomes the screens folder, several are offered. None anywhere: the folder as set (made on save)
    openScreens() {
        const has = (dir: string) => this.app.vault.getAbstractFileByPath(normalizePath(`${dir}/_doc.json`)) instanceof TFile;
        const use = (dir: string) => { this.settings.folder = dir; void this.save().then(() => openVellum(dir)); };
        if (has(this.settings.folder)) { void openVellum(this.settings.folder); return; }
        const found = this.appFolders();
        if (found.length === 1) { new Notice(`Vellum: screens found in ${found[0].path}, now the screens folder`); use(found[0].path); return; }
        if (found.length > 1) { new FolderPick(this.app, (f) => use(f.path), found).open(); return; }
        void openVellum(this.settings.folder);
    }
    // the folders with a _doc.json in them: one per app
    appFolders(): TFolder[] { return this.app.vault.getFiles().filter((f) => f.name === "_doc.json").map((f) => f.parent).filter((f): f is TFolder => !!f && f.path !== "/"); }
    // the folders that hold app folders (each app's parent; none at the vault's root): where VELLUM.md goes
    vellumFolders(): TFolder[] { return [...new Set(this.appFolders().map((f) => f.parent).filter((f): f is TFolder => !!f && f.path !== "/"))]; }
    async addGuide(dir: string) {
        try {
            const p = await writeGuide(this.app, dir, this.manifest.version);
            new Notice(p ? `Vellum: the agent guide is in ${p}. Point your agent to it once, e.g. in your AGENTS.md.` : `Vellum: ${dir} has a VELLUM.md of its own, left as it is`);
        }
        catch (e) { new Notice(`Vellum: could not write the guide (${String(e)})`); }
    }
    // every row and column on every screen of a folder taken apart, where they are drawn (an agent can call this:
    // app.plugins.plugins.vellum.ungroupFolder("path")). Only the screens that change are written, each in its own file
    async ungroupFolder(dir: string): Promise<{ screens: string[]; count: number }> {
        const store = new FolderStore(this.app, normalizePath(dir)), { doc, error } = await store.load();
        const out = { screens: [] as string[], count: 0 };
        for (const p of doc.pages) {
            let n = 0;
            for (const b of [...p.blocks, ...(p.land ?? [])]) n += ungroupBlock(this.theme(), activeDocument, b);
            const path = store.files.get(p.id), f = path ? this.app.vault.getAbstractFileByPath(path) : null;
            if (!n || !(f instanceof TFile)) continue;
            await this.app.vault.modify(f, pageText(p));
            out.screens.push(p.name); out.count += n;
        }
        new Notice(`Vellum: ${out.count} rows and columns taken apart on ${out.screens.length} screens` + (error ? `. ${error}` : ""));
        return out;
    }
    async save() { await this.saveData(this.settings); }
}

// The settings: tabs (General, Snapping, Keys, Screen colours, Editor theme, Fonts), one shown at a time, each a few cards of compact rows (name and a
// word on the left, the control on the right, centred); colours and fonts as tokens with a swatch / a sample to try them
const TABS = [["general", "General", "sliders-horizontal"], ["snapping", "Snapping", "magnet"], ["keys", "Keys", "keyboard"], ["screens", "Screen colours", "palette"], ["editor", "Editor theme", "paintbrush"], ["fonts", "Fonts", "type"]] as const;
type Tab = (typeof TABS)[number][0];
const TAB_KEY = "vellum:settab";   // the last tab used, kept on the device
const APP_KEY = "vellum:setapp";   // the app whose colours the Screen colours tab shows (none: every app)
class VellumSettings extends PluginSettingTab {
    constructor(app: App, readonly plugin: VellumPlugin) { super(app, plugin); }
    save() { void this.plugin.save(); }
    // a card: a heading (a short summary at its right, if any) and its body
    card(c: HTMLElement, title: string, summary = ""): HTMLElement {
        const card = c.createDiv({ cls: "vls-card" });
        if (!title) return card.createDiv({ cls: "vls-body is-bare" });   // under a tab of its own: no heading
        const head = card.createDiv({ cls: "vls-head" });
        head.createSpan({ cls: "vls-title", text: title });
        head.createSpan({ cls: "vls-sum", text: summary });   // the colour lists fill theirs in ("3 changed")
        return card.createDiv({ cls: "vls-body" });
    }
    tab(): Tab {
        let t: string | null = null;
        try { t = getLocal(TAB_KEY); } catch { /* */ }
        if (t === "colours") t = "screens";   // before the colours had two tabs
        return TABS.find(([k]) => k === t)?.[0] ?? "general";
    }
    // the row of tabs; arrow keys move between them
    // a second row of tabs inside a tab: one part shown, the last one used kept on the device (key)
    subTabs<K extends string>(c: HTMLElement, key: string, list: [K, string, string][]): K {
        let on: string | null = null;
        try { on = getLocal(key); } catch { /* */ }
        const cur = list.find(([k]) => k === on)?.[0] ?? list[0][0];
        const row = c.createDiv({ cls: "vls-subtabs", attr: { role: "tablist" } });
        for (const [k, name, icon] of list) {
            const b = row.createEl("button", { cls: "vls-subtab" + (k === cur ? " is-on" : ""), attr: { role: "tab", "aria-selected": String(k === cur) } });
            setIcon(b.createSpan({ cls: "vls-tabi" }), icon); b.createSpan({ cls: "vls-tabt", text: name, attr: { "data-t": name } });
            b.addEventListener("click", () => { if (k === cur) return; try { setLocal(key, k); } catch { /* */ } this.display(); });
        }
        return cur;
    }
    tabScroll: (() => void) | null = null;
    tabBar(c: HTMLElement, on: Tab) {
        const bar = c.createDiv({ cls: "vls-tabs", attr: { role: "tablist" } });
        // pinned to the top while the settings scroll, on their own background (a band of it above the bar covers the
        // scroller's top padding, whatever Obsidian or a theme makes it); a shadow once something is under it
        this.tabScroll?.();
        const win = c.win, scroller = (() => { for (let e: HTMLElement | null = c; e; e = e.parentElement) { const o = win.getComputedStyle(e).overflowY; if (o === "auto" || o === "scroll") return e; } return null; })();
        if (scroller) {
            for (let e: HTMLElement | null = scroller; e; e = e.parentElement) { const bg = win.getComputedStyle(e).backgroundColor; if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) { bar.style.setProperty("--vls-bg", bg); break; } }
            const onScroll = () => { bar.toggleClass("is-stuck", scroller.scrollTop > 2); };
            scroller.addEventListener("scroll", onScroll, { passive: true });
            // room for the scrollbar kept on every tab: a long tab's scrollbar doesn't narrow the page and shift it
            scroller.addClass("vls-scroller");
            this.tabScroll = () => { scroller.removeEventListener("scroll", onScroll); scroller.removeClass("vls-scroller"); this.tabScroll = null; };
            onScroll();
        }
        const pick = (k: Tab) => { try { setLocal(TAB_KEY, k); } catch { /* */ } this.display(); this.containerEl.querySelector<HTMLElement>(".vls-tab.is-on")?.focus(); };
        TABS.forEach(([k, name, icon], i) => {
            const b = bar.createEl("button", { cls: "vls-tab" + (k === on ? " is-on" : ""), attr: { role: "tab", "aria-selected": String(k === on), tabindex: k === on ? "0" : "-1" } });
            setIcon(b.createSpan({ cls: "vls-tabi" }), icon); b.createSpan({ cls: "vls-tabt", text: name, attr: { "data-t": name } });
            b.addEventListener("click", () => { if (k !== on) pick(k); });
            b.addEventListener("keydown", (e) => {
                // across the row; up and down a row (three tiles to a row)
                const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 3 : e.key === "ArrowUp" ? -3 : 0;
                if (d) { e.preventDefault(); pick(TABS[(i + d + TABS.length) % TABS.length][0]); }
            });
        });
    }
    // a row: its name (and a line under it) on the left, the control on the right
    // a row: an icon, its name and a short line on the left (the whole story on hover: tip), the control on the right
    row(parent: HTMLElement, name: string, desc?: string, icon?: string, tip?: string): HTMLElement {
        const r = parent.createDiv({ cls: "vls-row" });
        if (icon) setIcon(r.createDiv({ cls: "vls-ricon" }), icon);
        const l = r.createDiv({ cls: "vls-label" });
        if (tip) l.setAttr("aria-label", tip);
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
    // the editor's keys: a click on one, then the new key (Esc: as it was); ↺ back to its default. The keys that can't be
    // changed are listed under them, so every key is in one place
    keys(c: HTMLElement) {
        const s = this.plugin.settings, card = this.card(c, "");
        const fixed = ["Escape", "Delete", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight", "Shift+ArrowUp", "Shift+ArrowDown", "Mod+Y", "Tab"];
        for (const a of KEY_ACTIONS) {
            const ctl = this.row(card, a.name, a.desc.replace(/\bMod\b/g, keyText("Mod")), a.icon);
            const b = ctl.createEl("button", { cls: "vls-key", text: keyText(keyOf(a.id)), attr: { "aria-label": "Click, then press the new key" } });
            const stop = () => { b.removeClass("is-rec"); b.setText(keyText(keyOf(a.id))); b.removeEventListener("keydown", rec, true); };
            const rec = (e: KeyboardEvent) => {
                e.preventDefault(); e.stopPropagation();
                if (e.key === "Escape") { stop(); return; }
                const k = comboOf(e); if (!k) return;
                const other = KEY_ACTIONS.find((o) => o.id !== a.id && keyOf(o.id) === k);
                if (other) { new Notice(`Vellum: ${keyText(k)} is already ${other.name}`); return; }
                if (fixed.includes(k)) { new Notice(`Vellum: ${keyText(k)} can't be changed`); return; }
                if (k === a.key) delete s.keys[a.id]; else s.keys[a.id] = k;
                this.save(); this.display();
            };
            b.addEventListener("click", () => { if (b.hasClass("is-rec")) return; b.addClass("is-rec"); b.setText("Press a key…"); b.addEventListener("keydown", rec, true); });
            b.addEventListener("blur", stop);
            if (s.keys[a.id]) {
                const r = ctl.createEl("button", { cls: "vls-keyback", attr: { "aria-label": `Back to ${keyText(a.key)}` } }); setIcon(r, "rotate-ccw");
                r.addEventListener("click", () => { delete s.keys[a.id]; this.save(); this.display(); });
            }
        }
        const fx = this.card(c, "Can't be changed");
        for (const [k, what] of FIXED_KEYS) this.row(fx, what, "", "lock").createSpan({ cls: "vls-key is-fixed", text: keyText(k) });
    }
    // saved and shown a moment after the last change (a drag in the colour picker makes many)
    lookT = 0;
    queueLook() { window.clearTimeout(this.lookT); this.lookT = window.setTimeout(() => { this.save(); refreshLook(); }, 120); }
    hide() { this.pickerOff?.(); this.tabScroll?.(); super.hide(); }
    syncs: (() => void)[] = [];
    // a list of colours: a tile (Vellum's picker), the name, the value ("Obsidian" while it follows), a way back. Follow Obsidian
    // sets the list back, with an undo; rules: pairs [text, background, least contrast, name] that warn on the text's row
    // from: where a colour comes from while it is not set ("Obsidian", or "the settings" for an app's own)
    swatches(body: HTMLElement, blurb: string, pages: [string, [string, Swatch[]][]][], rules: [string, string, number, string][], changed: () => void, demo: HTMLElement, from = "Obsidian") {
        const bar = body.createDiv({ cls: "vls-colbar" }), msg = bar.createSpan({ text: blurb });
        const undo = bar.createEl("button", { text: "Undo" }); undo.hide();
        const follow = bar.createEl("button", { cls: "vls-follow", attr: { "aria-label": `Every colour back to ${from}` } });
        setIcon(follow.createSpan({ cls: "vls-tabi" }), "rotate-ccw"); follow.createSpan({ text: `Follow ${from}` });
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
                const val = field.createEl("input", { cls: "vls-cv", attr: { type: "text", spellcheck: "false", placeholder: from === "Obsidian" ? "Obsidian" : "Settings", "aria-label": `${e.name} value` } });
                const back = field.createEl("button", { cls: "vls-cb", attr: { "aria-label": e.drop ? `Remove ${e.name}` : `Back to ${from}` } });
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
            sum?.setText(n ? `${n} changed` : `Following ${from}`);
            follow.disabled = !n;
        });
        let timer = 0;
        const calm = () => { window.clearTimeout(timer); msg.setText(blurb); undo.hide(); };
        follow.addEventListener("click", () => {
            const before = all.filter((e) => !e.drop).map((e) => [e, e.get()] as const);
            for (const [e] of before) e.set(undefined);
            changed();
            msg.setText(`Now following ${from}`); undo.show();
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
            el.setCssStyles({ color: v }); Object.assign(c, rgba(getComputedStyle(el).color)); el.setCssStyles({ color: "" });
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
        div(rail, "vlsd-h", "Screens · 6", "faint");
        div(rail, "vlsd-r", "Home", "text"); div(rail, "vlsd-r is-sub", "Search", "muted"); div(rail, "vlsd-r is-on", "Plans", "accent"); div(rail, "vlsd-r is-sub is-mock", "Plans B · mock", "mock"); div(rail, "vlsd-r", "Detail", "hover text").setAttr("data-state", "hover"); div(rail, "vlsd-r", "Settings", "text");
        // the device, at the rail's foot: a side area with a button in the panels' colour
        const foot = div(rail, "vlsd-rfoot is-area", "", "device border");
        div(foot, "vlsd-h", "Device", "faint");
        const dv = div(foot, "vlsd-dev", "", "panels border");
        dv.createSpan({ text: "iPhone 16", attr: { "data-use": "text" } }); dv.createSpan({ text: "Phone", attr: { "data-use": "muted" } });
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
    paintDemo(d: HTMLElement, over?: Record<string, string>) {
        const s = this.plugin.settings, obsidian = getComputedStyle(d.doc.body);
        for (const u of UI_COLORS) for (const name of u.vars) { if (s.ui[u.id]) d.style.setProperty(name, s.ui[u.id]); else d.style.removeProperty(name); }
        // the phone is in Obsidian's colours whatever the editor's are
        for (const name of Object.keys(DEFAULTS.colors)) d.style.setProperty(`--vls-${name}`, (over?.[name] ?? s.colors[name]).replace(/var\((--[\w-]+)[^)]*\)/g, (_, v: string) => obsidian.getPropertyValue(v).trim()));
    }
    // a colour card's preview on top, its colours under it
    stack(body: HTMLElement) { return [body.createDiv({ cls: "vls-prev" }), body.createDiv({ cls: "vls-list" })]; }
    // ---- Screen colours: every app's (the settings), or one app's own (its _doc.json: colors, themes, theme), chosen at the top
    appDir = getLocal(APP_KEY) ?? "";   // "": every app
    appData: { dir: string; meta: Record<string, unknown> } | null = null;
    appPart: string | undefined;        // the palette shown: a theme's name, "" the app's colours for every theme
    appT = 0;
    chipHid = 0;   // when a theme chip's menu last closed
    // Screen colours, in one view that fits the window: a bar (the app; its themes, the one it opens in), then its colours.
    // Every app: the settings' colours (what Obsidian's chip shows in every app). An app: its themes, in its _doc.json
    screenColours(c: HTMLElement) {
        const apps = this.plugin.appFolders().map((f) => f.path).sort((x, y) => x.localeCompare(y));
        if (this.appDir && !apps.includes(this.appDir)) this.appDir = "";
        const card = c.createDiv({ cls: "vls-card vls-studio" });
        const bar = card.createDiv({ cls: "vls-sbar" });
        const ag = bar.createDiv({ cls: "vls-sgrp" });
        ag.createSpan({ cls: "vls-slabel", text: "App" });
        const sel = ag.createEl("select", { cls: "dropdown", attr: { "aria-label": "Whose colours: every app's, or one app's themes" } });
        sel.createEl("option", { value: "", text: "Every app" });
        for (const a of apps) sel.createEl("option", { value: a, text: a.split("/").pop() || a, attr: { title: a } });
        sel.value = this.appDir;
        sel.addEventListener("change", () => { this.appDir = sel.value; this.appPart = undefined; try { setLocal(APP_KEY, this.appDir || null); } catch { /* */ } this.display(); });
        if (this.appDir && this.appData?.dir !== this.appDir) { card.createDiv({ cls: "vls-intro", text: "Reading the app…" }); void this.readApp(this.appDir); return; }
        const co = card.createDiv({ cls: "vls-list" }), demo = createDiv();   // (no preview: the rows' hover outlines go nowhere)
        if (this.appDir) this.oneApp(bar, co, demo); else this.everyApp(co, demo);
    }
    // the settings' screen colours: Obsidian's, unless changed here; every app shows them on its Obsidian chip
    everyApp(co: HTMLElement, demo: HTMLElement) {
        const s = this.plugin.settings;
        const changed = () => { for (const f of this.syncs) f(); this.queueLook(); };
        const list: Swatch[] = this.screenOrder(Object.keys(s.colors)).map((name) => name in DEFAULTS.colors
            ? { key: `s-${name}`, name, follow: DEFAULTS.colors[name], get: () => (s.colors[name] === DEFAULTS.colors[name] ? undefined : s.colors[name]), set: (v) => { s.colors[name] = v ?? DEFAULTS.colors[name]; } }
            : { key: `s-${name}`, name, get: () => s.colors[name], set: (v) => { if (v) s.colors[name] = v; }, drop: () => { delete s.colors[name]; } });
        this.swatches(co, "Every app, unless it has a theme.", [["", [["", list]]]], [["s-text", "s-paper", 4.5, "paper"], ["s-dim", "s-paper", 3, "paper"]], changed, demo);
        this.addName(co, (n) => n in s.colors, (n) => { s.colors[n] = "#888888"; this.queueLook(); });
    }
    // the base names in the order they read on a screen, then any others
    screenOrder(names: string[]) { const base = ["paper", "tile", "line", "text", "dim", "accent", "loud"]; return [...base.filter((n) => names.includes(n)), ...names.filter((n) => !base.includes(n))]; }
    addName(parent: HTMLElement, taken: (n: string) => boolean, add: (n: string) => void) {
        const row = parent.createDiv({ cls: "vls-add" });
        let fresh = "";
        const ni = this.input(row, "", (v) => { fresh = v.trim(); }, { placeholder: "New colour name" });
        const ab = row.createEl("button", { text: "Add" });
        const go = () => { if (!fresh || taken(fresh)) { ni.focus(); return; } add(fresh); this.display(); };
        ab.addEventListener("click", go);
        ni.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    }
    async readApp(dir: string) {
        const f = this.app.vault.getAbstractFileByPath(normalizePath(`${dir}/_doc.json`));
        let meta: Record<string, unknown> = {};
        try { if (f instanceof TFile) meta = JSON.parse(await this.app.vault.read(f)) as Record<string, unknown>; }
        catch { new Notice(`Vellum: ${dir}/_doc.json could not be read (fix the JSON)`); this.appDir = ""; }
        if (this.appDir === dir) this.appData = { dir, meta };
        this.display();
    }
    // the app's colours as a doc (only colors, themes, theme), and back into its _doc.json a moment after the last change,
    // its other fields as they were (the screen order last)
    appDoc(): Doc { const d: Doc = { id: "", device: "", pages: [] }; coloursOfDoc(this.appData?.meta ?? {}, d); return d; }
    writeApp(d: Doc) {
        const a = this.appData; if (!a) return;
        if (d.colors && !Object.keys(d.colors).length) delete d.colors;
        const { colors: _c, themes: _t, theme: _n, order, ...rest } = a.meta;
        a.meta = { ...rest, ...(d.colors ? { colors: d.colors } : {}), ...(d.themes ? { themes: d.themes } : {}), ...(d.theme ? { theme: d.theme } : {}), ...(order !== undefined ? { order } : {}) };
        const text = JSON.stringify(a.meta, null, 2) + "\n", path = normalizePath(`${a.dir}/_doc.json`);
        window.clearTimeout(this.appT);
        this.appT = window.setTimeout(() => {
            const f = this.app.vault.getAbstractFileByPath(path);
            if (f instanceof TFile) void this.app.vault.modify(f, text); else new Notice(`Vellum: ${path} is gone; not written`);
        }, 300);
    }
    // one app: its themes (chips, the one it opens in, a name, a copy, gone), then the colours of the theme shown beside a phone
    // one app: its themes as chips in the bar (Obsidian: the colours of every app; ⋯ on the one shown renames, copies or
    // deletes it; + a new one of any name), the one it opens in, then the colours of the theme shown. The same parts as
    // the editor's Colours window
    oneApp(bar: HTMLElement, co: HTMLElement, demo: HTMLElement) {
        const s = this.plugin.settings, d = this.appDoc(), themes = d.themes ?? {}, names = Object.keys(themes);
        if (this.appPart && !(this.appPart in themes)) this.appPart = undefined;
        const part = this.appPart ?? (d.theme && d.theme in themes ? d.theme : "");
        const save = (redraw = true) => { this.writeApp(d); if (redraw) this.display(); };
        // a new theme starts as the colours shown now, as hex
        const seed = () => {
            const o: Record<string, string> = {}, tmp = activeDocument.body.createDiv({ cls: "vlsd-solo" });
            this.paintDemo(tmp, docColours(d, part || undefined)); const cs = getComputedStyle(tmp);
            for (const n of Object.keys(DEFAULTS.colors)) { tmp.style.color = `var(--vls-${n})`; const m = (cs.color.match(/[\d.]+/g) ?? []).map(Number); o[n] = hexOf({ r: m[0] ?? 0, g: m[1] ?? 0, b: m[2] ?? 0, a: m.length > 3 ? m[3] : 1 }); }
            tmp.remove();
            return o;
        };
        const taken = (n: string) => !n || n in themes || n === "auto" || n === "Obsidian";
        const tg = bar.createDiv({ cls: "vls-sgrp is-themes" });
        tg.createSpan({ cls: "vls-slabel", text: "Theme" });
        const chips = tg.createDiv({ cls: "vls-chips" });
        // a chip turned into a field for a name: Enter keeps it, Esc puts it back
        const field = (at: HTMLElement, value: string, done: (v: string) => void) => {
            const i = createEl("input", { cls: "vls-chipin", attr: { type: "text", spellcheck: "false", placeholder: "Theme name" } });
            i.value = value; at.replaceWith(i); i.focus(); i.select();
            let over = false;
            const end = (keep: boolean) => {
                if (over) return; over = true;
                const v = i.value.trim();
                if (!keep || !v || v === value) { this.display(); return; }
                if (taken(v)) { new Notice(`Vellum: ${v} is taken`); this.display(); return; }
                done(v);
            };
            i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); end(true); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); } });
            i.addEventListener("blur", () => end(true));
        };
        const chip = (label: string, key: string) => {
            const b = chips.createEl("button", { cls: "vls-pill" + (part === key ? " is-on" : ""), text: label });
            if (key === "") b.setAttr("aria-label", LOOK_WORDS.obsidian);
            b.addEventListener("click", () => { if (part !== key) { this.appPart = key; this.display(); } });
            return b;
        };
        chip("Obsidian", "");
        for (const n of names) {
            const b = chip(n, n);
            if (part !== n) continue;
            // the theme shown: a click on it again opens its menu
            const chev = b.createSpan({ cls: "vls-pillx" }); setIcon(chev, "chevron-down"); b.setAttr("aria-label", `${n}: rename, copy or delete`);
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                if (Date.now() - this.chipHid < 300) return;   // the press that closed it: a toggle, not open again
                const m = new Menu();
                setIcon(chev, "chevron-up"); b.addClass("is-open");
                m.onHide(() => { this.chipHid = Date.now(); setIcon(chev, "chevron-down"); b.removeClass("is-open"); });
                m.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => field(b, n, (to) => {
                    d.themes = Object.fromEntries(Object.entries(themes).map(([k, v]) => [k === n ? to : k, v]));
                    if (d.theme === n) d.theme = to;
                    this.appPart = to; save();
                })));
                m.addItem((i) => i.setTitle("Copy").setIcon("copy").onClick(() => { let c = `${n} copy`, k = 2; while (c in themes) c = `${n} copy ${k++}`; d.themes = { ...themes, [c]: { ...themes[n] } }; this.appPart = c; save(); }));
                m.addItem((i) => i.setTitle("Delete").setIcon("trash-2").onClick(() => {
                    const rest = { ...themes }; delete rest[n];
                    if (Object.keys(rest).length) d.themes = rest; else delete d.themes;
                    if (d.theme === n || (d.theme === "auto" && !hasAuto(d)) || !d.themes) delete d.theme;
                    this.appPart = undefined; save();
                }));
                const r = b.getBoundingClientRect();
                m.showAtPosition({ x: r.left, y: r.bottom + 4 }, b.doc);
            });
        }
        const plus = chips.createEl("button", { cls: "vls-pill is-add", attr: { "aria-label": LOOK_WORDS.fresh } }); setIcon(plus, "plus");
        plus.addEventListener("click", () => field(plus, "", (n) => { d.themes = { ...themes, [n]: part ? { ...docColours(d, part) } : seed() }; this.appPart = n; save(); }));
        const og = createDiv({ cls: "vls-sgrp" });   // into the colours' bar below, once it is drawn
        if (names.length) {
            og.createSpan({ cls: "vls-slabel", text: "Default theme" });
            const opens = og.createEl("select", { cls: "dropdown", attr: { "aria-label": "The theme the app opens in (its theme in _doc.json): the editor shows it first, an agent builds it as the default" } });
            opens.createEl("option", { value: "", text: "Obsidian" });
            if (hasAuto(d)) opens.createEl("option", { value: "auto", text: "Auto (light / dark)" });
            for (const n of names) opens.createEl("option", { value: n, text: n });
            opens.value = d.theme && (d.theme === "auto" ? hasAuto(d) : d.theme in themes) ? d.theme : "";
            opens.addEventListener("change", () => { if (opens.value) d.theme = opens.value; else delete d.theme; save(false); });
        }
        // Obsidian's chip: every app's colours, set under Every app
        if (!part) {
            const cb = co.createDiv({ cls: "vls-colbar" });
            if (og.childElementCount) cb.appendChild(og);
            cb.createSpan({ text: "Set under Every app. + adds a theme." });
            const g = co.createDiv({ cls: "vls-groups" }).createDiv({ cls: "vls-group" });
            const look = docColours(d);
            for (const name of this.screenOrder(Object.keys(s.colors))) {
                const r = g.createDiv({ cls: "vls-colour is-fixed" });
                r.createDiv({ cls: "vls-cname" }).createDiv({ cls: "vls-cn", text: name });
                const f = r.createDiv({ cls: "vls-cf" });
                const ch = f.createSpan({ cls: "vls-chip" }).createSpan();
                ch.style.background = (look[name] ?? s.colors[name]).replace(/var\((--[\w-]+)[^)]*\)/g, (_, v: string) => getComputedStyle(activeDocument.body).getPropertyValue(v).trim());
                f.createSpan({ cls: "vls-cv", text: look[name] ?? (s.colors[name] === DEFAULTS.colors[name] ? "Obsidian" : s.colors[name]) });
            }
            return;
        }
        // a theme's colours: unset ones come from Obsidian's chip
        const pal = (): Record<string, string> => (d.themes![part] ??= {});
        const changed = () => { for (const f of this.syncs) f(); save(false); };
        const own = [...new Set([...Object.keys(d.colors ?? {}), ...names.flatMap((n) => Object.keys(themes[n]))])].filter((n) => !(n in s.colors));
        const list: Swatch[] = this.screenOrder([...Object.keys(s.colors), ...own]).map((name) => ({
            key: `s-${name}`, name, follow: s.colors[name],
            get: () => pal()[name], set: (v) => { if (v) pal()[name] = v; else delete pal()[name]; },
            ...(name in s.colors ? {} : { drop: () => { for (const t of names) delete themes[t][name]; save(false); } }),
        }));
        this.swatches(co, "", [["", [["", list]]]], [["s-text", "s-paper", 4.5, "paper"], ["s-dim", "s-paper", 3, "paper"]], changed, demo, "Obsidian");
        if (og.childElementCount) co.querySelector(".vls-colbar")?.prepend(og);
        this.addName(co, (n) => n in s.colors || n in pal(), (n) => { for (const t of names) themes[t][n] = "#888888"; save(false); });
    }
    display() {
        const { containerEl: c } = this, s = this.plugin.settings;
        this.pickerOff?.(); this.syncs = [];
        c.empty(); c.addClass("vl-settings");
        const tab = this.tab();
        this.tabBar(c, tab);
        if (tab === "general") {
            // General's parts as tabs of their own, one shown
            const part = this.subTabs(c, "vellum:setgeneral", [["screens", "Screens", "folder-open"], ["editing", "Editing", "mouse-pointer-2"], ["updates", "Updates", "sparkles"]]);
            if (part === "screens") {
                const sc = this.card(c, "");
                this.input(this.row(sc, "Screens folder", "Opened by the ribbon button.", "folder-open", "One JSON file per screen, made on the first save. If it has no screens, Vellum offers the folders that do."), s.folder, (v) => { s.folder = v.trim().replace(/\/+$/, "") || DEFAULTS.folder; this.save(); }, { placeholder: "Vellum/App" });
            } else if (part === "editing") {
                // number boxes, marks
                const ed = s.edit;
                const eg = this.card(c, "");
                this.input(this.row(eg, "Drag step", "Per notch of a drag. Shift: ×10.", "move"), String(ed.arrow), (v) => { const n = Number(v); if (n > 0 && n <= 1000) { ed.arrow = n; this.save(); } }, { cls: "is-num", type: "number" });
                this.input(this.row(eg, "Mark text size", "Notes and area names, in px.", "baseline", "In pixels on the monitor, when a mark sets none."), String(ed.markSize), (v) => { const n = Math.round(Number(v)); if (n >= 8 && n <= 40) { ed.markSize = n; this.save(); refreshLook(); } }, { cls: "is-num", type: "number" });
                this.input(this.row(eg, "Note width", "Empty: as wide as its text.", "sticky-note", "In pixels, when a note sets none. Empty or 0: as wide as its text, up to 200."), ed.noteW ? String(ed.noteW) : "", (v) => { const n = Math.round(Number(v || 0)); if (n === 0 || (n >= 60 && n <= 600)) { ed.noteW = n; this.save(); refreshLook(); } }, { cls: "is-num", type: "number", placeholder: "Auto" });
                new ToggleComponent(this.row(eg, "Hold and drag", "Hold a number, drag to change.", "hand", "Hold a number box, then drag up or down. A click types the value.")).setValue(ed.hold).onChange((v) => { ed.hold = v; this.save(); });
            } else {
                const up = this.card(c, "");
                new ToggleComponent(this.row(up, "Show what's new", "Once, after each update.", "sparkles")).setValue(s.news).onChange((v) => { s.news = v; this.save(); });
            }
        } else if (tab === "snapping") {
            const sn = s.snap, sp = this.card(c, "");
            const master = this.row(sp, "Snap while dragging", "Alt: off for one drag.", "magnet", "Blocks and items snap to the lines near them. The magnet under the phone switches it too.");
            const rest = sp.createDiv({ cls: "vls-group" + (sn.on ? "" : " is-off") });
            new ToggleComponent(master).setValue(sn.on).onChange((v) => { sn.on = v; rest.toggleClass("is-off", !v); this.save(); });
            const to = this.row(rest, "Snap to", "", "crosshair", "The frame: an item's block, or a block's screen and safe area.");
            const pill = (text: string, on: () => boolean, flip: () => void, icon = "") => {
                const b = to.createEl("button", { cls: "vls-pill" + (on() ? " is-on" : "") });
                if (icon) setIcon(b.createSpan({ cls: "vls-tabi" }), icon);
                b.createSpan({ text });
                b.addEventListener("click", () => { flip(); b.toggleClass("is-on", on()); this.save(); });
            };
            pill("The frame", () => sn.frame, () => { sn.frame = !sn.frame; }, "frame");
            pill("Other items", () => sn.others, () => { sn.others = !sn.others; }, "layers");
            const di = this.row(rest, "Distance", "How near a line pulls.", "ruler", "In screen pixels.");
            new SliderComponent(di).setLimits(2, 16, 1).setValue(sn.dist).setDynamicTooltip().onChange((v) => { sn.dist = v; this.save(); });   // Obsidian shows its value
            this.input(this.row(rest, "Grid", "Step with no line near. 1: free.", "layout-grid", "Points a drag steps by when no line is near; Shift + arrow keys too."), String(sn.grid), (v) => { const n = Math.round(Number(v)); if (n >= 1 && n <= 64) { sn.grid = n; this.save(); } }, { cls: "is-num", type: "number" });
            this.input(this.row(rest, "Margins", "Lines inside each edge.", "square-dashed", "Comma separated, in points."), sn.margins.join(", "), (v) => { sn.margins = v.split(/[,\s]+/).map(Number).filter((n) => n > 0 && n < 400); this.save(); }, { cls: "is-short", placeholder: "16, 24" });
            new ToggleComponent(this.row(rest, "Guide lines", "Show the line snapped to.", "align-center-vertical")).setValue(sn.guides).onChange((v) => { sn.guides = v; this.save(); });
        } else if (tab === "keys") {
            this.keys(c);
        } else if (tab === "editor") {
            // the editor's own colours, in one view: the preview on top, every colour under it in columns
            const card = c.createDiv({ cls: "vls-card vls-studio is-editor" });
            const [edPrev, edList] = this.stack(card);
            const edDemo = this.demo(edPrev);
            const changed = () => { for (const f of this.syncs) f(); this.paintDemo(edDemo); this.queueLook(); };
            const list: Swatch[] = UI_COLORS.map((u) => ({ key: u.id, name: u.name, follow: u.follow ?? `var(${u.vars[0]})`, get: () => s.ui[u.id], set: (v) => { if (v) s.ui[u.id] = v; else delete s.ui[u.id]; } }));
            this.swatches(edList, "Point at one to see it above.", [["", [["", list]]]],
                [["text", "panels", 4.5, "Panels"], ["text", "field", 4.5, "Input boxes"], ["muted", "panels", 3, "Panels"], ["onaccent", "accent", 3, "Accent"]], changed, edDemo);
            this.paintDemo(edDemo);
        } else if (tab === "screens") {
            this.screenColours(c);
        } else {
            c.createDiv({ cls: "vls-intro", text: "Follow Obsidian until changed." });
            // fonts: a sample in the font, the name, its CSS value
            const fo = this.card(c, "Fonts", `${Object.keys(s.fonts).length} named`);
            const fl = fo.createDiv({ cls: "vls-tokens" });
            for (const name of Object.keys(s.fonts)) {
                const t = fl.createDiv({ cls: "vls-token" });
                const aa = t.createDiv({ cls: "vls-aa", text: "Aa" });
                aa.style.fontFamily = s.fonts[name];
                t.createDiv({ cls: "vls-tname", text: name });
                this.input(t, s.fonts[name], (v) => { s.fonts[name] = v.trim(); aa.style.fontFamily = v; this.queueLook(); }, { cls: "is-mono" });
                t.createDiv();
            }

        }
        if (tab === "general" || tab === "snapping" || (tab === "screens" && this.appDir)) return;   // (an app's own colours: not the settings' look)
        // back to the theme
        const foot = c.createDiv({ cls: "vls-foot" });
        foot.createSpan({ text: "Back to Obsidian's colours and fonts." });
        const rb = foot.createEl("button", { cls: "mod-warning vls-follow" });
        setIcon(rb.createSpan({ cls: "vls-tabi" }), "rotate-ccw"); rb.createSpan({ text: "Reset look" });
        rb.addEventListener("click", () => { this.plugin.settings = { ...structuredClone(DEFAULTS), folder: s.folder, snap: s.snap, edit: s.edit }; this.queueLook(); this.display(); });
    }
}
const div = (p: HTMLElement, cls: string, text = "", use = "") => { const e = p.createDiv({ cls }); if (text) e.setText(text); if (use) e.setAttr("data-use", use); return e; };
// a row of a colour list. get: undefined while it follows Obsidian; drop: a colour of the user's, removable
type Swatch = { key: string; name: string; desc?: string; follow?: string; get: () => string | undefined; set: (v?: string) => void; drop?: () => void };
// a tile's colour as [r, g, b], if it is solid
const solid = (e: HTMLElement) => { const css = getComputedStyle(e).backgroundColor; if (!css.startsWith("rgb")) return null; const m = (css.match(/[\d.]+/g) ?? []).map(Number); return m.length === 3 || m[3] === 1 ? m : null; };
const luma = (c: number[]) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: number[], b: number[]) => { const x = luma(a), y = luma(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// a folder of the vault, typed to find
class FolderPick extends FuzzySuggestModal<TFolder> {
    constructor(app: App, readonly pick: (f: TFolder) => void, readonly only?: TFolder[], hint?: string) { super(app); this.setPlaceholder(hint ?? (only ? "Screens found in these folders: open one" : "A folder of screens")); }
    getItems() { return this.only ?? this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== "/"); }
    getItemText(f: TFolder) { return f.path; }
    onChooseItem(f: TFolder) { this.pick(f); }
}
