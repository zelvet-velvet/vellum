// The checks Obsidian's automated review runs on community plugins (npm run lint)
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    globalIgnores(["node_modules", "main.js", "esbuild.config.mjs", "scripts", ".obsidian"]),
    ...obsidianmd.configs.recommended,
    { languageOptions: { parserOptions: { projectService: { allowDefaultProject: ["eslint.config.*"] } } } },
]);
