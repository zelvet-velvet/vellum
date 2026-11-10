import { addIcon, App, FuzzySuggestModal, Plugin, PluginSettingTab, setIcon, Setting, TFolder } from "obsidian";
import { openVellum, registerVellum, setSnap, SnapCfg, SNAP_DEFAULT } from "./editor";
import { BASE_THEME, Theme } from "./render";

// the mark (ribbon, the editor's tab): a phone, and a sheet of tracing paper over it with a gravity point; 100 × 100, line icons
const ICON = `<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="34" y="8" width="44" height="84" rx="10"/><path d="M14 32 h38 l10 10 v48 h-48 z"/></g><circle cx="38" cy="61" r="7" fill="currentColor"/>`;

// Vellum: phone screens drawn and edited in a note (```vellum blocks). The look (named colours and fonts that items use)
// comes from the settings; by default it follows the Obsidian theme.
// folder: the screens the ribbon button opens (one JSON file per screen); made on the first save
// snap: how drags and resizes snap (to the grid, edges, middles, margins, other items)
interface Settings { folder: string; colors: Record<string, string>; fonts: Record<string, string>; snap: SnapCfg }
const DEFAULTS: Settings = { folder: "Screens", colors: { ...BASE_THEME.colors }, fonts: { ...BASE_THEME.fonts }, snap: { ...SNAP_DEFAULT } };

export default class VellumPlugin extends Plugin {
    settings: Settings = structuredClone(DEFAULTS);
    async onload() {
        const saved = (await this.loadData()) as Partial<Settings> | null;
        this.settings = { folder: saved?.folder || DEFAULTS.folder, colors: { ...DEFAULTS.colors, ...saved?.colors }, fonts: { ...DEFAULTS.fonts, ...saved?.fonts }, snap: { ...SNAP_DEFAULT, ...saved?.snap } };
        addIcon("vellum", ICON);
        registerVellum(this, () => ({ theme: this.theme() }));
        setSnap(this.settings.snap, () => { void this.save(); });
        // the editor straight on the screens folder: no note or block needed
        this.addRibbonIcon("vellum", "Open Vellum", () => { void openVellum(this.settings.folder); });
        this.addCommand({ id: "open", name: "Open the screens", callback: () => { void openVellum(this.settings.folder); } });
        this.addCommand({ id: "open-folder", name: "Open screens from another folder", callback: () => new FolderPick(this.app, async (f) => { this.settings.folder = f.path; await this.save(); void openVellum(f.path); }).open() });
        this.addSettingTab(new VellumSettings(this.app, this));
    }
    theme(): Theme { return { colors: { ...this.settings.colors }, fonts: { ...this.settings.fonts } }; }
    async save() { await this.saveData(this.settings); }
}

