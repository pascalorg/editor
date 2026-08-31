# Item authoring (paintable GLBs)

How to author a catalog item GLB so the editor keeps its materials as the default
appearance **and** exposes named parts as paintable **slots**. This is the content-author
contract for the file format; the runtime side (how a slot's colour is resolved and
re-applied) lives in [materials-and-themes](materials-and-themes.md), and procedural
slot declarations live in [node-definitions](node-definitions.md).

The whole convention is opt-in by material name — an item with no slot materials renders
its authored/baked look untouched and exposes nothing to paint.

## The slot contract

A glTF **material** whose name starts with `slot_` (case-insensitive) marks a paintable
part. The canonical rules live in `packages/core/src/lib/slots.ts` and are shared by both
the upload scan and the renderer, so authored names, stored slot metadata, and runtime
meshes can never drift:

- **One material per paintable part, named `slot_<part>`.** e.g. `slot_frame`,
  `slot_seat`, `slot_bed_frame`.
- **The slot id is derived** by `deriveSlotId`: strip the `slot_` prefix, drop a Blender
  numeric-dedupe suffix (`.001`), lowercase the rest. So `slot_Bed_Frame` and
  `slot_bed_frame.001` both resolve to the slot `bed_frame`. Splitting one logical part
  across several Blender materials that dedupe to the same id **merges** them into a
  single slot — intentional, so a part split for modelling reasons still paints as one.
- **Unmarked materials stay authored, forever.** A material without the `slot_` prefix
  renders exactly as authored and exposes no slot. This is the right choice for fixed
  labels, decals, signage, and baked detail (e.g. a fire-alarm sign, an AC front panel).
- **Paintable by naming alone.** A solid-colour slot samples no UVs, so a flat-colour
  item becomes fully paintable just by renaming its materials — no re-unwrap needed.

## Default appearance

The default look of a slot is **the authored material's own data** (its
`baseColorFactor` / maps), never encoded in the slot name. Painting a slot overrides that
default; resetting returns to it.

Curated cross-item defaults (e.g. "this seat defaults to the catalog linen") travel
**with the asset** as `pascal_material` glTF material extras, read at runtime from
`material.userData.pascal_material`. They're optional — with none present, the authored
material is the default.

## Reserved names

- **`cutout`** — a **mesh** (not a material) named `cutout` is treated as a boolean-cut
  helper: it is hidden at runtime and never becomes a slot or a visible surface. Use it
  for the negative volume a host opening subtracts, not for geometry you want shown.

## UV world scale (~1 unit per metre)

Tileable finishes assume the same world-scale UV contract as procedural surfaces: **1 UV
unit = 1 m** (see [materials-and-themes](materials-and-themes.md) → *Texture world
scale*). This is an **authoring requirement, not a render-time correction** — the slot
validator's UV-presence check flags slots that need UVs and don't have them. Flat-colour
slots need no UVs at all.

For fixed multi-colour detail *within* one slot, bake it into **vertex colours**: painting
swaps the slot's material but vertex colours ride along, so a two-tone part stays two-tone
under any finish.

## Blender recipe (validated)

1. **Apply scale** — `Ctrl+A` → Scale, so 1 Blender unit exports as 1 m and the UV
   world-scale promise holds.
2. **Rename materials** to `slot_<part>` for each paintable part.
3. **Hard-surface slots** — UV → **Cube Projection** with **Cube Size = 1.0**. This gives
   exactly 1 UV unit/m by construction; overlapping islands are fine because finishes tile
   and nothing is baked.
4. **Curved / soft slots** — use the **Texel Density** addon at **10.24 px/cm @ 1024 px**.
5. **Check** with a UV grid texture before exporting.

## Export (critical)

- **Custom Properties must be enabled.** In the Blender glTF exporter, turn on
  *Include → Custom Properties*, or `pascal_material` extras never reach the GLB and
  curated defaults are silently lost.
- **Preserve extras through optimisation.** Run an extras-preserving optimiser — gltfpack
  with `-ke` (keep extras). Author-side extras are read once at upload, so any stripping
  between export and upload loses them; the validator warns when extras look stripped.

## How the editor reads the result

On load, the renderer keeps the GLB's authored materials and, for every material whose
name derives a slot id, captures that slot on the instance so the paint tool can target
`(nodeId, slotId)`. Items authored with no `slot_` materials simply render their authored
look and expose no slots — there is no separate "mode" to set; the behaviour follows from
the material names in the file.
