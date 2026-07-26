# Formwork-System Node Kind — Implementation Plan

Scoping doc for a new registry-driven node kind that generates PERI-style
shutter/panel/tie/waler geometry from a wall's existing construction fields
(`formworkType`, `tieSpacing`, `walerSpacing`, `scaffoldRequired`), triggerable
either manually (wall panel button) or by the AI chat tool.

## Scope for v1
A new node kind, `formwork-system`, hosted by a wall (like door/window),
auto-generating shutter panels + ties + walers from data already on the wall.
Scaffold towers are a v1.5 follow-on (separate kind, same pattern).

## 1. Schema — `packages/nodes/src/formwork-system/schema.ts`
```ts
export const FormworkSystemNode = BaseNode.extend({
  type: z.literal('formwork-system'),
  hostWallId: z.string(),                // the wall this dresses
  panelWidth: z.number().default(0.6),   // PERI-style module: 0.6/0.9/1.2m
  // formworkType / tieSpacing / walerSpacing already live on the host
  // wall — this node reads them, doesn't duplicate them.
})
```
**Decision: fields stay on `WallNode`.** Simpler, zero migration risk,
matches how the AI chat tool already writes them via `set_wall_construction`.

## 2. Geometry — `packages/nodes/src/formwork-system/geometry.ts`
Pure function, no renderer/system file needed (follows fence's simple
pattern):
```ts
function buildFormworkGeometry(node: FormworkSystemNode, ctx): BufferGeometry
```
Math, in order:
1. Look up host wall by `hostWallId` → `start/end/height/thickness`.
2. `panelCount = ceil(wallLength / panelWidth)` — tile panels along the
   wall's direction vector, offset by wall normal ± thickness/2.
3. Tie rows: one row every `tieSpacing`, from a fixed edge margin to
   `height - margin`.
4. Waler beams: horizontal runs every `walerSpacing`, spanning full
   tiled length.
5. Return one merged `BufferGeometry` (panels + tie markers + waler
   beams).

**Decision: plain colored boxes for v1** (no real PERI textures/GLBs yet —
revisit once the layout math is confirmed visually).

## 3. Definition — `packages/nodes/src/formwork-system/definition.ts`
```ts
export const formworkSystemDefinition: NodeDefinition<typeof FormworkSystemNode> = {
  kind: 'formwork-system',
  schema: FormworkSystemNode,
  defaults: () => ({ ... }),
  capabilities: { selectable: { hitVolume: 'bbox' }, duplicable: false, deletable: true },
  relations: { affectsSpatial: [] },
  geometry: buildFormworkGeometry,
  system: { module: () => import('./system'), priority: 5 },
  presentation: { label: 'Formwork', paletteSection: 'hidden' },
}
```
No `tool` field → never a draggable Build tile. It's created by a small
helper (`attachFormworkToWall(wallId)`), callable from both trigger points
below.

## 4. Trigger points (manual or AI — both call the same helper)
- **Manual**: an "Add formwork geometry" button in the wall panel's
  Construction section (enabled once `formworkType !== 'none'`).
- **AI**: extend `set_wall_construction` in `apps/editor/lib/chat-ai.ts` to
  also call `attachFormworkToWall` after setting the wall fields.

## 5. Verify/fix loop (v2, after v1 geometry exists)
1. AI sets wall construction fields + calls `attachFormworkToWall`.
2. AI calls a new `inspect_formwork` tool: reads back panel count,
   tie/waler counts, total coverage — computed facts, not opinions.
3. AI checks the result against basic sanity rules (e.g. tie spacing ≤
   code max for wall thickness) — if it fails, adjusts spacing and
   rebuilds, loops until it passes or asks the user.
4. This loop is the first concrete instance of the parked "Construction
   Rules Engine" — worth building here rather than as a separate
   abstraction later.

## Milestones
1. Schema + definition + registration, empty group renders.
2. Panel tiling geometry (shutter grid only) — visual checkpoint.
3. Tie + waler geometry.
4. Manual button + AI tool wiring.
5. Verify/fix loop (v2) — separate scoping pass once v1 is confirmed.

## Decisions locked for v1
1. `formworkType`/`tieSpacing`/`walerSpacing`/`scaffoldRequired` stay on
   `WallNode`; `formwork-system` reads them, no schema migration.
2. Plain colored box geometry for panels/ties/walers — no textures/GLBs yet.
3. Scaffold towers deferred to v1.5, out of scope for this pass.
