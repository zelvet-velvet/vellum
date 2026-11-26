import { addIcon, App, FuzzySuggestModal, Menu, normalizePath, Notice, Plugin, PluginSettingTab, setIcon, SliderComponent, TFile, TFolder, ToggleComponent } from "obsidian";
import { EDIT_DEFAULT, EditCfg, FIXED_KEYS, KEY_ACTIONS, comboOf, keyOf, keyText, setKeys, LOOK_WORDS, openVellum, refreshAuto, registerVellum, setEdit, setSnap, SnapCfg, SNAP_DEFAULT, setMeasure, MeasureCfg, MEASURE_DEFAULT, STRIPES, hexOf, hsvToRgb, refreshLook, rgbToHsv } from "./editor";
import { getLocal, setLocal, useApp } from "./local";
import { coloursOfDoc, Doc, docColours, hasAuto } from "./model";
import { NewsModal, newsSince } from "./news";
import { BASE_THEME, EDITOR_THEMES, modeOf, Theme, UI_COLORS } from "./render";
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
// ui: the editor's own colours that differ from Obsidian's (the rest follow it), the Obsidian chip of Editor theme;
// uiThemes: the editor's named themes (Ledgerline light and dark to start), uiTheme the one in use ("": Obsidian); colors: the phones' named colours
interface Settings { folder: string; colors: Record<string, string>; ui: Record<string, string>; uiThemes: Record<string, Record<string, string>>; uiTheme: string; fonts: Record<string, string>; snap: SnapCfg; measure: MeasureCfg; edit: EditCfg; keys: Record<string, string>; news: boolean; seen?: string }   // news: what's new after an update; seen: the version it was last shown for
const DEFAULTS: Settings = { folder: "Vellum/App", colors: { ...BASE_THEME.colors }, ui: {}, uiThemes: structuredClone(EDITOR_THEMES), uiTheme: "", fonts: { ...BASE_THEME.fonts }, snap: { ...SNAP_DEFAULT }, measure: { ...MEASURE_DEFAULT }, edit: { ...EDIT_DEFAULT }, keys: {}, news: true };

// the folder a path is in; none at the vault's root
const parentOf = (path: string) => { const i = path.lastIndexOf("/"); return i > 0 ? path.slice(0, i) : null; };

