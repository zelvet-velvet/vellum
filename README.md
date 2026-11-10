<h1 align="center">Vellum</h1>

<p align="center">
  <b>Design app screens on real phone frames with your AI coding agent, inside Obsidian.</b>
</p>

<p align="center">
  <a href="https://github.com/zelvet-velvet/vellum/releases/latest"><img src="https://img.shields.io/github/v/release/zelvet-velvet/vellum?label=release&color=E9892B" alt="Latest release"></a>
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/Obsidian-%E2%89%A5%201.6.6-7C3AED?logo=obsidian&logoColor=white" alt="Obsidian 1.6.6 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/zelvet-velvet/vellum?color=A3CF7E" alt="MIT license"></a>
</p>

<p align="center">
  <img src="assets/banner.svg" width="800" alt="You edit screens on a phone, Vellum keeps them as JSON files, your agent reads and writes the same files">
</p>

You arrange blocks on a real phone. Vellum keeps each screen as a small JSON file that your agent reads and writes exactly. No screenshots, no long descriptions, and git shows what changed.

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#with-your-agent">With your agent</a> ·
  <a href="#file-format">File format</a> ·
  <a href="#faq">FAQ</a>
</p>

<p align="center"><img src="assets/editor.png" alt="The Vellum editor: the screens tree, the phone, and the settings of the chosen block"></p>

## <img src="assets/icons/star.svg" width="24" height="24" alt=""> Features

<table>
  <tr>
    <td width="33%" valign="top"><img src="assets/icons/devices.svg" width="32" height="32" alt=""><br><b>Real devices</b><br><sub>iPhone 12 – 17, Pixel 8, Galaxy S24 / S25, or any size, with cut-outs and safe areas.</sub></td>
    <td width="33%" valign="top"><img src="assets/icons/orientation.svg" width="32" height="32" alt=""><br><b>Portrait and landscape</b><br><sub>A layout for each, one switch for the whole editor.</sub></td>
    <td width="33%" valign="top"><img src="assets/icons/blocks.svg" width="32" height="32" alt=""><br><b>Blocks and gravity</b><br><sub>Text and shapes keep an anchor point, an offset, and hug / fixed / fill sizes.</sub></td>
  </tr>
  <tr>
    <td valign="top"><img src="assets/icons/picture.svg" width="32" height="32" alt=""><br><b>Pictures and icons</b><br><sub>Images by address or vault path; Lucide icons by name.</sub></td>
    <td valign="top"><img src="assets/icons/frames.svg" width="32" height="32" alt=""><br><b>Frames</b><br><sub>Screens share a layout and store only what they change.</sub></td>
    <td valign="top"><img src="assets/icons/magnet.svg" width="32" height="32" alt=""><br><b>Snapping</b><br><sub>Edges, middles, margins and neighbours, with guide lines.</sub></td>
  </tr>
  <tr>
    <td valign="top"><img src="assets/icons/map.svg" width="32" height="32" alt=""><br><b>Screen map</b><br><sub>Every screen as a tree, joined by how you get there.</sub></td>
    <td valign="top"><img src="assets/icons/window.svg" width="32" height="32" alt=""><br><b>Its own window</b><br><sub>A full editor on a computer, a bottom sheet on a phone.</sub></td>
    <td valign="top"><img src="assets/icons/text.svg" width="32" height="32" alt=""><br><b>Plain JSON</b><br><sub>One file per screen, one block per line. Small diffs.</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%" align="center"><img src="assets/frames.png" alt="Frames"><br><sub><b>Frames</b>: inherited blocks are locked; override one or edit it where it lives</sub></td>
    <td width="50%" align="center"><img src="assets/picture.png" alt="Picture settings"><br><sub><b>Pictures</b>: click or drag to choose the part the box shows</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/snapping.png" alt="Snapping"><br><sub><b>Snapping</b>: guide lines show what it snapped to</sub></td>
    <td align="center"><img src="assets/map.png" alt="Map view"><br><sub><b>Map</b>: every screen as a tree</sub></td>
  </tr>
</table>

## <img src="assets/icons/download.svg" width="24" height="24" alt=""> Install

