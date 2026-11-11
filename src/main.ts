import { addIcon, App, FuzzySuggestModal, Plugin, PluginSettingTab, setIcon, SliderComponent, TFolder, ToggleComponent } from "obsidian";
import { EDIT_DEFAULT, EditCfg, openVellum, registerVellum, setEdit, setSnap, SnapCfg, SNAP_DEFAULT } from "./editor";
import { getLocal, setLocal, useApp } from "./local";
import { BASE_THEME, Theme } from "./render";

// the mark (ribbon, the editor's tab): a sheet behind a phone with two blocks on its screen; 100 × 100, line icons
const ICON = `<g fill="none" stroke="currentColor" stroke-width="7.3" stroke-linecap="round" stroke-linejoin="round"><rect x="38" y="8" width="48" height="84" rx="11"/><path d="M38 28H20a6 6 0 0 0-6 6v46a6 6 0 0 0 6 6h18"/></g><rect x="50" y="24" width="24" height="10" rx="3" fill="currentColor"/><rect x="50" y="42" width="24" height="33" rx="4" fill="currentColor"/>`;

// Vellum: phone screens drawn and edited in a note (```vellum blocks). The look (named colours and fonts that items use)
// comes from the settings; by default it follows the Obsidian theme.
// folder: the screens the ribbon button opens (one JSON file per screen); made on the first save
// snap: how drags and resizes snap (to the grid, edges, middles, margins, other items)
// edit: number boxes (the arrows' step, hold-and-drag)
interface Settings { folder: string; colors: Record<string, string>; fonts: Record<string, string>; snap: SnapCfg; edit: EditCfg }
const DEFAULTS: Settings = { folder: "Screens", colors: { ...BASE_THEME.colors }, fonts: { ...BASE_THEME.fonts }, snap: { ...SNAP_DEFAULT }, edit: { ...EDIT_DEFAULT } };

export default class VellumPlugin extends Plugin {
    settings: Settings = structuredClone(DEFAULTS);
    async onload() {
        const saved = (await this.loadData()) as Partial<Settings> | null;
        this.settings = { folder: saved?.folder || DEFAULTS.folder, colors: { ...DEFAULTS.colors, ...saved?.colors }, fonts: { ...DEFAULTS.fonts, ...saved?.fonts }, snap: { ...SNAP_DEFAULT, ...saved?.snap }, edit: { ...EDIT_DEFAULT, ...saved?.edit } };
        useApp(this.app);
        addIcon("vellum", ICON);
        registerVellum(this, () => ({ theme: this.theme() }));
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
        const KEY = "vellum:setopen";
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
    display() {
        const { containerEl: c } = this, s = this.plugin.settings;
        c.empty(); c.addClass("vl-settings");
        c.createDiv({ cls: "vls-intro", text: "Colours and fonts follow your Obsidian theme until you change them. Reopen the editor to see a change of look; snapping applies at once." });

        // screens
        const sc = this.card(c, "screens", "Screens", s.folder);
        this.input(this.row(sc, "Screens folder", "What the ribbon button opens: one JSON file per screen, made on the first save."), s.folder, (v) => { s.folder = v.trim().replace(/\/+$/, "") || DEFAULTS.folder; this.save(); }, { placeholder: "Screens" });

        // colours: a swatch (a click picks a colour), the name, its CSS value
        const names = Object.keys(s.colors);
        const co = this.card(c, "colours", "Colours", `${names.length} named`);
        const list = co.createDiv({ cls: "vls-tokens" });
        for (const name of names) {
            const t = list.createDiv({ cls: "vls-token" });
            const sw = t.createDiv({ cls: "vls-sw", attr: { "aria-label": "Pick a colour" } });
            sw.style.background = s.colors[name];
            const pick = sw.createEl("input", { attr: { type: "color", tabindex: "-1" } });
            t.createDiv({ cls: "vls-tname", text: name });
            const val = this.input(t, s.colors[name], (v) => { s.colors[name] = v.trim(); sw.style.background = v; this.save(); }, { cls: "is-mono" });
            pick.addEventListener("click", () => { pick.value = toHex(getComputedStyle(sw).backgroundColor); });
            pick.addEventListener("input", () => { s.colors[name] = pick.value; val.value = pick.value; sw.style.background = pick.value; this.save(); });
            if (name in DEFAULTS.colors) t.createDiv();
            else {
                const x = t.createEl("button", { cls: "vls-x clickable-icon", attr: { "aria-label": `Remove ${name}` } });
                setIcon(x, "x");
                x.addEventListener("click", () => { delete s.colors[name]; this.save(); this.display(); });
            }
        }
        const add = co.createDiv({ cls: "vls-add" });
        let fresh = "";
        const ni = this.input(add, "", (v) => { fresh = v.trim(); }, { placeholder: "A new colour name" });
        const ab = add.createEl("button", { text: "Add colour" });
        const doAdd = () => { if (!fresh || fresh in s.colors) { ni.focus(); return; } s.colors[fresh] = "#888888"; this.save(); this.display(); };
        ab.addEventListener("click", doAdd);
        ni.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });

        // fonts: a sample in the font, the name, its CSS value
        const fo = this.card(c, "fonts", "Fonts", `${Object.keys(s.fonts).length} named`);
        const fl = fo.createDiv({ cls: "vls-tokens" });
        for (const name of Object.keys(s.fonts)) {
            const t = fl.createDiv({ cls: "vls-token" });
            const aa = t.createDiv({ cls: "vls-aa", text: "Aa" });
            aa.style.fontFamily = s.fonts[name];
            t.createDiv({ cls: "vls-tname", text: name });
            this.input(t, s.fonts[name], (v) => { s.fonts[name] = v.trim(); aa.style.fontFamily = v; this.save(); }, { cls: "is-mono" });
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

        // back to the theme
        const foot = c.createDiv({ cls: "vls-foot" });
        foot.createSpan({ text: "Back to your Obsidian theme's colours and fonts." });
        const rb = foot.createEl("button", { cls: "mod-warning", text: "Reset look" });
        rb.addEventListener("click", () => { this.plugin.settings = { ...structuredClone(DEFAULTS), folder: s.folder, snap: s.snap, edit: s.edit }; this.save(); this.display(); });
    }
}
// rgb(…) / rgba(…) as #rrggbb (the colour picker takes only that)
const toHex = (rgb: string) => {
    const m = rgb.match(/\d+(\.\d+)?/g);
    return m && m.length >= 3 ? "#" + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("") : "#888888";
};

// a folder of the vault, typed to find
class FolderPick extends FuzzySuggestModal<TFolder> {
    constructor(app: App, readonly pick: (f: TFolder) => void) { super(app); this.setPlaceholder("A folder of screens"); }
    getItems() { return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== "/"); }
    getItemText(f: TFolder) { return f.path; }
    onChooseItem(f: TFolder) { this.pick(f); }
}
