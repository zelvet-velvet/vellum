# Vellum: a guide for coding agents

You are helping someone design an app's screens with **Vellum**, an Obsidian plugin. The screens are JSON files in their
vault; they edit them on a phone frame in Obsidian, you read and write the same files. Field by field, the format is in
the [Field reference](../README.md#-file-format).

## 1. Set up the folder
Every app is its own folder, inside one **Vellum folder** that holds this guide:

```text
Vellum/
├─ VELLUM.md              this guide: one copy for every app
├─ Remote/                an app: the phone app
│  ├─ _doc.json           its device, corner, bar, safe areas; "order": the screens' ids in order
│  ├─ Home.json           one JSON file per screen
│  └─ Settings.json
└─ Console/               another app: the desktop companion
   ├─ _doc.json           "device": "custom-1280x800-window"
   └─ Main window.json
```

- The Vellum folder is `Vellum/` at the vault's root unless the user already has one (in a code repo it may be
  `Docs/Design/` or the like): look for `VELLUM.md`, or for folders with a `_doc.json`.
- **Each app is a subfolder beside `VELLUM.md`**, even when there is only one app. Never put screens right in the Vellum
  folder. Name each app's folder as the user calls the app: the editor's top bar shows that name and switches between
  the apps.
- Starting from nothing: make the Vellum folder, put this guide in it as `VELLUM.md` (the user can also run **Vellum: Add
  the agent guide**), then the app's folder with its `_doc.json` (section 2) and its screens.
- **Tell the user where it is.** Vellum's ribbon button opens the app in **Settings → Vellum → Screens folder**; if that
  folder has no screens, Vellum offers the folders that do. The command **Vellum: Open screens from another folder** picks one.
- To show an app's screens in a note, add a code block `vellum` with the line `src: Vellum/Remote`.

### Rules of the folders
- Each app has its **own frame**: set up each `_doc.json` on its own (section 2). A phone app and a desktop window never
  share one folder.
- A folder in the Vellum folder is an app only when it has a `_doc.json`. Pictures shared by the apps can go in a
  folder of their own beside them (e.g. `Vellum/Images/`); Vellum leaves it alone.
- Vellum reads only the files right in an app's folder: subfolders are not screens. Don't nest one app inside another; keep
  anything else (notes, exports, images) out of an app's folder or in a subfolder of it. Any other `.json` file in the
  folder is read as a screen and reported as broken.
- A screen links only to screens of its own app: `parent` and `inherit` take the id of a screen in the same folder.
  Screen ids are unique within an app; the same id may be used in another app.
- A new screen goes in `order` in `_doc.json` where it belongs in the flow; a screen missing from `order` is listed last.

## 2. Set up the frame, before the first screen
Every screen is drawn on the app's frame: its size, corner, status bar and safe areas. Set them in `_doc.json` to match
the real app, before drawing anything; blocks are placed inside the safe areas, so a wrong frame moves every screen.
Ask the user which device or window size they target if you can't tell.

| The app | In `_doc.json` |
| :--- | :--- |
| An iPhone app | `"device": "iphone-16"` (or `iphone-16-pro`, `iphone-16-pro-max`, `iphone-air`, `iphone-14`, `iphone-se`…): its own corner, notch or island and safe areas. Nothing else needed |
| An Android app | `"device": "pixel-8"` (or `galaxy-s24`, `galaxy-s25-ultra`), and `"bar": {"style": "android"}` |
| A desktop window, a panel | `"device": "custom-1280x800-window"` (its size in points): square, no bar, no safe areas |
| A web page | `"device": "custom-1440x900-web"`: the same, for a browser's page |
| A tablet | `"device": "custom-820x1180-tablet"`: an 18 pt corner, an iOS bar, 24 / 20 safe areas |

- A custom size says what it is with its end: `-window`, `-web`, `-tablet`, or nothing for a phone (`custom-400x860`: a
  40 pt corner, an iOS bar, 44 / 24 safe areas). Set `radius`, `bar` or `safe` only to differ from that.
- `safeLand` is the same for landscape, if the app turns.
- A window's own title bar, a browser's address bar or a tab bar are **blocks** on the screen, not the device's bar.

**The app's colours.** Screens use colour names (`paper text dim line tile loud accent`), which follow Settings → Vellum.
Give an app its own colours in `_doc.json` when it has a palette of its own (a dark desktop window beside a light phone
app), or looks that must be checked side by side: light and dark, high contrast, a brand. Set it up with the frame,
before the first screen:

1. Ask which looks the real app has (or read its theme files): only one, light and dark, or more.
2. One look: put its colours in `colors`. Several: one palette per look in `themes`, named as the app names them
   (`light`, `dark`, `high contrast`, `brand-blue`…; any name but `auto`).