- **Community plugins**: coming soon.
- **[BRAT](https://github.com/TfTHacker/obsidian42-brat)**: add the beta plugin `zelvet-velvet/vellum`.
- **Manual**: copy `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/zelvet-velvet/vellum/releases/latest) into `<vault>/.obsidian/plugins/vellum/`, then enable **Vellum**.

## <img src="assets/icons/play.svg" width="24" height="24" alt=""> Quick start

1. Click **Vellum** in the ribbon. The editor opens on `Screens/`.
2. **New Screen**, add a block, place items in it.
3. **Ctrl+S** to save.

Want sample screens? Copy [`examples/Vellum Demo.md`](examples/Vellum%20Demo.md) into your vault.

## <img src="assets/icons/robot.svg" width="24" height="24" alt=""> With your agent

Any agent that reads and writes files works: Claude Code, Codex, Cursor. No plugin API, no server.

1. **The agent drafts** your app's screens, or proposes new ones.
2. **You adjust** them in the editor and leave a **Note** on what to change.
3. **The agent builds** from the screens you changed.

```text
Read github.com/zelvet-velvet/vellum's README for the file format.
Write each page of my app as a Vellum screen in Design/Screens, one JSON file per screen.
Use real text, pictures by https address and icons by Lucide name. Keep ids stable.
```

> [!TIP]
> Ask for two or three **mocks** (`"mock": true`) as sub screens and keep the one you like. The agent can write while the editor is open: Vellum reloads the files and never overwrites your unsaved edits.

<sub>The screens of [Morellonomicon](https://github.com/zelvet-velvet/Morellonomicon) and ZeLedger were designed this way, with Claude Code.</sub>

## <img src="assets/icons/braces.svg" width="24" height="24" alt=""> File format

```mermaid
flowchart LR
  D["Doc<br/>device, safe areas"] --> P["Page<br/>one screen"]
  P --> B["Block<br/>x, y, w, h, kind"]
  B --> I["Item<br/>text · rect · ellipse · line<br/>img · icon · row · col"]
  P -. "inherit: true" .-> F["Parent page<br/>used as its frame"]
```

A folder holds one JSON file per screen, plus `_doc.json` for the device and the screen order. Show it in a note with:

````markdown
```vellum
src: Design/Screens
```
````

```json
{"id": "home", "name": "Home", "blocks": [
  {"id": "b1", "name": "Title", "kind": "nav", "x": 16, "y": 70, "w": 370, "h": 44, "items": [
    {"id": "t1", "type": "text", "v": "HOME", "font": "display", "size": 32, "g": "l"}]}]}
```

<details>
<summary><b>Field reference</b></summary>

| Level | Fields |
| :--- | :--- |
| **Doc** | `device`; `safe`, `safeLand` (`top bottom left right`, each optional) |
| **Page** | `name`, `note`, `parent`, `link` (how you get there), `inherit` (`true`: the parent is its frame), `device`, `bg`, `mock`, `blocks`, `land` (the landscape layout) |
| **Block** | `name`, `kind`, `note`, `x y w h` (screen points), `bleed` (`true`: may go into the safe areas), `items` |
| **Any item** | `g` (anchor: `tl t tr l c r bl b br`), `dx dy`, `w h` (a number, `"hug"` or `"fill"`), `op`, `note` |
| `text` | `v size wt font color ls lh upper` |
| `rect` `ellipse` `line` | `fill stroke sw r` (`r`: one radius, or four: `[tl, tr, br, bl]`) |
| `img` | `src` (`https://…` or a vault path), `fit` (`cover` · `contain` · `fill`), `pos` (CSS object-position), `r` |
| `icon` | `name` (Lucide), `color size sw` |
| `row` `col` | `items gap pad main cross`, `fill stroke sw r` |

**Frames.** A page with `"inherit": true` draws its parent's blocks under its own. An own block with the same `id` replaces the parent's one; the page stores only its own blocks.

**Colours and fonts.** Items use theme names (`paper text dim line tile loud accent`; `ui display mono`), set in Settings → Vellum, or any CSS value.

</details>

## <img src="assets/icons/keyboard.svg" width="24" height="24" alt=""> Shortcuts

| | |
| :--- | :--- |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Nudge 1 pt, with <kbd>Shift</kbd> one grid step |
| <kbd>Ctrl</kbd> <kbd>Z</kbd> · <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> | Undo · redo |
| <kbd>Ctrl</kbd> <kbd>D</kbd> · <kbd>Delete</kbd> | Duplicate · delete |
| <kbd>Ctrl</kbd> <kbd>S</kbd> · <kbd>Esc</kbd> | Save · go up a level |
| <kbd>Alt</kbd> / <kbd>Shift</kbd> while dragging | No snapping · keep the shape |

## <img src="assets/icons/question.svg" width="24" height="24" alt=""> FAQ

<details>
<summary><b>Does Vellum use the network?</b></summary>

Only to show a picture whose `src` is an `https://` address, as an image in a note would. Vellum makes no requests of its own.
</details>

<details>
<summary><b>Does it work on a phone?</b></summary>

Yes. The editor takes the full screen, with its settings in a bottom sheet.
</details>

<details>
<summary><b>Where is unsaved work kept?</b></summary>

On the device, in Obsidian's storage for that vault, until you save.
</details>

<details>
<summary><b>How do I build it?</b></summary>

```sh
npm install && npm run check && npm run build
npm run install-vault -- /path/to/vault
```
</details>

## <img src="assets/icons/coffee.svg" width="24" height="24" alt=""> Support

Vellum is free and made in my spare time. If it helps you, a coffee keeps it going.

<a href="https://ko-fi.com/zelvet_velvet"><img src="assets/kofi-button.svg" alt="Buy me a coffee on Ko-fi" width="236" height="44"></a>
