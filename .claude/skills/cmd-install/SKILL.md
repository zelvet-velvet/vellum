---
name: cmd-install
description: Vellum command /cmd-install [vault]. Use when the user runs /cmd-install or asks to install or update Vellum in a vault for testing. Type-checks, builds and copies the plugin into a vault.
---
# /cmd-install

1. Vault: the argument, else the default in `AGENTS.local.md`, else ask.
2. `npm run check`, then `npm run build`. Stop and report if either fails.
3. `npm run install-vault -- "<vault>"`.
4. Compare `main.js` and `styles.css` with the installed copies (`md5sum`).
5. Tell the user to reload Obsidian to get the change. Do not reload it yourself unless they say so.