3. Give every palette all seven names, so no screen falls back to the user's own theme by accident. A colour the app
   needs beyond those (a brand colour, a chart colour) gets a name of its own, in every palette.
4. Set `theme` to the look the app opens in, or `"auto"` when it has a `light` and a `dark` and follows the system.
   Without `theme` the app opens in the user's Obsidian colours (the editor's **Obsidian** theme).
5. On the screens, use only the names (`"fill": "tile"`, `"color": "brand"`), never the hex values: then every theme
   draws every screen.

```json
"themes": {
  "dark":  {"paper": "#0F1113", "text": "#E6E8EB", "dim": "#9AA3AD", "line": "#2A2F36", "tile": "#181B1F", "loud": "#E5534B", "accent": "#5B8DEF"},
  "light": {"paper": "#FFFFFF", "text": "#1B1F24", "dim": "#5F6B78", "line": "#D8DDE3", "tile": "#F3F5F7", "loud": "#C9372C", "accent": "#2F6FEB"}
},
"theme": "auto"
```

- `colors` and `themes` can go together: `colors` holds what every theme shares, a theme's colours go over it. Names
  left out come from Settings → Vellum.
- The user changes these in Settings → Vellum → Screen colours (with the app chosen) or in the editor's Colours window
  (the palette button in its top bar), and switches between themes there; switching does not change the file. Read
  `_doc.json` again before you build: the colours may have changed.
- When you build, each theme is one of the app's colour sets (light, dark…), and each name is a colour token in it.

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
| Light and dark, or an app's own colours | `_doc.json`: `themes`, `theme`, `colors`: see section 2 |
| Landscape | `land`: the landscape layout of the same screen |

Items sit in their block by an anchor `g` (`tl t tr l c r bl b br`) and an inward offset `dx dy`; sizes are a number,
`"hug"` or `"fill"`. Colours are theme names (`paper text dim line tile loud accent`, and any the app's `_doc.json`
adds) so the screen follows the app's or the user's theme; fonts are `ui display mono`.

**The anchor is what the item stays attached to** when the block or the item changes size (the editor's Place panel
shows it as the point the item holds on to). Choose it by intent, not by where the item happens to be: a value, a
chevron or a switch at the right edge takes `r` (or `tr` / `br`), a centred title `t` or `c`, a button at the bottom
`b`. Then a longer text or a wider card keeps it in place. When you build from a screen, the anchor is the alignment
(SwiftUI `alignment`, Compose `Alignment`, CSS `justify-self` / `align-self`), and `dx dy` are the padding inward from
that edge or corner, not coordinates. An item the user moved to the far side while its anchor stayed `tl` is still
meant to sit where it is drawn: ask, or set the anchor that matches before you build.

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
- **References**: the user may paste `[Vellum/Remote/Home.json › Card (card-1)]`: the file, the block (and item) they
  mean. Change only that.
- **Marks** are notes on the screen, never part of the design: read the user's (`marks` on a page), and answer with your
  own, `"by": "agent"`: a `note` pinned at `x y`, an `area` (`w h`), a guide `line`.
- A mark's `color` tells the user what it is at a glance: `yellow` (the default) a remark, `red` a problem or something
  broken, `orange` a question for the user, `green` done or agreed, `blue` how it works or what to build, `purple` an
  idea or an option, `gray` an aside. Keep one meaning per colour on a screen.
- A note's bubble is as wide as its text unless you set `w`; keep notes short and give long ones a `w` (around 160–220).
- A note's bubble sits on its pin's right unless it has `tx ty`: the point, in points from the pin, the bubble hangs
  from, centred on it, on that side (`-12 0` left, `0 -14` above, `0 14` below). Keep the pin on what the note is about;
  near the screen's right edge, or over the thing you mean, move the text instead.
- A page's `note` says what the screen is for. Keep it current.

## 7. Rules
- Keep `id`s stable: the user's references and marks point at them.
- Keep each file's layout: the screen's own fields on the first line, then one block per line.
- A block wholly outside the screen is a **draft** the user parked there: leave it, don't build it.
- `"lock": true` on a block or an item means the user locked it so clicks on the screen go through it (a background, a
  picture under the content). Keep it, and lock a full-screen background or backdrop you draw yourself.
- The user may have the editor open. Write the files; Vellum reloads them and never overwrites unsaved edits.

## 8. Before you finish
Check each screen you wrote:
- `_doc.json` has the frame for this app (section 2).
- Every block has a name the user would say.
- No text holds two things (a label and its value, a list of entries); no `img` or `rect` stands in for a component.
- No `row` or `col` inside another.
- Your marks have a `color` that says what they are, and `"by": "agent"`.
