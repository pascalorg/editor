# Inspector Field Limits

*When a numeric inspector field may and may not have `min`/`max`.*

Applies to: `packages/nodes/src/**/parametrics.ts`, `packages/nodes/src/**/panel.tsx`, and any `<SliderControl>` usage.

`SliderControl` is a scrubby number input, not a range slider: dragging applies a step-based delta (`dx/4 × step`), and the wheel/arrow keys step likewise. `min`/`max` play no role in the interaction — they are pure clamps, defaulting to ±Infinity, and a typed value beyond them is clamped **silently**. A max therefore never "smooths" anything; it only blocks users, and blocking reads as "the app ignored me". Sweep of 2026-08: all arbitrary maxes were lifted (editor PR for `chore/field-limit-sweep`).

## Rules

- **Never cap a physical dimension at its "typical" size.** Wall length is not 20 m, roof spans are not 25 m. For dimension fields (width / height / depth / length / span / thickness / spacing / diameter in meters) use `max: 1000` — a value nobody legitimately reaches that still catches a pasted or fat-fingered number before it produces degenerate geometry (spatial grid, shadows, bake). If even a typo is harmless (see positions below), omit `max` entirely.
- **Positions and offsets get no static bounds.** Omit `min`/`max`. Never feed a scrub window (`value ± N`) into `min`/`max` — that turns a UI convenience into a hidden clamp on typed input.
- **Mins are validity only.** Dimensions need a small positive floor (typically 0.01–0.1 m) so zero/negative geometry can't exist. A min must never encode "typical" (the old wall `min: 1.5` blocked parapets and garden walls).
- **Dynamic geometric bounds are encouraged.** Limits derived from the node or its host encode real validity and stay: door width ≤ host wall (`maxDoorWidth`), curve sagitta ≤ chord, roof-accessory positions within their segment face, cabinet carcass ≥ tallest module.
- **Keep bounds that are not dimensions:** counts (rows, posts, steps, louvers — they multiply generated geometry, so the cap is a perf guard), percentages and 0–1 fractions, angle ranges (pitch, tilt, opening), rotation −180..180.

## Deliberate exemptions

- **MEP inch fields** (duct, pipe, lineset, HVAC collars): bounds mirror real trade sizes and carry domain meaning.
- **Cabinet run width (3 m):** width drives auto-generated carcass modules, so the max is a geometry-count guard, not taste.
- **Item dimensions:** the 30 m envelope ties into the studio item-builder and bake caps; change it there, not here.
- **Detail knobs** (bevels, insets, overhangs, flanges, rails, sills, trim): bounded ranges are fine — they parameterize a shape, and extreme values produce self-intersecting geometry rather than a bigger valid object.

Lengths that generate periodic children (gutter hangers, fence posts, downspout straps) scale instance counts with the value. That cost is user-visible and undoable — it is not a reason to reintroduce a cap.

New kinds and new fields follow these rules; PR review should reject static maxes on dimension fields.
