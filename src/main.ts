import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { registerVellum } from "./editor";
import { BASE_THEME, Theme } from "./render";

// Vellum: phone screens drawn and edited in a note (```vellum blocks). The look (named colours and fonts that items use)
// comes from the settings; by default it follows the Obsidian theme.
interface Settings { colors: Record<string, string>; fonts: Record<string, string> }
const DEFAULTS: Settings = { colors: { ...BASE_THEME.colors }, fonts: { ...BASE_THEME.fonts } };

export default class VellumPlugin extends Plugin {
    settings: Settings = structuredClone(DEFAULTS);
    async onload() {
        const saved = (await this.loadData()) as Partial<Settings> | null;
        this.settings = { colors: { ...DEFAULTS.colors, ...saved?.colors }, fonts: { ...DEFAULTS.fonts, ...saved?.fonts } };
        registerVellum(this, () => ({ theme: this.theme() }));
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
        c.createEl("p", { cls: "setting-item-description", text: "The named colours and fonts items use (any CSS value, CSS variables too). Reopen a note to see a change." });
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
            .addButton((b) => b.setButtonText("Reset").setWarning().onClick(async () => { this.plugin.settings = structuredClone(DEFAULTS); await this.plugin.save(); this.display(); }));
    }
}