// the saved measure settings, only the ones there are now (older versions kept more)
// the editor theme in use: its name ("": Obsidian), its colours (the Obsidian chip's under a theme's own) and whether it
// is light or dark (none for Obsidian's: the editor is as Obsidian is)
const uiColoursOf = (s: Settings, name: string) => (name && s.uiThemes[name] ? { ...s.ui, ...s.uiThemes[name] } : s.ui);
const uiInUse = (s: Settings) => {
    const name = s.uiTheme in s.uiThemes ? s.uiTheme : "";
    const ui = uiColoursOf(s, name);
    return { name, ui, mode: name ? modeOf(ui) : undefined };
};
const measureOf = (m?: Partial<MeasureCfg>): MeasureCfg => {
    const o = { ...MEASURE_DEFAULT };
    for (const key of Object.keys(o) as (keyof MeasureCfg)[]) if (m?.[key] !== undefined) (o as Record<string, unknown>)[key] = m[key];
    return o;
};
export default class VellumPlugin extends Plugin {
    settings: Settings = structuredClone(DEFAULTS);
    async onload() {
        const saved = (await this.loadData()) as Partial<Settings> | null;
        this.settings = { folder: saved?.folder || DEFAULTS.folder, colors: { ...DEFAULTS.colors, ...saved?.colors }, ui: { ...saved?.ui }, uiThemes: saved?.uiThemes ? { ...saved.uiThemes } : structuredClone(EDITOR_THEMES), uiTheme: saved?.uiTheme ?? "", fonts: { ...DEFAULTS.fonts, ...saved?.fonts }, snap: { ...SNAP_DEFAULT, ...saved?.snap }, measure: measureOf(saved?.measure), edit: { ...EDIT_DEFAULT, ...saved?.edit }, keys: { ...saved?.keys }, news: saved?.news ?? true, seen: saved?.seen };
        useApp(this.app);
        addIcon("vellum", ICON);
        registerVellum(this, () => { const t = uiInUse(this.settings); return { theme: this.theme(), ui: t.ui, mode: t.mode, onFolder: (dir) => { this.settings.folder = dir; void this.save(); } }; });
        // Obsidian's theme changed: the screens' copies of its colours need its new values
        this.registerEvent(this.app.workspace.on("css-change", () => { if (this.settings.uiTheme || Object.keys(this.settings.ui).length) refreshLook(); else refreshAuto(); }));
        setSnap(this.settings.snap, () => { void this.save(); });
        setEdit(this.settings.edit);
        setMeasure(this.settings.measure);
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

// The settings: tabs (General, with Fonts among its parts, Snapping, Measure, Keys, Screen colours, Editor theme), one shown at a time, each a few cards of compact rows (name and a
// word on the left, the control on the right, centred); colours and fonts as tokens with a swatch / a sample to try them
const TABS = [["general", "General", "sliders-horizontal"], ["snapping", "Snapping", "magnet"], ["measure", "Measure", "ruler"], ["keys", "Keys", "keyboard"], ["screens", "Screen colours", "palette"], ["editor", "Editor theme", "paintbrush"]] as const;
type Tab = (typeof TABS)[number][0];
const TAB_KEY = "vellum:settab";   // the tab on show (General → Screens again each time the settings open)
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
        if (t === "fonts") { t = "general"; try { setLocal("vellum:setgeneral", "fonts"); } catch { /* */ } }   // Fonts is a part of General now
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
    tabBar(c: HTMLElement, on: Tab) {
        // above the tab's own scrolling part (display): the tiles stay in view and the scrollbar starts under them
        const bar = c.createDiv({ cls: "vls-tabs", attr: { role: "tablist" } });
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
    // closed: the next time it opens on General → Screens (a tab chosen lasts while the settings are open)
    hide() { this.pickerOff?.(); this.uiDrafts.clear(); try { setLocal(TAB_KEY, "general"); setLocal("vellum:setgeneral", "screens"); } catch { /* */ } super.hide(); }
    syncs: (() => void)[] = [];
    // a list of colours: a tile (Vellum's picker), the name, the value ("Obsidian" while it follows), a way back. Follow Obsidian
    // sets the list back, with an undo; rules: pairs [text, background, least contrast, name] that warn on the text's row
    // from: where a colour comes from while it is not set ("Obsidian", or "the settings" for an app's own)
    swatches(body: HTMLElement, blurb: string, pages: [string, [string, Swatch[]][]][], rules: [string, string, number, string][], changed: () => void, demo: HTMLElement, from = "Obsidian", followAll = true) {
        const bar = body.createDiv({ cls: "vls-colbar" }), msg = bar.createSpan({ text: blurb });
        const undo = bar.createEl("button", { text: "Undo" }); undo.hide();
        const follow = bar.createEl("button", { cls: "vls-follow", attr: { "aria-label": `Every colour back to ${from}` } });
        setIcon(follow.createSpan({ cls: "vls-tabi" }), "rotate-ccw"); follow.createSpan({ text: `Follow ${from}` });
        if (!followAll) follow.hide();
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
        div(rail, "vlsd-r", "Home", "text"); div(rail, "vlsd-r is-sub", "Search", "muted"); div(rail, "vlsd-r is-on", "Plans", "accent"); div(rail, "vlsd-r is-sub is-mock", "Plans B · mock", "mock"); div(rail, "vlsd-r", "Detail", "hover text").setAttr("data-state", "hover"); div(rail, "vlsd-r is-sub is-changed", "Log · changed", "changed"); div(rail, "vlsd-r is-edited", "Goals · edited", "edited");
        // the device, at the rail's foot: a side area with a button in the panels' colour
        const foot = div(rail, "vlsd-rfoot is-area", "", "device border");
        div(foot, "vlsd-h", "Device", "faint");
        const dv = div(foot, "vlsd-dev", "", "panels border");
        dv.createSpan({ text: "iPhone 16", attr: { "data-use": "text" } }); dv.createSpan({ text: "Phone", attr: { "data-use": "muted" } });
        const stage = div(body, "vlsd-stage is-area", "", "side");
        // no phone on the stage: a screen's colours are the app's, not the editor's. What the editor draws there instead: the
        // screen's outline, a chosen block and its handle, a snap guide, a measured gap
        const frame = div(stage, "vlsd-frame", "", "border");
        div(frame, "vlsd-fg", "", "guide");
        div(div(frame, "vlsd-blk", "", "accent"), "vlsd-grip", "", "accent");
        div(frame, "vlsd-ms", "", "measure").createSpan({ text: "16" });
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
        const s = this.plugin.settings, obsidian = getComputedStyle(d.doc.body), shown = this.uiShown(), draft = this.uiDrafts.get(shown), ui = draft ? (shown ? { ...s.ui, ...draft } : draft) : uiColoursOf(s, shown);
        for (const u of UI_COLORS) for (const name of u.vars) { if (ui[u.id]) d.style.setProperty(name, ui[u.id]); else d.style.removeProperty(name); }
        // the phone is in Obsidian's colours whatever the editor's are
        for (const name of Object.keys(DEFAULTS.colors)) d.style.setProperty(`--vls-${name}`, (over?.[name] ?? s.colors[name]).replace(/var\((--[\w-]+)[^)]*\)/g, (_, v: string) => obsidian.getPropertyValue(v).trim()));
    }
    // a colour card's preview on top, its colours under it
    stack(body: HTMLElement) { return [body.createDiv({ cls: "vls-prev" }), body.createDiv({ cls: "vls-list" })]; }
    // ---- Editor theme: Obsidian's colours (and changes to them), or a theme of the editor's own, as chips. A click on a chip
    // uses it and shows its colours under the preview
    uiPart: string | undefined;   // the chip shown (a theme's name; "" Obsidian): the one in use until another is clicked
    uiDrafts = new Map<string, Record<string, string>>();   // a chip's colours changed and not saved yet, by its name ("": Obsidian)
    uiShown() { const s = this.plugin.settings, p = this.uiPart ?? s.uiTheme; return p in s.uiThemes ? p : ""; }
    editorTheme(c: HTMLElement) {
        const s = this.plugin.settings, themes = s.uiThemes, names = Object.keys(themes), part = this.uiShown();
        const card = c.createDiv({ cls: "vls-card vls-studio is-editor" });
        const bar = card.createDiv({ cls: "vls-sbar" });
        const use = (k: string) => { s.uiTheme = k; this.uiPart = k; this.queueLook(); this.display(); };
        this.themeChips(bar, names, part, {
            tip: "Your Obsidian theme's colours, with any you change here",
            taken: (n) => n in themes,
            pick: use,
            rename: (n, to) => {
                s.uiThemes = Object.fromEntries(Object.entries(themes).map(([k, v]) => [k === n ? to : k, v]));
                if (s.uiTheme === n) s.uiTheme = to;
                const d = this.uiDrafts.get(n); if (d) { this.uiDrafts.delete(n); this.uiDrafts.set(to, d); }
                this.uiPart = to; this.queueLook(); this.display();
            },
            copy: (n, to) => { themes[to] = { ...themes[n] }; use(to); },
            drop: (n) => { delete themes[n]; this.uiDrafts.delete(n); if (s.uiTheme === n) s.uiTheme = ""; this.uiPart = undefined; this.queueLook(); this.display(); },
            // a new theme starts as the colours shown now
            add: (n) => { themes[n] = { ...uiColoursOf(s, part), ...this.uiDrafts.get(part) }; use(n); },
        });
        // the preview stays in view (on top, or on the left on a wide pane); the colours, by group, scroll on their own
        c.addClass("is-fill");
        const split = card.createDiv({ cls: "vls-edsplit" });
        const edPrev = split.createDiv({ cls: "vls-prev" }), edList = split.createDiv({ cls: "vls-list" });
        const edDemo = this.demo(edPrev);
        // changes are a draft (the preview shows it) until Save; Reset drops it. Unset colours of a theme: as the Obsidian chip
        const saved = () => (part ? themes[part] ?? {} : s.ui);
        const pal = (): Record<string, string> => { let d = this.uiDrafts.get(part); if (!d) this.uiDrafts.set(part, (d = { ...saved() })); return d; };
        let state = () => {};
        const changed = () => {
            const d = this.uiDrafts.get(part);
            if (d && JSON.stringify(Object.entries(d).sort()) === JSON.stringify(Object.entries(saved()).sort())) this.uiDrafts.delete(part);
            for (const f of this.syncs) f(); this.paintDemo(edDemo); state();
        };
        const groups = [...new Set(UI_COLORS.map((u) => u.group))].map((g): [string, Swatch[]] => [g, UI_COLORS.filter((u) => u.group === g).map((u) => ({
            key: u.id, name: u.name, follow: (part ? s.ui[u.id] : undefined) ?? u.follow ?? `var(${u.vars[0]})`,
            get: () => (this.uiDrafts.get(part) ?? saved())[u.id], set: (v) => { if (v) pal()[u.id] = v; else delete pal()[u.id]; },   // (reading starts no draft)
        }))]);
        const blurb = part ? "Unset ones: as the Obsidian chip." : "Point at one to see it.";
        this.swatches(edList, blurb, [["", groups]],
            [["text", "panels", 4.5, "Panels"], ["text", "field", 4.5, "Input boxes"], ["muted", "panels", 3, "Panels"], ["onaccent", "accent", 3, "Accent"]], changed, edDemo, "Obsidian", !part);
        const cb = edList.querySelector<HTMLElement>(".vls-colbar")!, msg = cb.firstElementChild as HTMLElement;
        const reset = cb.createEl("button", { text: "Reset", attr: { "aria-label": "Back to the colours last saved" } });
        const save = cb.createEl("button", { cls: "mod-cta", text: "Save" });
        state = () => { const on = this.uiDrafts.has(part); reset.toggle(on); save.toggle(on); if (on) msg.setText("Colours changed"); else if (msg.getText() === "Colours changed") msg.setText(blurb); };
        reset.addEventListener("click", () => { this.uiDrafts.delete(part); this.display(); });
        save.addEventListener("click", () => {
            const d = this.uiDrafts.get(part); if (!d) return;
            if (part) themes[part] = d; else s.ui = d;
            this.uiDrafts.delete(part); this.queueLook(); this.display();
        });
        state();
        this.paintDemo(edDemo);
    }
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
    // a bar's theme chips: Obsidian, then each theme (a click on the one shown opens its menu: rename, copy, delete), + a new
    // one of any name. Shared by Screen colours (an app's themes) and Editor theme
    themeChips(bar: HTMLElement, names: string[], part: string, o: { tip: string; taken: (n: string) => boolean; pick: (key: string) => void; rename: (n: string, to: string) => void; copy: (n: string, to: string) => void; drop: (n: string) => void; add: (n: string) => void }) {
        const taken = (n: string) => !n || n === "Obsidian" || o.taken(n);
        const tg = bar.createDiv({ cls: "vls-sgrp is-themes" });
        tg.createSpan({ cls: "vls-slabel", text: "Theme" });
        const chips = tg.createDiv({ cls: "vls-chips" });
        // a chip turned into a field for a name: Enter or a click elsewhere keeps it, Esc puts it back
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
            if (key === "") b.setAttr("aria-label", o.tip);
            b.addEventListener("click", () => { if (part !== key) o.pick(key); });
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
                m.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => field(b, n, (to) => o.rename(n, to))));
                m.addItem((i) => i.setTitle("Copy").setIcon("copy").onClick(() => { let c = `${n} copy`, k = 2; while (taken(c)) c = `${n} copy ${k++}`; o.copy(n, c); }));
                m.addItem((i) => i.setTitle("Delete").setIcon("trash-2").onClick(() => o.drop(n)));
                const r = b.getBoundingClientRect();
                m.showAtPosition({ x: r.left, y: r.bottom + 4 }, b.doc);
            });
        }
        const plus = chips.createEl("button", { cls: "vls-pill is-add", attr: { "aria-label": LOOK_WORDS.fresh } }); setIcon(plus, "plus");
        plus.addEventListener("click", () => field(plus, "", o.add));
        return tg;
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
        this.themeChips(bar, names, part, {
            tip: LOOK_WORDS.obsidian,
            taken: (n) => n in themes || n === "auto",
            pick: (k) => { this.appPart = k; this.display(); },
            rename: (n, to) => {
                d.themes = Object.fromEntries(Object.entries(themes).map(([k, v]) => [k === n ? to : k, v]));
                if (d.theme === n) d.theme = to;
                this.appPart = to; save();
            },
            copy: (n, to) => { d.themes = { ...themes, [to]: { ...themes[n] } }; this.appPart = to; save(); },
            drop: (n) => {
                const rest = { ...themes }; delete rest[n];
                if (Object.keys(rest).length) d.themes = rest; else delete d.themes;
                if (d.theme === n || (d.theme === "auto" && !hasAuto(d)) || !d.themes) delete d.theme;
                this.appPart = undefined; save();
            },
            add: (n) => { d.themes = { ...themes, [n]: part ? { ...docColours(d, part) } : seed() }; this.appPart = n; save(); },
        });
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
    // fonts (General → Fonts): a sample in the font, the name, its CSS value
    fonts(c: HTMLElement) {
        const s = this.plugin.settings;
        c.createDiv({ cls: "vls-intro", text: "Follow Obsidian until changed." });
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
    display() {
        const root = this.containerEl, s = this.plugin.settings;
        this.pickerOff?.(); this.syncs = [];
        root.empty(); root.addClass("vl-settings", "vls-split");
        const tab = this.tab();
        this.tabBar(root, tab);
        // the tab's own part scrolls, under the tiles; it reaches the pane's right and bottom edge through the pane's
        // padding (whatever Obsidian or a theme makes it), so its scrollbar sits where the pane's would
        // (the first time the pane opens it is not on the page yet and has no padding to read: read it again once it is)
        const pads = () => { const pad = root.win.getComputedStyle(root); root.setCssProps({ "--vls-pr": pad.paddingRight, "--vls-pb": pad.paddingBottom }); };
        pads(); root.win.requestAnimationFrame(pads);
        const c = root.createDiv({ cls: "vls-scroll" });
        const bar = root.querySelector(".vls-tabs");
        c.addEventListener("scroll", () => bar?.toggleClass("is-stuck", c.scrollTop > 2), { passive: true });
        let part = "";
        if (tab === "general") {
            // General's parts as tabs of their own, one shown
            part = this.subTabs(c, "vellum:setgeneral", [["screens", "Screens", "folder-open"], ["editing", "Editing", "mouse-pointer-2"], ["fonts", "Fonts", "type"], ["updates", "Updates", "sparkles"]]);
            if (part === "screens") {
                const sc = this.card(c, "");
                this.input(this.row(sc, "Screens folder", "Opened by the ribbon button.", "folder-open", "One JSON file per screen, made on the first save. If it has no screens, Vellum offers the folders that do."), s.folder, (v) => { s.folder = v.trim().replace(/\/+$/, "") || DEFAULTS.folder; this.save(); }, { placeholder: "Vellum/App" });
            } else if (part === "editing") {
                // number boxes, marks
                const ed = s.edit;
                const eg = this.card(c, "");
                this.input(this.row(eg, "Drag step", "Per notch of a drag. Shift: ×10.", "move"), String(ed.arrow), (v) => { const n = Number(v); if (n > 0 && n <= 1000) { ed.arrow = n; this.save(); } }, { cls: "is-num", type: "number" });
                this.input(this.row(eg, "Mark text size", "Notes and area names, in px.", "baseline", "In pixels on the monitor, when a mark sets none."), String(ed.markSize), (v) => { const n = Math.round(Number(v)); if (n >= 8 && n <= 40) { ed.markSize = n; this.save(); refreshLook(); } }, { cls: "is-num", type: "number" });
                this.input(this.row(eg, "Label size", "Block names, sizes, Map tags, in px.", "tag", "In pixels on the monitor, at any zoom: the name tag over a block, the size label under it, and the Mock, Changed and Edited tags in the Map."), String(ed.labelSize), (v) => { const n = Math.round(Number(v)); if (n >= 8 && n <= 24) { ed.labelSize = n; this.save(); refreshLook(); } }, { cls: "is-num", type: "number" });
                this.input(this.row(eg, "Note width", "Empty: as wide as its text.", "sticky-note", "In pixels, when a note sets none. Empty or 0: as wide as its text, up to 200."), ed.noteW ? String(ed.noteW) : "", (v) => { const n = Math.round(Number(v || 0)); if (n === 0 || (n >= 60 && n <= 600)) { ed.noteW = n; this.save(); refreshLook(); } }, { cls: "is-num", type: "number", placeholder: "Auto" });
                new ToggleComponent(this.row(eg, "Notes avoid each other", "Overlapping notes move apart.", "layers", "Notes whose text would overlap are shown one under the other, with a line to their pin. A text box dragged by hand stays where it is. Only how they show: the files keep where the notes were put.")).setValue(ed.noteStack).onChange((v) => { ed.noteStack = v; this.save(); refreshLook(); });
                new ToggleComponent(this.row(eg, "Hold and drag", "Hold a number, drag to change.", "hand", "Hold a number box, then drag up or down. A click types the value.")).setValue(ed.hold).onChange((v) => { ed.hold = v; this.save(); });
            } else if (part === "fonts") {
                this.fonts(c);
            } else {
                const up = this.card(c, "");
                new ToggleComponent(this.row(up, "Show what's new", "Once, after each update.", "sparkles")).setValue(s.news).onChange((v) => { s.news = v; this.save(); });
            }
        } else if (tab === "snapping") {
            const sn = s.snap, sp = this.card(c, "");
            const master = this.row(sp, "Snap while dragging", "Alt during a drag: off.", "magnet", "Blocks and items snap to the lines near them. The magnet under the phone switches it too.");
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
        } else if (tab === "measure") {
            // measure (M or Alt held, then a drag): five choices, each a row of words
            const ms = s.measure, mc = this.card(c, "");
            // a choice in words; returns a redraw of which is lit (a change made elsewhere: none, when custom)
            const pick = <T extends string>(ctl: HTMLElement, opts: [T, string][], get: () => T, set: (v: T) => void) => {
                const lit = () => bs.forEach((x, i) => x.toggleClass("is-on", opts[i][0] === get()));
                const bs = opts.map(([v, text]) => {
                    const b = ctl.createEl("button", { cls: "vls-pill", text });
                    b.addEventListener("click", () => { set(v); lit(); this.save(); });
                    return b;
                });
                lit();
                return lit;
            };
            pick(this.row(mc, "Content", "Under the area.", "eye", "Dim: faded, so the measures read first. Hide: frames only."), [["show", "As is"], ["dim", "Dim"], ["hide", "Hide"]], () => ms.content, (v) => { ms.content = v; });
            pick(this.row(mc, "Lines", "Frames, edges, gaps.", "minus", "Their width on the monitor. Their colour: Editor theme → Measure."), [["1", "Thin"], ["1.5", "Normal"], ["2.5", "Bold"]], () => String(ms.weight) as "1" | "1.5" | "2.5", (v) => { ms.weight = Number(v); });
            const stripesLit = pick(this.row(mc, "Stripes", "In the blocks' empty space.", "hash"), [["off", "Off"], ["light", "Light"], ["strong", "Strong"]], () => ms.stripes, (v) => {
                ms.stripes = v; if (v === "light" || v === "strong") { Object.assign(ms, STRIPES[v]); this.save(); this.display(); }   // Advanced shows the new numbers
            });
            pick(this.row(mc, "Grid", "The snapping grid, in the area.", "layout-grid", "Its step is Snapping → Grid. Hidden when zoomed out too far to read."), [["off", "Off"], ["on", "On"]], () => (ms.grid ? "on" : "off"), (v) => { ms.grid = v === "on"; });
            pick(this.row(mc, "Far distances", "More room than spacing.", "move-horizontal", "Past a share of their block (Advanced → Far from), such as a short text's line to the far edge."), [["faint", "Faint"], ["hide", "Hide"]], () => ms.far, (v) => { ms.far = v; });
            // Advanced: the numbers behind the choices above, folded until opened (kept on the device)
            const ADV = "vellum:measureAdv";
            let open = false; try { open = getLocal(ADV) === "1"; } catch { /* */ }
            const adv = c.createDiv({ cls: "vls-card vls-fold" + (open ? " is-open" : "") });
            const head = adv.createEl("button", { cls: "vls-head vls-foldhead", attr: { "aria-expanded": String(open) } });
            setIcon(head.createSpan({ cls: "vls-foldi" }), "chevron-right");
            head.createSpan({ cls: "vls-title", text: "Advanced" });
            head.createSpan({ cls: "vls-sum", text: "The numbers behind the choices" });
            head.addEventListener("click", () => { open = !open; adv.toggleClass("is-open", open); head.setAttr("aria-expanded", String(open)); try { setLocal(ADV, open ? "1" : "0"); } catch { /* */ } });
            const ab = adv.createDiv({ cls: "vls-body" });
            const slide = (name: string, desc: string, icon: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) =>
                new SliderComponent(this.row(ab, name, desc, icon)).setLimits(min, max, step).setValue(get()).setDynamicTooltip().onChange((v) => { set(v); this.save(); });
            slide("Dim to", "How much of the content shows, %.", "sun-dim", 10, 90, 5, () => ms.dim, (v) => { ms.dim = v; });
            pick(this.row(ab, "Frames", "Around blocks and items.", "square-dashed", "The area's own edge stays dashed."), [["dashed", "Dashed"], ["solid", "Solid"]], () => ms.frames, (v) => { ms.frames = v; });
            slide("Line strength", "How solid the lines are, %.", "contrast", 20, 100, 5, () => ms.strength, (v) => { ms.strength = v; });
            const stripe = (v: () => void) => { v(); if (ms.stripes !== "off") { ms.stripes = "custom"; stripesLit(); } };
            slide("Stripe gap", "Space between stripes, px.", "hash", 2, 16, 1, () => ms.hatch, (v) => stripe(() => { ms.hatch = v; }));
            slide("Stripe width", "Each stripe, px.", "minus", 0.5, 4, 0.5, () => ms.hatchW, (v) => stripe(() => { ms.hatchW = v; }));
            slide("Stripe strength", "How solid the stripes are, %.", "contrast", 5, 80, 5, () => ms.hatchS, (v) => stripe(() => { ms.hatchS = v; }));
            this.input(this.row(ab, "Grid step", "In points. Empty: Snapping → Grid.", "ruler"), ms.step ? String(ms.step) : "", (v) => { const n = Math.round(Number(v || 0)); if (n >= 0 && n <= 64) { ms.step = n; this.save(); } }, { cls: "is-num", type: "number", placeholder: String(s.snap.grid) });
            slide("Far from", "Share of the block, %.", "move-horizontal", 10, 60, 5, () => ms.farAt, (v) => { ms.farAt = v; });
            const back = ab.createDiv({ cls: "vls-row vls-advback" }).createEl("button", { cls: "vls-pill" });
            setIcon(back.createSpan({ cls: "vls-tabi" }), "rotate-ccw"); back.createSpan({ text: "Back to the defaults" });
            back.addEventListener("click", () => { Object.assign(ms, MEASURE_DEFAULT); this.save(); this.display(); });
        } else if (tab === "keys") {
            this.keys(c);
        } else if (tab === "editor") {
            this.editorTheme(c);
        } else if (tab === "screens") {
            this.screenColours(c);
        }
        if ((tab === "general" && part !== "fonts") || tab === "snapping" || tab === "measure" || tab === "editor" || (tab === "screens" && this.appDir)) return;   // (an app's own colours: not the settings' look; Editor theme: its own Reset and Follow Obsidian)
        // back to the theme
        const foot = c.createDiv({ cls: "vls-foot" });
        foot.createSpan({ text: "Back to Obsidian's colours and fonts." });
        const rb = foot.createEl("button", { cls: "mod-warning vls-follow" });
        setIcon(rb.createSpan({ cls: "vls-tabi" }), "rotate-ccw"); rb.createSpan({ text: "Reset look" });
        rb.addEventListener("click", () => { this.plugin.settings = { ...structuredClone(DEFAULTS), folder: s.folder, snap: s.snap, measure: s.measure, edit: s.edit }; this.queueLook(); this.display(); });
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
