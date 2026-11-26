# Vellum: a guide for coding agents

You are helping someone design an app's screens with **Vellum**, an Obsidian plugin. The screens are JSON files in their
vault; they edit them on a phone frame in Obsidian, you read and write the same files. Field by field, the format is in
the [Field reference](../README.md#-file-format).

## The workflow
Design and code meet in the same files. One round goes like this:

1. **Frame first.** Find or make the app's folder (section 1), set its device and colours in `_doc.json` (section 2).
2. **Draft the screens.** One JSON file per screen, one item per part (section 5), each block named. Link them with
   `parent` and `link` so the Map shows the flow. Tell the user which files you wrote and where.
3. **The user looks and edits.** In Vellum they drag and restyle in **Edit**, tap through in **Show**, see every screen
   as a tree in the **Map**. They change things by hand, leave **marks** (notes) on the screen, or press **Copy
   reference** on a block and paste it to you with what to change.
4. **You answer.** Read the files again first: the user may have moved things since. Change only what a reference or a
   mark points at. Options are mock sub screens (section 3); a change to a real screen waits for review (`_before/`,
   section 3). Answer marks with marks of your own (section 6).
5. **The user keeps or undoes** each change in the Map, keeps one option, and you delete the other options.
6. **Build from the screens** (section 8) once the user says a screen is ready. Ask before building a screen that
   still has open marks, mock options, or a change waiting for review (its copy in `_before/`).
7. **Keep them in step.** When the built app changes, change its screens too, so the next round starts from what is
   real.

Read a screen's file again before each change, never from memory of an earlier turn. If the user has the editor open,
Vellum reloads what you write; their unsaved edits are kept.

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
Ask the user which device or window size they target if you can't tell; if you can't ask now, pick the likeliest,
say which in your reply, and leave an `orange` mark asking. Each device's size and safe areas are in **Devices** at the
end of this file: place blocks inside them.

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
- Settings → Vellum → **Editor theme** colours only the editor around the screens (its panels, the stage). It is never
  the app's look: don't read it, and don't build from it.

## 3. When the user wants options: mocks, not an artifact
For "show me a few ways this could look", make the options **in Vellum**, not as an HTML page or image: they land on the
phone frame, next to the real screens, in the same format you will build from.
- Write two or three sub screens: `"parent": "<the screen's id>"`, `"mock": true`, names like `Home · option A`, ids
  like `home-option-a`, each file named after its screen (`Home · option A.json`). Put them in `order` right after the
  screen. No `link` is needed: they are options for that screen, not a way to it.
- Each is a whole screen. The user compares them in the editor and the **Map**, keeps one, and you delete the rest.
- **The one kept becomes the real screen**: copy the screen to `_before/` (a change, as below), put the option's blocks
  in it (the screen keeps its own `id`, `name`, `parent`, `link`; no `mock`), then delete every option's file and take
  them out of `order`. The user reviews it as any change.

### A change to a screen that exists: it waits for review
For "change it", change the real screen, and leave its old version where Vellum can show it:
- Before you change a screen, copy its file to `_before/<the same file name>` in the app folder, unless a copy is
  already there (that copy is the version the user last approved; keep it). Then edit the screen in place.
- Every change of yours to a screen goes through this, whatever the reason: the user's request, a fix you make on your
  own, both at once. One copy covers them all; say in your reply what changed, so the user knows what Keep accepts.
- Never keep the old version in a temporary folder or anywhere else: Vellum can't see it, and the next session won't
  know it is there.
- Vellum marks the screen **Changed**; the user holds **B** to see it as it was, then keeps the change (the copy goes)
  or undoes it (the copy is put back). Don't write a copy again for a screen whose copy is gone until your next change.
- Don't edit or delete files in `_before/` yourself, and never treat them as screens.
- Options stay mock sub screens, as above.

## 4. What a screen can hold
A screen file, whole (the file is named after the screen: `Home.json`):

```json
{"id": "home", "name": "Home", "note": "What this screen is for.", "marks": [], "blocks": [
  {"id": "header", "name": "Header", "kind": "nav", "x": 0, "y": 59, "w": 393, "h": 56, "items": [{"id": "title", "type": "text", "v": "Home", "size": 28, "wt": 700, "font": "display", "g": "l", "dx": 20}, {"id": "settings", "type": "icon", "name": "settings", "g": "r", "dx": 20}]},
  {"id": "balance-card", "name": "Balance card", "kind": "card", "x": 16, "y": 127, "w": 361, "h": 120, "fill": "tile", "r": 16, "items": [{"id": "label", "type": "text", "v": "Balance", "size": 13, "color": "dim", "g": "tl", "dx": 16, "dy": 16}, {"id": "amount", "type": "text", "v": "$4,210", "size": 34, "wt": 700, "g": "bl", "dx": 16, "dy": 16}, {"id": "divider", "type": "line", "w": 329, "h": 1, "fill": "line", "g": "b", "dy": 0}, {"id": "send", "type": "text", "v": "Send", "size": 15, "color": "paper", "fill": "accent", "r": 10, "pad": 10, "g": "br", "dx": 16, "dy": 16}]}
]}
```

- **Every screen, block and item has an `id`**: a screen without one isn't loaded; `order` in `_doc.json` lists the
  screens' `id`s; references and marks point at block and item ids. Unique within the screen, readable, never changed.
- **An item's kind is its `type`**: `text rect ellipse line img icon row col group`.
- **A block's `kind`** is one of `hero` (a summary or a big number), `nav` (a title or navigation bar), `card`, `list`,
  `tiles` (a grid), `action` (inputs and buttons), `float` (floating over the rest). Another value shows as `hero`.
- **A `line` is a thin box**: `w` long and `h: 1` across (or `w: 1`, `h` long down), its colour in `fill`. `h: 0` draws
  nothing.
- **A text lines up by its anchor**: `g` `t c b` centre it, `tr r br` set it right; there is no other alignment field.
  Give it a `w` (or `"fill"`) to centre it across a width. On a centred anchor `dx` moves it from the middle (negative:
  left); on `l` / `r` anchors it is the distance in from that side, as `dy` is for `t` / `b`.
- **Marks** are in screen points, anywhere on the screen.

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

**A `"fill"` size ignores the anchor on that side**: the item stretches across the block (or its group), and `dx`
(for `w`) or `dy` (for `h`) is the margin kept at both ends, as the Place panel's **Margin** shows it. A divider across
a card with 16 pt each side is `"w": "fill", "dx": 16`; a full-width bar is `"w": "fill"` with no `dx`.

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
  mean, by name and `(id)`. Change only that. If the id isn't in the file, match the name, and say so.
- **Marks** are notes on the screen, never part of the design: read the user's (`marks` on a page), and answer with your
  own, `"by": "agent"`: a `note` pinned at `x y`, an `area` (`w h`), a guide `line`.
- A mark's `color` tells the user what it is at a glance: `yellow` (the default) a remark, `red` a problem or something
  broken, `orange` a question for the user, `green` done or agreed, `blue` how it works or what to build, `purple` an
  idea or an option, `gray` an aside. Keep one meaning per colour on a screen.
- A note's bubble is as wide as its text unless you set `w`; keep notes short and give long ones a `w` (around 160–220).
- A note's bubble sits on its pin's right unless it has `tx ty`: the point, in points from the pin, the bubble hangs
  from, centred on it, on its `side` (`left`, `right`, `above`, `below`): `"tx": -12, "ty": 0, "side": "left"`. Keep the
  pin on what the note is about; near the screen's right edge, or over the thing you mean, move the text instead.
- A page's `note` says what the screen is for. Keep it current.

## 7. Rules
- Keep `id`s stable: the user's references and marks point at them.
- Keep each file's layout: the screen's own fields (`id name note parent link mock marks`…) on the first line, then
  one block per line, as in the example in section 4.
- A block wholly outside the screen is a **draft** the user parked there: leave it, don't build it.
- `"lock": true` on a block or an item means the user locked it so clicks on the screen go through it (a background, a
  picture under the content). Keep it, and lock a full-screen background or backdrop you draw yourself.
- The user may have the editor open. Write the files; Vellum reloads them and never overwrites unsaved edits.

## 8. Build the app from the screens
- **Sizes are points** (iOS points, Android dp, CSS px at 1×) on the device in `_doc.json`. A block's `x y` count from
  the screen's top left, and blocks keep out of the safe areas unless `bleed`: build with the platform's safe-area
  insets (a block at `y` = `safe.top` sits right under the inset), not fixed offsets.
- **A block is a component or a section** (its name is a good type name: `BalanceCard`, `TabBar`); its `kind` says
  what sort (`hero nav card list tiles action float`, section 4). Its items are the component's parts.
- **Anchors are alignment**, `dx dy` padding from that edge (section 4). `"hug"` is wrap-content, `"fill"` fills the
  block. A `row` / `col` is a stack (`HStack`, `Row`, flex) with its `gap pad main cross`.
- **Colours and fonts are tokens**: the names in `_doc.json`'s `themes` / `colors` and `ui display mono`. Make them the
  app's theme, then use the names, never the hex values, so light and dark both work. `ui` is the body text, `display`
  the headings and big numbers, `mono` figures that line up; use the app's own fonts for them (ask if it has none).
- **Layout is the intent, not the coordinates**: blocks one under another are a stack, the gaps between them its
  spacing; a `float` block is an overlay. Use absolute positions only where the design is really free-placed.
- **Icons** are Lucide names: use the app's icon set if it has Lucide, else the platform's closest (SF Symbols, Material
  Symbols) and keep the meaning.
- **A `nav` block or a tab bar** is the platform's own bar when the app uses one: the block says what it holds and where
  it sits.
- **`parent` and `link` are navigation**: a child screen opens from its parent, the `link` says how (a tap on a row,
  a tab).
- `mock` screens, drafts (blocks outside the screen), marks and `_before/` copies are never built.
- When the code can't do something a screen shows, or needs a choice the screen leaves open, leave a `blue` or
  `orange` mark on the screen saying so, rather than guessing.

## 9. Before you finish
Check each screen you wrote:
- `_doc.json` has the frame for this app (section 2).
- Every block has a name the user would say.
- No text holds two things (a label and its value, a list of entries); no `img` or `rect` stands in for a component.
- No `row` or `col` inside another.
- Your marks have a `color` that says what they are, and `"by": "agent"`.