class VellumSettings extends PluginSettingTab {
    constructor(app: App, readonly plugin: VellumPlugin) { super(app, plugin); }
    // a heading that folds the settings under it (a click on it); folded headings are kept on the device
    fold(c: HTMLElement, name: string): HTMLElement {
        const KEY = "vellum:setfold";
        let shut: string[] = [];
        try { shut = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { /* */ }
        const head = new Setting(c).setName(name).setHeading();
        head.settingEl.addClass("vl-sethead");
        const chev = head.nameEl.createSpan({ cls: "vl-setchev" });
        const box = c.createDiv({ cls: "vl-setgroup" });
        const show = (open: boolean) => { box.toggle(open); head.settingEl.toggleClass("is-folded", !open); chev.empty(); setIcon(chev, open ? "chevron-down" : "chevron-right"); };
        show(!shut.includes(name));
        head.settingEl.addEventListener("click", () => {
            const open = !box.isShown();
            show(open);
            shut = open ? shut.filter((n) => n !== name) : [...new Set([...shut, name])];
            try { localStorage.setItem(KEY, JSON.stringify(shut)); } catch { /* */ }
        });
        return box;
    }
    display() {
        const { containerEl: c } = this, s = this.plugin.settings;
        c.empty();
        new Setting(c).setName("Screens folder").setDesc("What the ribbon button opens: one JSON file per screen (made on the first save). A ```vellum block with src: <folder> shows any folder in a note too.")
            .addText((t) => t.setPlaceholder("Screens").setValue(s.folder).onChange(async (v) => { s.folder = v.trim().replace(/\/+$/, "") || DEFAULTS.folder; await this.plugin.save(); }));
        c.createEl("p", { cls: "setting-item-description", text: "The named colours and fonts items use (any CSS value, CSS variables too). Reopen the editor to see a change." });
        const gc = this.fold(c, "Colours");
        for (const name of Object.keys(s.colors)) {
            const row = new Setting(gc).setName(name);
            const sw = row.nameEl.createSpan({ cls: "vl-set-sw" }); sw.style.background = s.colors[name];
            row.addText((t) => t.setValue(s.colors[name]).onChange(async (v) => { s.colors[name] = v.trim(); sw.style.background = v; await this.plugin.save(); }));
            if (!(name in DEFAULTS.colors)) row.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => { delete s.colors[name]; await this.plugin.save(); this.display(); }));
        }
        let fresh = "";
        new Setting(gc).setName("Add a colour").setDesc("A new name items can use.")
            .addText((t) => t.setPlaceholder("name").onChange((v) => { fresh = v.trim(); }))
            .addButton((b) => b.setButtonText("Add").onClick(async () => { if (!fresh || fresh in s.colors) return; s.colors[fresh] = "#888888"; await this.plugin.save(); this.display(); }));
        const gf = this.fold(c, "Fonts");
        for (const name of Object.keys(s.fonts)) {
            new Setting(gf).setName(name).addText((t) => t.setValue(s.fonts[name]).onChange(async (v) => { s.fonts[name] = v.trim(); await this.plugin.save(); }));
        }
        const gs = this.fold(c, "Snapping");
        const sn = s.snap, keep = async () => { await this.plugin.save(); };
        new Setting(gs).setName("Snap to edges and middles").setDesc("While dragging or resizing, a block or an item snaps to the lines near it, with a guide line; Alt turns it off for a drag (1 px). The magnet under the phone switches this too.")
            .addToggle((t) => t.setValue(sn.on).onChange(async (v) => { sn.on = v; await keep(); }));
        new Setting(gs).setName("Snap distance").setDesc("How near a line pulls (screen pixels).")
            .addSlider((sl) => sl.setLimits(2, 16, 1).setValue(sn.dist).setDynamicTooltip().onChange(async (v) => { sn.dist = v; await keep(); }));
        new Setting(gs).setName("Grid").setDesc("Points a drag moves by when no line is near (1 = free). Shift with an arrow key moves this far too.")
            .addText((t) => t.setValue(String(sn.grid)).onChange(async (v) => { const n = Math.round(Number(v)); if (n >= 1 && n <= 64) { sn.grid = n; await keep(); } }));
        new Setting(gs).setName("Margins").setDesc("Lines this far inside each edge (the block's for an item; the safe area's for a block), comma separated; empty for none.")
            .addText((t) => t.setPlaceholder("16, 24").setValue(sn.margins.join(", ")).onChange(async (v) => { sn.margins = v.split(/[,\s]+/).map(Number).filter((n) => n > 0 && n < 400); await keep(); }));
        new Setting(gs).setName("The frame").setDesc("An item: its block's edges and middle. A block: the screen's, and the safe area's edges.")
            .addToggle((t) => t.setValue(sn.frame).onChange(async (v) => { sn.frame = v; await keep(); }));
        new Setting(gs).setName("Other items and blocks").setDesc("The edges and middles of the other items in the block, or of the other blocks on the screen.")
            .addToggle((t) => t.setValue(sn.others).onChange(async (v) => { sn.others = v; await keep(); }));
        new Setting(gs).setName("Guide lines").setDesc("Show the line a drag snapped to.")
            .addToggle((t) => t.setValue(sn.guides).onChange(async (v) => { sn.guides = v; await keep(); }));
        new Setting(c).setName("Follow the Obsidian theme").setDesc("Put every colour and font back to the defaults.")
            .addButton((b) => b.setButtonText("Reset").setWarning().onClick(async () => { this.plugin.settings = { ...structuredClone(DEFAULTS), folder: s.folder, snap: s.snap }; await this.plugin.save(); this.display(); }));
    }
}

// a folder of the vault, typed to find
class FolderPick extends FuzzySuggestModal<TFolder> {
    constructor(app: App, readonly pick: (f: TFolder) => void) { super(app); this.setPlaceholder("A folder of screens"); }
    getItems() { return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== "/"); }
    getItemText(f: TFolder) { return f.path; }
    onChooseItem(f: TFolder) { this.pick(f); }
}
