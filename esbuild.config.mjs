import esbuild from "esbuild";
import { readFileSync } from "fs";

// the guide for agents, as the plugin writes it into a vault: docs/for-agents.md with the README's field reference at
// its end (no link out: an agent in the vault may have no network)
const guide = (() => {
    const g = readFileSync("docs/for-agents.md", "utf8"), r = readFileSync("README.md", "utf8");
    const a = r.indexOf("<summary><b>Field reference</b></summary>"), b = r.indexOf("</details>", a);
    if (a < 0 || b < 0) throw new Error("README.md: the Field reference section is missing");
    const fields = r.slice(r.indexOf("\n", a) + 1, b).trim();
    const body = g.replace("the [Field reference](../README.md#-file-format)", "the Field reference at the end of this file");
    if (body === g) throw new Error("docs/for-agents.md: the link to the Field reference is missing");
    return `${body.trim()}\n\n## Field reference\n\n${fields}\n`;
})();

const prod = process.argv[2] === "production";
const ctx = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    define: { VELLUM_GUIDE: JSON.stringify(guide) },
});
if (prod) { await ctx.rebuild(); process.exit(0); } else { await ctx.watch(); }
