# Vellum: a guide for coding agents

You are helping someone design an app's screens with **Vellum**, an Obsidian plugin. The screens are JSON files in their
vault; they edit them on a phone frame in Obsidian, you read and write the same files. Field by field, the format is in
the [Field reference](../README.md#-file-format).

## 1. Set up the folder
- One folder per app, e.g. `Design/Screens/`: one JSON file per screen, and `_doc.json` with the device and screen order.
- **Tell the user where it is.** Vellum's ribbon button opens the folder in **Settings → Vellum → Screens folder**; if that
  folder has no screens, Vellum offers the folders that do. The command **Vellum: Open screens from another folder** picks one.
- To show the screens in a note, add a code block `vellum` with the line `src: Design/Screens`.

### Several apps in one vault
An app is a folder with a `_doc.json`; its screens are the `.json` files right in it. Put the apps side by side under one
parent folder:

```text
Design/
├─ Remote/                the phone app
│  ├─ _doc.json           its device, corner, bar, safe areas; "order": the screens' ids in order
│  ├─ Home.json
│  └─ Settings.json
└─ Console/               the desktop companion
   ├─ _doc.json           "device": "custom-1280x800", "radius": 0, "bar": {"style": "none"}
   └─ Main window.json
```

- Each app has its **own frame**: set up each `_doc.json` on its own (section 2). A phone app and a desktop window never
  share one folder.
- Vellum puts this guide in each app's folder as `AGENTS.md` when the app is made in Vellum. When you make an app folder
  yourself, copy the `AGENTS.md` of another app into it as it is (Vellum keeps the copies up to date).
- Vellum reads only the files right in the folder: subfolders are not screens. Don't nest one app inside another; keep
  anything else (notes, exports, images) out of an app's folder or in a subfolder of it. Any other `.json` file in the
  folder is read as a screen and reported as broken.
- A screen links only to screens of its own app: `parent` and `inherit` take the id of a screen in the same folder.
  Screen ids are unique within an app; the same id may be used in another app.
- A new screen goes in `order` in `_doc.json` where it belongs in the flow; a screen missing from `order` is listed last.
- The app's name in the editor's top bar is the folder's name: name folders as the user calls the apps. It switches
  between the apps, each keeping its own device and last screen.

## 2. Set up the frame, before the first screen
Every screen is drawn on the app's frame: its size, corner, status bar and safe areas. Set them in `_doc.json` to match
the real app, before drawing anything; blocks are placed inside the safe areas, so a wrong frame moves every screen.
Ask the user which device or window size they target if you can't tell.

| The app | In `_doc.json` |
| :--- | :--- |
| An iPhone app | `"device": "iphone-16"` (or `iphone-16-pro`, `iphone-16-pro-max`, `iphone-air`, `iphone-14`, `iphone-se`…): its own corner, notch or island and safe areas. Nothing else needed |
| An Android app | `"device": "pixel-8"` (or `galaxy-s24`, `galaxy-s25-ultra`), and `"bar": {"style": "android"}` |
| A desktop window, a web page, a panel | `"device": "custom-1280x800"` (its size in points), `"radius": 0`, `"bar": {"style": "none"}`, `"safe": {"top": 0, "bottom": 0, "left": 0, "right": 0}` |
| A tablet | `"device": "custom-820x1180"`, `"radius": 18`, `"safe": {"top": 24, "bottom": 20}` |

- A custom size starts with a phone's frame (a 40 pt corner, 44 / 24 safe areas): **always** set `radius`, `bar` and
  `safe` for one.
- `safeLand` is the same for landscape, if the app turns.
- A window's own title bar, a browser's address bar or a tab bar are **blocks** on the screen, not the device's bar.

## 3. When the user wants options: mocks, not an artifact
For "show me a few ways this could look", make the options **in Vellum**, not as an HTML page or image: they land on the
phone frame, next to the real screens, in the same format you will build from.
- Write two or three sub screens: `"parent": "<the screen's id>"`, `"mock": true`, names like `Home · option A`.
- Each is a whole screen. The user compares them in the editor and the **Map**, keeps one, and you delete the rest.

## 4. What a screen can hold
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
| The phone | `_doc.json`: `device`, `safe` areas, `radius` (0: square), `bar` (iOS, Android, none): see section 2 |
| Landscape | `land`: the landscape layout of the same screen |

Items sit in their block by an anchor `g` (`tl t tr l c r bl b br`) and an inward offset `dx dy`; sizes are a number,
`"hug"` or `"fill"`. Colours are theme names (`paper text dim line tile loud accent`) so the screen follows the user's
theme; fonts are `ui display mono`.

## 5. One item per part: draw it the way the user will edit it
The user changes your screens by hand: they choose an item, drag it, restyle it, or press **Copy reference** on it and
ask you to change that one thing. They can only do that to a part that is **its own item**. So:
- **Each label, value, icon, button, chip and divider is its own item.** A label and its value are two texts, not one
  text with a line break. A button is a `text` with its own box, not a `rect` with a `text` on top.
- **A card or a component is a block of items**, never one `img`, one `rect` or one long `text` standing in for it. A
  list is a block with one item (or one `row`) per entry, not one text with a line per entry.
- **Name every block** as the user would say it (`Balance card`, `Tab bar`, `Sort chips`): references and the editor
  show the name, and `Block 3` tells nobody anything. Use stable, readable `id`s (`balance-card`).
- Place a card's contents as items right in the block (`g` with `dx dy`): the user drags only a block's own items, so
  anything inside a `row` or `col` can't be moved by hand. Keep `row` / `col` for real flows, and never put one inside
  another. Items that belong together go in a `group`: each stays its own item.
- Frames are a block's own look or a text's own box, not a `rect` drawn underneath.

## 6. Talking to the user
- **References**: the user may paste `[Design/Screens/Home.json › Card (card-1)]`: the file, the block (and item) they
  mean. Change only that.
- **Marks** are notes on the screen, never part of the design: read the user's (`marks` on a page), and answer with your
  own, `"by": "agent"`: a `note` pinned at `x y`, an `area` (`w h`), a guide `line`.
- A mark's `color` tells the user what it is at a glance: `yellow` (the default) a remark, `red` a problem or something
  broken, `orange` a question for the user, `green` done or agreed, `blue` how it works or what to build, `purple` an
  idea or an option, `gray` an aside. Keep one meaning per colour on a screen.
- A note's bubble is as wide as its text unless you set `w`; keep notes short and give long ones a `w` (around 160–220).
- A page's `note` says what the screen is for. Keep it current.

## 7. Rules
- Keep `id`s stable: the user's references and marks point at them.
- Keep each file's layout: the screen's own fields on the first line, then one block per line.
- A block wholly outside the screen is a **draft** the user parked there: leave it, don't build it.
- The user may have the editor open. Write the files; Vellum reloads them and never overwrites unsaved edits.

## 8. Before you finish
Check each screen you wrote:
- `_doc.json` has the frame for this app (section 2).
- Every block has a name the user would say.
- No text holds two things (a label and its value, a list of entries); no `img` or `rect` stands in for a component.
- No `row` or `col` inside another.
- Your marks have a `color` that says what they are, and `"by": "agent"`.
