import { App, normalizePath, TFile } from "obsidian";

// The guide for agents (docs/for-agents.md and the README's field reference, put in at build time: esbuild.config.mjs),
// written into the vault so an agent reads the version that matches this plugin, with no network: as VELLUM.md in the
// Vellum folder, beside the app folders (one copy for every app), or as a Claude Code skill. Its first line says which
// Vellum wrote it; an update writes it again. A VELLUM.md without that line (the user's own) is never touched
declare const VELLUM_GUIDE: string;
const GUIDE = VELLUM_GUIDE;   // once: the build puts the text in wherever the name is used

export const GUIDE_FILE = "VELLUM.md";
export const SKILL_PATH = ".claude/skills/vellum/SKILL.md";
const stamp = (version: string) => `<!-- Written by Vellum ${version}. Vellum writes it again on each update and from the command "Add the agent guide"; edits here are lost. -->\n\n`;
const skill = (version: string) => `---
name: vellum
description: Designing app screens with Vellum, an Obsidian plugin (one JSON file per screen in a folder with _doc.json). Use when reading or writing Vellum screens, setting up a new app's frame, drawing mock options, or answering the user's marks.
---
${stamp(version)}${GUIDE}`;

// the Vellum version a guide file was written by (none: not written by Vellum, left alone)
const writtenBy = (text: string) => /<!-- Written by Vellum (\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;

// VELLUM.md in the Vellum folder: written, or written again; null when the folder has one Vellum did not write
export async function writeGuide(app: App, dir: string, version: string): Promise<string | null> {
    const path = normalizePath(`${dir}/${GUIDE_FILE}`), text = stamp(version) + GUIDE, f = app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) { if (!writtenBy(await app.vault.read(f))) return null; await app.vault.modify(f, text); }
    else await app.vault.create(path, text);
    return path;
}
// the skill at the vault's root (a hidden folder: through the adapter, which the vault's file list does not cover)
export async function writeSkill(app: App, version: string): Promise<string> {
    const a = app.vault.adapter, dir = SKILL_PATH.slice(0, SKILL_PATH.lastIndexOf("/"));
    if (!(await a.exists(dir))) await a.mkdir(dir);
    await a.write(SKILL_PATH, skill(version));
    return SKILL_PATH;
}
// after an update: every guide this plugin wrote before, written again for this version (one the user wrote is left)
export async function refreshGuides(app: App, version: string) {
    for (const f of app.vault.getFiles().filter((x) => x.name === GUIDE_FILE)) {
        const by = writtenBy(await app.vault.cachedRead(f));
        if (by && by !== version) await app.vault.modify(f, stamp(version) + GUIDE);
    }
    const a = app.vault.adapter;
    if (await a.exists(SKILL_PATH)) { const by = writtenBy(await a.read(SKILL_PATH)); if (by && by !== version) await a.write(SKILL_PATH, skill(version)); }
}
