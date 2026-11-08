import { addIcon, App, FuzzySuggestModal, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";
import { openVellum, registerVellum } from "./editor";
import { BASE_THEME, Theme } from "./render";

// the mark (ribbon, the editor's tab): a phone, and a sheet of tracing paper over it with a gravity point; 100 × 100, line icons
const ICON = `<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="34" y="8" width="44" height="84" rx="10"/><path d="M14 32 h38 l10 10 v48 h-48 z"/></g><circle cx="38" cy="61" r="7" fill="currentColor"/>`;

// Vellum: phone screens drawn and edited in a note (```vellum blocks). The look (named colours and fonts that items use)
// comes from the settings; by default it follows the Obsidian theme.
// folder: the screens the ribbon button opens (one JSON file per screen); made on the first save
interface Settings { folder: string; colors: Record<string, string>; fonts: Record<string, string> }
const DEFAULTS: Settings = { folder: "Screens", colors: { ...BASE_THEME.colors }, fonts: { ...BASE_THEME.fonts } };

export default class VellumPlugin extends Plugin {
    settings: Settings = structuredClone(DEFAULTS);
    async onload() {
        const saved = (await this.loadData()) as Partial<Settings> | null;
        this.settings = { folder: saved?.folder || DEFAULTS.folder, colors: { ...DEFAULTS.colors, ...saved?.colors }, fonts: { ...DEFAULTS.fonts, ...saved?.fonts } };
        addIcon("vellum", ICON);
        registerVellum(this, () => ({ theme: this.theme() }));
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
    display() {
        const { containerEl: c } = this, s = this.plugin.settings;
        c.empty();
        new Setting(c).setName("Screens folder").setDesc("What the ribbon button opens: one JSON file per screen (made on the first save). A ```vellum block with src: <folder> shows any folder in a note too.")
            .addText((t) => t.setPlaceholder("Screens").setValue(s.folder).onChange(async (v) => { s.folder = v.trim().replace(/\/+$/, "") || DEFAULTS.folder; await this.plugin.save(); }));
        c.createEl("p", { cls: "setting-item-description", text: "The named colours and fonts items use (any CSS value, CSS variables too). Reopen the editor to see a change." });
        new Setting(c).setName("Colours").setHeading();
        for (const name of Object.keys(s.colors)) {
            const row = new Setting(c).setName(name);
            const sw = row.nameEl.createSpan({ cls: "vl-set-sw" }); sw.style.background = s.colors[name];
            row.addText((t) => t.setValue(s.colors[name]).onChange(async (v) => { s.colors[name] = v.trim(); sw.style.background = v; await this.plugin.save(); }));
            if (!(name in DEFAULTS.colors)) row.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => { delete s.colors[name]; await this.plugin.save(); this.display(); }));
        }
        let fresh = "";
        new Setting(c).setName("Add a colour").setDesc("A new name items can use.")
            .addText((t) => t.setPlaceholder("name").onChange((v) => { fresh = v.trim(); }))
            .addButton((b) => b.setButtonText("Add").onClick(async () => { if (!fresh || fresh in s.colors) return; s.colors[fresh] = "#888888"; await this.plugin.save(); this.display(); }));
        new Setting(c).setName("Fonts").setHeading();
        for (const name of Object.keys(s.fonts)) {
            new Setting(c).setName(name).addText((t) => t.setValue(s.fonts[name]).onChange(async (v) => { s.fonts[name] = v.trim(); await this.plugin.save(); }));
        }
        new Setting(c).setName("Follow the Obsidian theme").setDesc("Put every colour and font back to the defaults.")
            .addButton((b) => b.setButtonText("Reset").setWarning().onClick(async () => { this.plugin.settings = { ...structuredClone(DEFAULTS), folder: s.folder }; await this.plugin.save(); this.display(); }));
    }
}

// a folder of the vault, typed to find
class FolderPick extends FuzzySuggestModal<TFolder> {
    constructor(app: App, readonly pick: (f: TFolder) => void) { super(app); this.setPlaceholder("A folder of screens"); }
    getItems() { return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== "/"); }
    getItemText(f: TFolder) { return f.path; }
    onChooseItem(f: TFolder) { this.pick(f); }
}
