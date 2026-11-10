import { App } from "obsidian";

// Small things kept on this device for this vault (drafts of unsaved work, folds, widths): Obsidian's local storage, which
// is per vault. A value kept by an older Vellum under the same global key is read once and moved over (no draft is lost).
let app: App | null = null;
export const useApp = (a: App) => { app = a; };
export const getLocal = (key: string): string | null => {
    try {
        const v: unknown = app?.loadLocalStorage(key);
        if (v !== null && v !== undefined) return typeof v === "string" ? v : JSON.stringify(v);
        const old = window.localStorage.getItem(key);
        if (old !== null && app) { app.saveLocalStorage(key, old); window.localStorage.removeItem(key); }
        return old;
    } catch { return null; }
};
// null: forget it
export const setLocal = (key: string, value: string | null) => { try { app?.saveLocalStorage(key, value); } catch { /* */ } };
