// Copy the built plugin into a vault and enable it.  Usage: npm run install-vault -- <vault path>
import fs from "fs";
import path from "path";

const arg = process.argv[2] || process.env.VAULT;
if (!arg) { console.error("usage: npm run install-vault -- <vault path>"); process.exit(1); }
const vault = path.resolve(arg);
const dir = path.join(vault, ".obsidian", "plugins", "vellum");
fs.mkdirSync(dir, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(f, path.join(dir, f));
const list = path.join(vault, ".obsidian", "community-plugins.json");
const ids = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, "utf8")) : [];
if (!ids.includes("vellum")) { ids.push("vellum"); fs.writeFileSync(list, JSON.stringify(ids, null, 2)); }
console.log("installed into", dir);
