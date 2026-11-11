---
name: vl-model
description: Vellum's screen format. Use when reading or writing Vellum screen JSON, or changing src/model.ts, src/store.ts or scripts/convert-frames.py.
---
# The screen format

`src/model.ts` is the source of truth for fields; the README's File format section is the public description. Keep both in step with any change.

## Shape
- Doc: `{id, device, safe?, safeLand?, pages}`. As a folder: one JSON per screen, plus `_doc.json` (`id`, `device`, `safe`, `safeLand`, `order`).
- Page: `{id, name, parent?, link?, inherit?, mock?, bg?, note?, blocks, land?}`. `land` is the landscape layout.
- Block: `{id, name, kind, x, y, w, h, bleed?, fill?, stroke?, sw?, r?, sides?, note?, items}`.
- Item types: `text`, `rect`, `ellipse`, `line`, `img`, `icon`, `row`, `col`.

## Rules
- A block sits at fixed x / y. An item is placed by gravity `g` (`tl`…`br`) with an inward `dx` / `dy`. Sizes are a number, `"hug"` or `"fill"`.
- `r` is one number or four, `[tl, tr, br, bl]`.
- Don't draw a frame as a `rect` under content: it is hard to select and hard-coded. Use the block's own look (`fill`, `stroke`, `sw`, `r`, `sides`), or a text's own box (`fill`, `stroke`, `sw`, `r`, `pad`; with a set `h` its text is centred).
- A text's box has the same padding on every side, so a text off to one side keeps its rect.
- Colours are theme names (`paper`, `text`, `dim`, `line`, `tile`, `loud`, `accent`) where possible, so they follow the theme. Otherwise use `#hex`.
- Frames: with `inherit`, the parent's blocks are drawn under the page's own. An own block with the same `id` as a frame's block overrides it, so ids must be stable. Item ids should be unique within a page.
- `bleed` lets a block go into the safe areas. Otherwise drags keep it inside.
- `mock: true` marks an option to choose from, not a real screen.

## Writing files
- Keep the one-line-per-block layout from `pageText`: JSON compact, a screen's own fields on the first line. Git diffs depend on it.
- Old files must keep loading: `parseDoc` migrates them. Add to it rather than breaking a field.
- The editor reloads files changed on disk and never overwrites unsaved edits. Check for an unsaved draft before a bulk rewrite.
- `scripts/convert-frames.py` is a dry run without `--write`. Back up the folder before writing, and review the result on screen.
