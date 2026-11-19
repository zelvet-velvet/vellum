import { App, Modal, setIcon } from "obsidian";

// What's new: shown once after an update (never on a fresh install), from the notes below. They ship inside the plugin:
// no network request. Each release adds its entry on top (see the cmd-release skill); a version with no entry shows nothing.
export interface News { version: string; items: [string, string, string][] }   // [icon, title, words]
export const NEWS: News[] = [
    {
        version: "0.11.0",
        items: [
            ["ungroup", "Take rows and columns apart", "Ctrl+Shift+G on a row or column: its items stay exactly where they are, and each one can be dragged."],
            ["layers", "Ungroup all", "For a block, a whole screen, or with a command, every screen in a folder."],
        ],
    },
    {
        version: "0.10.0",
        items: [
            ["smartphone", "Your own corner and status bar", "Under Device: a square or rounded screen, an iOS, Android or no status bar, and the safe areas, for every screen."],
            ["square-dashed-bottom", "Drafts beside the screen", "Push a block off the screen to park it there: it stays beside the phone while you edit, out of Show and previews."],
            ["message-square-text", "Marks you can read", "Set a mark's text size and a note's width, with defaults in Settings → Editing. The Mark button shows or hides them."],
            ["link", "Point the agent at a block", "Copy reference (Ctrl+Shift+C) copies [file › block (id)], ready to paste with what to change."],
            ["folder-search", "Finds your screens", "If the screens folder is empty, the ribbon opens the folder your agent wrote the screens to."],
        ],
    },
    {
        version: "0.9.0",
        items: [
            ["zoom-in", "Zoom and move freely", "Zoom to 1600 %, drag the view with the middle button; handles stay their size at any zoom."],
            ["square-dashed", "Choose several at once", "Drag over empty space to choose blocks or the items inside them; Ctrl+G groups items."],
            ["message-square-plus", "Marks for you and the agent", "Press N: pin a note, name an area, lay a guide line. They are saved with the screen, where the agent reads them."],
            ["layout-grid", "Overlays", "Grids, columns, thirds, the golden ratio and spiral, vanishing points: the grid button under the phone."],
            ["presentation", "Show as a preview", "The way to a screen and the screens it opens, with ← / → to the next one."],
        ],
    },
];

// a.b.c compared as numbers
export const newer = (a: string, b: string) => {
    const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
};
// the notes between the version last seen (not included) and this one (included), newest first
export const newsSince = (seen: string, now: string) => NEWS.filter((n) => newer(n.version, seen) && !newer(n.version, now));

export class NewsModal extends Modal {
    constructor(app: App, readonly news: News[], readonly stop: () => void) { super(app); }
    onOpen() {
        const { contentEl: c, modalEl } = this;
        modalEl.addClass("vl-news");
        this.setTitle(`Vellum ${this.news[0].version}: what's new`);
        for (const n of this.news) {
            if (this.news.length > 1) c.createDiv({ cls: "vl-newsver", text: n.version });
            const list = c.createDiv({ cls: "vl-newslist" });
            for (const [icon, title, words] of n.items) {
                const row = list.createDiv({ cls: "vl-newsrow" });
                setIcon(row.createDiv({ cls: "vl-newsicon" }), icon);
                const t = row.createDiv();
                t.createDiv({ cls: "vl-newstitle", text: title });
                t.createDiv({ cls: "vl-newswords", text: words });
            }
        }
        const foot = c.createDiv({ cls: "vl-newsfoot" });
        foot.createEl("a", { text: "All release notes", href: "https://github.com/zelvet-velvet/vellum/releases" });
        const right = foot.createDiv({ cls: "vl-newsbtns" });
        const off = right.createEl("button", { text: "Don't show after updates" });
        off.addEventListener("click", () => { this.stop(); this.close(); });
        const ok = right.createEl("button", { cls: "mod-cta", text: "Got it" });
        ok.addEventListener("click", () => this.close());
    }
    onClose() { this.contentEl.empty(); }
}
