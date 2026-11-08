# Vellum

Lay out app screens on real phone frames inside an Obsidian note. Vellum is tracing paper between you and your coding agent: you move blocks around on a phone, and the note keeps a small JSON layout the agent reads exactly, instead of screenshots and long descriptions.

- **Real devices**: iPhone 12 to 16 (mini, Pro, Pro Max, SE), Pixel 8, Galaxy S24, with the cut-out, status bar, home strip and safe areas; upright or sideways.
- **Blocks and items**: a screen is blocks (what each part is: title, summary, list, action…); a block holds text and shapes placed by **gravity** (9 anchor points, an offset, and hug / fixed / fill per axis), plus rows and columns for repeated items.
- **Screen map**: every screen as a small phone, sub screens under the screen they open from, joined by lines with how you get there.
- **An editor that fits the device**: on a computer it opens in its own window (screens list, the phone centred, a settings panel you can resize or hide); on a phone it takes the full screen with a bottom sheet.
- **Plain text**: one screen per line of JSON in the note, or one small JSON file per screen in a folder for bigger apps, so git diffs show exactly what changed. Unsaved work is kept on the device until you save.

## Install

Until it is in the community list:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/zelvet-velvet/vellum/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/vellum/`.
3. Reload Obsidian and enable **Vellum** in Settings → Community plugins.

Or with [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `zelvet-velvet/vellum`.

## Use

Click the **Vellum** button in the ribbon (or the command **Vellum: Open the screens**): the editor opens on your screens folder (Settings → Vellum → Screens folder, `Screens` by default; made on the first save). **Open screens from another folder** switches folders.

You can also show screens inside a note, as a card with the screen map and **Open editor**. Add an empty block:

````
```vellum
```
````

In Reading view (or Live Preview, outside the block) it shows a card: **Open editor**, then **New screen**. Try [`examples/Vellum Demo.md`](examples/Vellum%20Demo.md) for a made-up app with five screens.

| Where | What |
| :--- | :--- |
| Top bar | The screen's name (shows / hides the screens tree), undo, redo, Save, the settings panel toggle |
| Screens tree | Every screen with a small picture, sub screens under the screen they open from (a chevron folds a branch); **+** beside one adds a screen opened from it; the device at the foot; its border drags its width |
| The phone | Click a block, then a text or shape in it; drag to move (Alt: 1 px), the block's corner to resize; double-click a text to type; click beside the phone to let go |
| Pill under the phone | Edit (frames, safe areas) / Show (the screen alone), zoom (Ctrl + wheel), Fit |
| Settings panel | Only what is chosen; with nothing chosen, the screen itself (name, colour, opened from, note) |

Keys: arrows nudge 1 px (Shift 4), Delete, Ctrl+Z / Ctrl+Shift+Z, Ctrl+D duplicate, Ctrl+S save, Esc goes up a level (and closes the editor at the top).

## The look

Items use named colours (`paper`, `text`, `dim`, `line`, `tile`, `loud`, `accent`) and fonts (`ui`, `display`, `mono`). By default they follow your Obsidian theme; Settings → Vellum sets each one to any CSS value (a CSS variable of your own theme or plugin too) and adds new names. An item can also take a `#hex` or a font stack directly.

## The format

```json
{"id": "demo", "device": "iphone-16-pro", "pages": [
  {"id": "home", "name": "Home", "bg": "paper", "blocks": [
    {"id": "b1", "name": "Title", "kind": "nav", "x": 16, "y": 70, "w": 370, "h": 44, "items": [
      {"id": "t1", "type": "text", "v": "HOME", "font": "display", "size": 32, "g": "l"}]}]},
  {"id": "detail", "name": "Detail", "parent": "home", "link": "tap a row", "blocks": []}
]}
```

- **Page**: `name`, `parent` + `link` (the screen it opens from, and how), `device` / `side` (override), `bg`, `mock` (a proposal), `note`, `blocks`.
- **Block**: `name`, `kind` (what it is), `x y w h` in screen points, `note`, `items`.
- **Item**: `type` `text | rect | ellipse | line | row | col`; place: `g` (`tl t tr l c r bl b br`), `dx dy`, `w h` (number, `"hug"`, `"fill"`); text: `v size wt font color ls lh`; shapes: `fill stroke sw r op`; rows / columns: `items gap pad main cross`.

A coding agent can read a page line and build it, or write one for you to adjust.

### Bigger apps: a folder

For more than a handful of screens, keep them as files and point the block at the folder:

````
```vellum
src: Design/Screens
```
````

The folder holds one file per screen (`Home.json`, `Detail.json`…, named after the screen, its blocks one per line) and `_doc.json` (`id`, `device`, `order`: the screen ids in order). A save writes only the screens that changed; a renamed screen gets a new file name, a deleted one goes to the trash. Files changed outside Obsidian's editor (your agent, a sync) are read again by themselves; unsaved edits are offered back, never overwritten. An agent reads or writes just the screen it works on.

## Build

```
npm install
npm run check && npm run build
npm run install-vault -- /path/to/vault
```

## License

MIT
