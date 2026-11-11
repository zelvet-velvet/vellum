---
name: vl-test
description: Testing Vellum in a running Obsidian over remote debugging. Use to see a change working, drive the editor, or take screenshots.
---
# Testing in Obsidian

Needs Obsidian started with `--remote-debugging-port=9222`. `curl -s localhost:9222/json/list` shows the windows; the editor is a pop-out titled `Vellum · <folder>`.

```
node scripts/cdp.mjs "Vellum ·" eval <file.js>     # evaluate in that window, print the result
node scripts/cdp.mjs "Vellum ·" shot <out.png>     # screenshot
node scripts/cdp.mjs "Vellum ·" steps <steps.json> # a list of steps, see the top of the script
```
Keep test files in the scratchpad, not the repo.

## Rules
- The user may be working in that window. Ask before reloading the plugin or Obsidian, and don't leave it resized or changed.
- To load new code without a restart: `app.plugins.disablePlugin("vellum")`, then `enablePlugin`. This closes the editor, so it counts as a reload.
- A preview made by injecting CSS and hand-built markup checks the look only, not the code that builds it. Say so if that is all you ran.
- A dark tile on a dark panel can look missing: check computed styles before calling it a bug.
