---
name: vl-readme-shots
description: Retaking the README's screenshots (editor, overlays, Show, map, the agent demo). Use when the user asks to update, retake or add a README image, or when a UI change makes one out of date.
---
# README screenshots

Every image in the README is taken the same way, so a redo is this list, not a rediscovery. Read `vl-test` first (remote
debugging, `scripts/cdp.mjs`). The user may be working in Obsidian: ask before a reload, and put the editor back as it was.

## Setup
- **Vault**: the Ledgerline vault (path in `AGENTS.local.md`), screens in `Docs/Design/Screens`. Its blocks are named
  from a capture, so most names are messy; **Sort** on Holdings is the clean one for anything that shows a reference.
- **Plugin**: install `main` there first (`npm run install-vault -- <vault>`), then reload Vellum (it closes the editor;
  reopen with the command `vellum:open`). The editor window title is `Vellum · Docs/Design/Screens - ledgerline`.
- **Light screens**: run `scripts/shots/light.js` in the editor window. Phones go light, the editor stays dark, so the
  design stands out. Run it again after any reload. It also lightens the tiles the screen files hard-code to `#121214`.
- **Screens list open** (the left rail) for the editor shot; a page opens by clicking its row.
- Find what to click with an `eval` that reads `getBoundingClientRect()`, never from old coordinates: the window size
  changes. `cdp.mjs` coordinates are CSS pixels; its screenshots are device pixels (×1.25 on this machine).

## The shots
All dark Obsidian theme, light screens. Images in `assets/`, the same file names, both READMEs' captions updated.

| File | What it shows | How |
| :--- | :--- | :--- |
| `editor.png` | The whole editor: screens list with **Corner, bar, safe areas** open under Device, the phone, a chosen block's panel | Holdings, Edit, no overlays, choose the holdings list block; full-window shot |
| `overlay.png` | An overlay **in use**, on the big list in the middle (what readers see first) | Holdings; Overlays → Columns: 3, margin 16, gutter 12. The list's prices don't quite sit on column 2, so for the shot: copy `Holdings.json` to the scratchpad, set the list block's price and % texts (`g` `tl`, `dx` 150–290, no `fill`) to `"g": "tr", "dx": 136`, take the shot, copy the backup back and check its `md5sum`. Choose the names, prices and values (click VOO twice, Shift+click the rest, **one click per `cdp.mjs` run**). Clip round phone and toolbar |
| `show.png` | Show: the way here above, arrows beside | Holdings in Show; **the same clip size as `overlay.png`** |
| `map.png` | Every screen as a tree | Map view, full window |
| `agent.png` | A terminal conversation above the editor | Below |

Shift+click: `{"drag":[x,y,x,y,8]}` (modifier 8 = Shift). A long step list can hang mid-drag and leave the mouse held:
send `{"release":[x,y]}` and check the file. Hash the screen file first (`md5sum`) and check it after: a
click that lands on a chosen item can nudge it. If the editor shows **Save**, press undo until it shows **Saved**.

## The agent demo
Short and easy to read beats real-and-messy: a real session prints whole JSON files and pushes the request off screen.

1. A Windows Terminal (WSL) with `claude` running in the Ledgerline vault, font about 20 pt. Find its handle with
   `scripts/shots/windows.ps1` (run with `powershell.exe -File`; scripts must sit on a Windows path, e.g. `%TEMP%`).
2. `/clear`, then one setup message telling it to answer the next message with exactly the reply you wrote, no tools.
3. In Vellum choose **Sort**, press **Copy reference**: `[Docs/Design/Screens/Holdings.json › Sort (sort-298)]`.
4. Paste it into the terminal, add the request, send. Then type the next request and **don't send it**.
5. Shrink the window (`scripts/shots/terminal.ps1`, about 1400 × 440) until only the demo shows: Ctrl+L doesn't clear
   Claude Code's screen; the setup scrolls off instead. Capture it with `scripts/shots/capture-window.ps1`.
6. The screen file must already show the result the reply describes (make the change by hand if needed).
7. Capture the stage and panel with Sort chosen, stack the two with `scripts/shots/stack.ps1`.
8. Point from the pasted reference to the block with `scripts/shots/arrow.ps1`: a box round each, an arrow routed
   through empty space (down the gap between phone and panel), labelled "the block you copied". Never across text.

The caption says what the reader does (Copy reference, then what to change), not that the session was unscripted.

## After
- Leave no change behind: the screen files as they were (`git -C <vault> status`), the editor on its page, overlays off.
- Check every image by eye, then both READMEs: captions and alt text describe what is in the new image.
