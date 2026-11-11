---
name: vl-ui
description: Vellum's editor UI. Use when changing panels, controls, colours, number boxes, toasts or anything else the user sees in src/editor.ts or styles.css.
---
# The editor's UI

Every panel uses one system. Reuse these before adding a control:

| Helper | Use |
| :--- | :--- |
| `section(parent, title, fold, {shut, hint})` | A section; a folded one shows its summary in the title |
| `frow(parent, label)` | A row with its label on the left |
| `seg()` | A choice between a few options, in words |
| `menu()` | A dropdown |
| `num()` + `numberExtras()` | A number box |
| `colors()` / `openPicker()` | A colour bar, named tiles, the picker |
| `hint(text, at)` | A small toast by the button that caused it |

## Decisions already made (the user tried the alternatives)
- **Number boxes** copy the amount tiles from the ZeLedger app: hold 280 ms and drag up or down; a click types. No arrows, and a plain pointer on hover: the up-down cursor shows only while dragging. During the drag only the value and its bubble update, with one debounced redraw of the phone; the value is saved on release. Labels sit on top and values align right, so nothing is cut off.
- **Colours** are named tiles, not circles, which were hard to read. Recent colours are tiles named by their hex.
- **Two sets of colours in the settings.** Editor theme (`UI_COLORS` in `render.ts`) overrides Obsidian's variables on the editor only. Screen colours are the phones' named colours. A screen colour naming an overridden variable reads a `--vlr--…` copy of Obsidian's value, so the editor theme never changes a screen.
- **Settings colour cards** show their preview above the colours, never pinned while scrolling (it looked like a glitch); long lists are pages with ‹ › arrows, and the cards start folded. Pointing at a colour outlines every part of the preview it paints (`data-use`); hover colours switch their element into that state (`data-state`).
- **No eyedropper.** It was built three ways and removed: Chromium's magnifier ring is red and can't be restyled, it vanishes across monitors, and capturing the screen ourselves meant a snapshot of the user's desktop.
- Choices are words (Real / Mock, Across / Down), not unexplained icons.
- The right panel shouldn't look like a copy of a well-known design tool's inspector. The Gravity panel's phone diagram is the kind of thing that makes it Vellum's own.
- The stage and the screens list keep their scroll position across redraws.
- The editor window opens maximized, and the ribbon button raises an open editor.
- Toasts stay small and next to their button.

## Styling
Use Obsidian's CSS variables so every theme works, in light and dark. Prefix classes with `vl-`. Buttons need `.vl .vl-x` specificity to beat Obsidian's defaults. Don't assume a colour is visible: `paper` and `tile` are nearly the panel's own colour in dark themes.
