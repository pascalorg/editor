import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { ItemNode } from './item'

/**
 * Parametric shelf — a configurable furniture unit with one or more
 * horizontal boards that host other items.
 *
 * Four styles share the same dimensional schema:
 *
 *   - `wall-shelf` — open boards held by end brackets. `rows > 1` stacks
 *     evenly-spaced boards. Brackets style: `minimal | industrial | hidden`.
 *     The v1 archetype.
 *   - `bookshelf` — full-height cabinet: side panels + multiple shelf
 *     boards. `columns > 1` adds vertical dividers between sections.
 *     `withBack` toggles a back panel. `withSides` toggles the side
 *     panels (`false` = open silhouette held by cross-brace posts).
 *   - `open-rack` — industrial wire-rack style: four corner posts, no
 *     side panels, slim boards. `withBack` adds an X-brace.
 *   - `cubby` — grid of pigeonhole cubicles: `rows × columns` cells
 *     formed by full back + sides + inner dividers. Each cubicle hosts
 *     items on its own bottom surface.
 *
 * `height` is the distance from floor to the underside of the topmost
 * board (legacy v1 semantic, preserved so v1 scenes load with identical
 * top-board placement). For `rows > 1`, boards are evenly spaced from
 * `height / rows` up to `height`. For `cubby`, the height divides into
 * `rows` equal-height cubicles.
 *
 * Items host on each row's top surface via `capabilities.surfaces.custom`.
 */
export const ShelfNode = BaseNode.extend({
  id: objectId('shelf'),
  type: nodeType('shelf'),
  // Hosted items live here — without this field `createNode(item, shelf)`
  // would write `item.parentId = shelf.id` but skip the children-list
  // update, so the shelf renderer wouldn't pick the item up and React
  // would never mount it (the item would exist in `useScene.nodes` but
  // not be rendered, making the commit look like "the item went
  // somewhere else"). The action's parent-update branch needs the field
  // present at parse-time so the children array is always defined.
  children: z.array(ItemNode.shape.id).default([]),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // Dimensions (meters). Schema-level defaults intentionally reproduce
  // the v1 wall-shelf so existing v1 scenes that omit the v2-introduced
  // fields (style / rows / columns / with*) load with their original
  // visual unchanged. The user-facing "place a fresh shelf" defaults
  // (cubby 3x2 @ 1m × 0.5m × 1.8m) live on `shelfDefinition.defaults()`
  // and are applied by the placement tool, NOT here.
  width: z.number().min(0.3).max(3.0).default(1.2),
  depth: z.number().min(0.1).max(1.0).default(0.3),
  /** Board thickness — shared by top boards, sides, back, dividers. */
  thickness: z.number().min(0.01).max(0.1).default(0.04),
  /**
   * Distance from floor to the underside of the topmost board. For
   * `rows > 1`, intermediate boards are evenly spaced from `height/rows`
   * up to `height`.
   */
  height: z.number().min(0.05).max(2.5).default(0.9),

  // Style + topology — v2 additions, default to v1 visual (single-board
  // wall shelf) so v1 scenes are forward-compatible without migration.
  style: z.enum(['wall-shelf', 'bookshelf', 'open-rack', 'cubby']).default('wall-shelf'),
  rows: z.number().int().min(1).max(8).default(1),
  columns: z.number().int().min(1).max(6).default(1),
  withBack: z.boolean().default(false),
  withSides: z.boolean().default(true),
  /**
   * Renders a horizontal board at floor level — closes the bottom row of
   * a cubby (or the base of a bookshelf) so items can host on a real
   * surface rather than the open floor. No-op for `wall-shelf` /
   * `open-rack` where the structure has no enclosed bottom cell.
   */
  withBottom: z.boolean().default(false),

  bracketStyle: z.enum(['minimal', 'industrial', 'hidden']).default('minimal'),

  // Paintable surface — same shape walls / slabs / stairs use. The default
  // is unset (renders as the off-white `DEFAULT_SHELF_MATERIAL`); paint
  // mode writes the chosen catalog material here. Keeping the same field
  // names (`material` / `materialPreset`) lets the existing
  // `buildSurfaceMaterialPatch` helpers in `material-paint.ts` work
  // unchanged once `'shelf'` is added to `MaterialTarget`.
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),

  // Per-slot material overrides, mirroring `ItemNode.slots`. Key = slot id
  // (`shelves` / `frame` / `back`, see `shelfSlots`), value = a `MaterialRef`
  // string (`library:<id>` or `scene:<id>`). Absent slot = fall back to the
  // legacy whole-shelf `material` / `materialPreset`, then the registry slot
  // default. A dangling ref renders the default (never blocks).
  slots: z.record(z.string(), z.string()).optional(),
})

export type ShelfNode = z.infer<typeof ShelfNode>
