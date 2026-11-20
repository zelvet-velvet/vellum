# Vellum: a guide for coding agents

You are helping someone design an app's screens with **Vellum**, an Obsidian plugin. The screens are JSON files in their
vault; they edit them on a phone frame in Obsidian, you read and write the same files. Field by field, the format is in
the [README's File format](../README.md#-file-format).

## 1. Set up the folder
- One folder per app, e.g. `Design/Screens/`: one JSON file per screen, and `_doc.json` with the device and screen order.
- **Tell the user where it is.** Vellum's ribbon button opens the folder in **Settings → Vellum → Screens folder**; if that
  folder has no screens, Vellum offers the folders that do. The command **Vellum: Open screens from another folder** picks one.
- Several apps in one vault: each its own folder with its own `_doc.json` (its own device). The **App** menu at the top of
  the editor's screens list switches between them.
- To show the screens in a note, add a code block `vellum` with the line `src: Design/Screens`.

## 2. When the user wants options: mocks, not an artifact
For "show me a few ways this could look", make the options **in Vellum**, not as an HTML page or image: they land on the
phone frame, next to the real screens, in the same format you will build from.
- Write two or three sub screens: `"parent": "<the screen's id>"`, `"mock": true`, names like `Home · option A`.
- Each is a whole screen. The user compares them in the editor and the **Map**, keeps one, and you delete the rest.

## 3. What a screen can hold
| Want | Use |
| :--- | :--- |
| A card, a bar, a list | A **block**: a box at `x y w h` (points) with a `kind` and its own look: `fill stroke sw r`, `sides` |
| Words, numbers, a chip or button | A `text` item; its own box (`fill stroke r pad`) makes a chip, tile or button |
| Shapes and dividers | `rect`, `ellipse`, `line` |
| Icons | `icon` with a [Lucide](https://lucide.dev/icons) name (`"name": "wallet"`); or an emoji in a `text` |
| Pictures | `img` with `src`: an `https://` address or a vault path; `fit`, `r` |
| A flow: a list of rows, chips, a label beside its value | `row` / `col` with `gap pad main cross` (spacing done for you) |
| Several items moved as one | `group`: each item in it can still be chosen and dragged |
| The same header on many screens | A frame: the parent screen's blocks, `"inherit": true` on the child |
| How you get to a screen | `parent` and `link` (e.g. `"tap a row"`): the Map and Show draw it |
| The phone | `_doc.json`: `device`, `safe` areas, `radius` (0: square), `bar` (iOS, Android, none) |
| Landscape | `land`: the landscape layout of the same screen |

Items sit in their block by an anchor `g` (`tl t tr l c r bl b br`) and an inward offset `dx dy`; sizes are a number,
`"hug"` or `"fill"`. Colours are theme names (`paper text dim line tile loud accent`) so the screen follows the user's
theme; fonts are `ui display mono`.

## 4. Talking to the user
- **References**: the user may paste `[Design/Screens/Home.json › Card (card-1)]`: the file, the block (and item) they
  mean. Change only that.
- **Marks** are notes on the screen, never part of the design: read the user's (`marks` on a page), and answer with your
  own, `"by": "agent"`: a `note` pinned at `x y`, an `area` (`w h`), a guide `line`.
- A page's `note` says what the screen is for. Keep it current.

## 5. Rules
- Keep `id`s stable: the user's references and marks point at them.
- Frames are a block's own look or a text's own box, not a `rect` drawn underneath.
- Place a card's contents as items right in the block (`g` with `dx dy`): the user drags only a block's own items, so
  anything inside a `row` or `col` can't be moved by hand. Keep `row` / `col` for real flows, and never put one inside
  another. Items that belong together go in a `group`.
- Keep each file's layout: the screen's own fields on the first line, then one block per line.
- A block wholly outside the screen is a **draft** the user parked there: leave it, don't build it.
- The user may have the editor open. Write the files; Vellum reloads them and never overwrites unsaved edits.
