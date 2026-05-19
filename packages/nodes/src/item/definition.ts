import type { ItemNode as ItemNodeType, NodeDefinition } from '@pascal-app/core'
import { buildItemFloorplan } from './floorplan'
import { itemFloorplanMoveTarget } from './floorplan-move'
import { itemParametrics } from './parametrics'
import { ItemNode } from './schema'

/**
 * Item — Phase 5 batch kind. Catalog-backed, GLB-rendered, multi-host.
 *
 * Demonstrates the **custom `def.renderer` escape hatch** (see
 * plans/editor-node-registry.md): items use `useGLTF` from drei to
 * load CDN assets, plus a non-trivial interactive-widget layer inside
 * the rendered scene. Not expressible as a pure `def.geometry`. The
 * registry mounts the custom React renderer as-is.
 *
 * Capabilities:
 *  - **No `movable`**: item's move is bespoke `MoveItemContent` —
 *    handles attachTo transitions mid-drag (floor ↔ wall ↔ ceiling),
 *    asset.attachTo lookups, scale-preserving Y math for surface
 *    placement. The smooth generic mover can't express that. Legacy
 *    mover keeps running via capability-driven dispatch.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Stages:
 *  - A: registered.
 *  - B: N/A — def.renderer escape hatch (GLB / useGLTF).
 *  - C: `def.floorplan` resolves parent chain via `ctx.resolve`,
 *    returns a rotated rectangle (width × depth). Mirrors the legacy
 *    `getItemFloorplanTransform` math. Legacy `floorplanItemEntries`
 *    short-circuits when item is registered.
 *
 * `toolHints`: matches the legacy ItemHelper UI (mouse / R / T / Shift /
 * Esc) — registry-driven placement panel.
 */
export const itemDefinition: NodeDefinition<typeof ItemNode> = {
  kind: 'item',
  schemaVersion: 1,
  schema: ItemNode,
  category: 'furnish',

  // Defaults shape is cast: the schema requires a fully-typed `asset`
  // field, but in practice items are always created from the catalog
  // (the asset is supplied at placement time). `createNode` re-parses
  // through the schema, so any missing zod defaults fill at runtime.
  defaults: () =>
    ({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      asset: {
        id: 'placeholder',
        category: 'misc',
        name: 'Item',
        thumbnail: '',
        src: 'asset:placeholder',
        dimensions: [1, 1, 1],
        source: 'library',
      },
    }) as unknown as Omit<ItemNodeType, 'id' | 'type'>,

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Floor items get lifted by slabs underneath via the generic
    // `<FloorElevationSystem>`. Wall- / ceiling-attached items live in
    // their parent's local frame and skip the lift via `applies`.
    floorPlaced: {
      footprint: (node) => {
        const item = node as ItemNodeType
        return { dimensions: getScaledDimensions(item), rotation: item.rotation }
      },
      applies: (node) => !(node as ItemNodeType).asset.attachTo,
    },
  },

  parametrics: itemParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Same priority as the legacy ItemSystem.
    priority: 2,
  },
  // Catalog placement tool — mounted when `useEditor.tool === 'item'`.
  // Wraps the same placement coordinator the move-tool uses (surface
  // strategies for floor / wall / ceiling / item-surface). Replaces
  // the legacy `editor/src/components/tools/item/item-tool.tsx`.
  tool: () => import('./tool'),

  // Stage D — 3D move-tool (registry-driven). Adopts the moving node
  // and runs the placement coordinator with surface strategies for
  // floor / wall / ceiling / item-surface, including attachTo
  // *transitions* (drop a wall item on a ceiling and have it switch).
  // Replaces the legacy `MoveItemContent` in editor's dispatcher; the
  // `getRegistryAffordanceTool('item', 'move')` lookup picks this up.
  affordanceTools: {
    move: () => import('./move-tool'),
  },

  // Stage C: floor-plan polygon. ctx.resolve walks the parent chain
  // (wall / nested item / level) to compute the world-space transform.
  floorplan: buildItemFloorplan,
  // 2D move-on-floorplan handler. Branches on `asset.attachTo`:
  // wall items snap to walls (like door / window), ceiling items
  // snap to ceiling polygons, floor items snap to slabs. attachTo
  // *transitions* (drop a wall item on a ceiling) remain canonical
  // in the 3D path; 2D only re-anchors within the same family.
  floorplanMoveTarget: itemFloorplanMoveTarget,

  toolHints: [
    { key: 'Left click', label: 'Place item' },
    { key: 'R', label: 'Rotate counterclockwise' },
    { key: 'T', label: 'Rotate clockwise' },
    { key: 'Shift', label: 'Free place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Item',
    description: 'A catalog-backed item (furniture, fixtures, decorations).',
    icon: { kind: 'url', src: '/icons/item.png' },
    paletteSection: 'furnish',
    paletteOrder: 10,
  },

  mcp: {
    description:
      'A catalog-backed item with asset reference, transforms, and optional attachTo for wall/ceiling mounting.',
  },
}
