import { App, normalizePath, TFile, TFolder } from "obsidian";
import { Doc, Page, parseDoc, uid } from "./model";

// A doc kept as a folder: one JSON file per screen (blocks one per line) and _doc.json (device, screen order). Small
// files: an agent reads only the screen it needs, git diffs come per screen, the phone and the computer meet in a conflict
// only when both change the same screen. A ```vellum block with `src: <folder>` shows it.
export const srcOf = (source: string): string | null => {
    const m = /^\s*src:\s*(.+?)\s*$/m.exec(source);
    return m && !source.trim().startsWith("{") ? normalizePath(m[1].replace(/^["']|["']$/g, "")) : null;
};
const DOC = "_doc.json";

// a screen's file: its own fields on the first line, then one block per line
export const pageText = (p: Page) => {
    const { blocks, land, ...meta } = p;
    const list = (l: Page["blocks"]) => l.length ? "[\n" + l.map((b) => "  " + JSON.stringify(b)).join(",\n") + "\n]" : "[]";
    return `${JSON.stringify(meta).slice(0, -1)}, "blocks": ${list(blocks)}` + (land ? `, "land": ${list(land)}` : "") + "}\n";
};
const fileName = (name: string) => name.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Screen";

export class FolderStore {
    files = new Map<string, string>();   // page id → its file, as loaded or last saved
    ownUntil = 0;                        // our own writes, not outside changes
    constructor(readonly app: App, readonly dir: string) {}
    watches(path: string) { return path === this.dir || path.startsWith(this.dir + "/"); }
    async load(): Promise<{ doc: Doc; error?: string }> {
        const folder = this.app.vault.getAbstractFileByPath(this.dir);
        this.files.clear();
        const id = this.dir.split("/").pop() || uid();
        if (!(folder instanceof TFolder)) return { doc: { id, device: "iphone-16-pro", pages: [] } };
        let meta: { id?: string; device?: string; order?: string[] } = {};
        const pages: Page[] = [], bad: string[] = [];
        for (const f of folder.children) {
            if (!(f instanceof TFile) || f.extension !== "json") continue;
            const text = await this.app.vault.read(f);
            if (f.name === DOC) { try { meta = JSON.parse(text); } catch { bad.push(f.name); } continue; }
            const { doc, error } = parseDoc(`{"pages": [${text}]}`);
            if (error || !doc.pages[0]) { bad.push(f.name); continue; }
            pages.push(doc.pages[0]); this.files.set(doc.pages[0].id, f.path);
        }
        const order = meta.order ?? [];
        const at = (p: Page) => { const i = order.indexOf(p.id); return i < 0 ? order.length : i; };
        pages.sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name));
        return { doc: { id: meta.id ?? id, device: meta.device ?? "iphone-16-pro", pages }, error: bad.length ? `Not read (fix the JSON): ${bad.join(", ")}` : undefined };
    }
    async save(doc: Doc): Promise<void> {
        const v = this.app.vault;
        this.ownUntil = Date.now() + 2000;
        if (!(v.getAbstractFileByPath(this.dir) instanceof TFolder)) await v.createFolder(this.dir);
        // every screen's file follows its name; a name taken by a file that is not this doc's gets a number. All targets
        // first, then written, then the doc's old files that no target kept go to the trash (no renames: swaps stay safe)
        const ours = new Set(this.files.values()), target = new Map<string, string>(), taken = new Set<string>();
        for (const p of doc.pages) {
            const base = fileName(p.name);
            let path = normalizePath(`${this.dir}/${base}.json`), n = 2;
            while (taken.has(path) || (v.getAbstractFileByPath(path) && !ours.has(path))) path = normalizePath(`${this.dir}/${base} ${n++}.json`);
            taken.add(path); target.set(p.id, path);
        }
        for (const p of doc.pages) {
            const path = target.get(p.id)!, f = v.getAbstractFileByPath(path), text = pageText(p);
            if (f instanceof TFile) { if ((await v.read(f)) !== text) await v.modify(f, text); }
            else await v.create(path, text);
        }
        for (const path of ours) {
            if (taken.has(path)) continue;
            const f = v.getAbstractFileByPath(path);
            if (f instanceof TFile) await this.app.fileManager.trashFile(f);
        }
        this.files = target;
        const meta = JSON.stringify({ id: doc.id, device: doc.device, order: doc.pages.map((p) => p.id) }, null, 2) + "\n";
        const m = v.getAbstractFileByPath(`${this.dir}/${DOC}`);
        if (m instanceof TFile) { if ((await v.read(m)) !== meta) await v.modify(m, meta); } else await v.create(`${this.dir}/${DOC}`, meta);
        this.ownUntil = Date.now() + 1500;
    }
}
