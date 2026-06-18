import type { NodeDefinition } from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { buildShelfFloorplan } from './floorplan'
import { shelfFloorplanMoveTarget } from './floorplan-move'
import { buildShelfGeometry, shelfRowSurfaceYs } from './geometry'
import { shelfParametrics } from './parametrics'
import { ShelfNode } from './schema'

export const shelfDefinition: NodeDefinition<typeof ShelfNode> = {
  kind: 'shelf',
  schemaVersion: 2,
  schema: ShelfNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 2.4,
    depth: 0.8,
    thickness: 0.06,
    height: 2.4,
    style: 'open-rack',
    rows: 4,
    columns: 2,
    withBack: true,
    withSides: false,
    withBottom: false,
    bracketStyle: 'industrial',
    // material / materialPreset left undefined — geometry falls back to
    // `DEFAULT_SHELF_MATERIAL` (off-white), and paint mode writes the
    // chosen catalog material into these fields.
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    // Multi-row hosting: each row's top board exposes a surface so items
    // can stack on whichever row the cursor targets. `surfaces.top`
    // points at the topmost board (legacy compatibility — code that
    // assumes a single surface still works). `surfaces.custom` emits
    // one `SurfacePoint` per row centered on (0, rowY, 0) — the
    // placement coordinator's shelf strategy picks the closest by
    // cursor local-Y and snaps there.
    surfaces: {
      top: { height: (n) => shelfRowSurfaceYs(n as ShelfNode).at(-1) ?? 0 },
      custom: (n) =>
        shelfRowSurfaceYs(n as ShelfNode).map((y) => ({
          position: [0, y, 0] as const,
          normal: [0, 1, 0] as const,
        })),
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Slab elevation lift via the generic `<FloorElevationSystem>` — a
    // shelf sitting over a raised slab visually rests on top of it.
    floorPlaced: {
      footprint: (node) => {
        const shelf = node as ShelfNode
        return {
          dimensions: [shelf.width, shelf.height, shelf.depth] as [number, number, number],
          rotation: shelf.rotation,
        }
      },
    },
  },

  // Items host on shelves the same way they host on slabs / other items —
  // declared here so the placement coordinator's shelf strategy can
  // confirm parent-kind compatibility before reparenting.
  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  parametrics: shelfParametrics,

  materialTargets: overallMaterialTarget,

  // Three-checkbox composition: shelf needs only pure builder functions.
  // The framework's <ParametricNodeRenderer> + <GeometrySystem> handle 3D
  // mount and rebuild on dirty; the <FloorplanRegistryLayer> calls
  // buildShelfFloorplan for the 2D top-down view. No renderer.tsx, no
  // system.tsx, no inline floor-plan SVG — see
  // `wiki/architecture/node-definitions.md`.
  geometry: buildShelfGeometry,
  floorplan: buildShelfFloorplan,
  // 2D move handler — Path 1 in `FloorplanRegistryMoveOverlay`. Without
  // this the overlay falls through to Path 2 which stomps the SVG
  // entry's `transform` attribute (set by the floor-plan layer to
  // position the shelf at `node.position`), producing the "ultra slow,
  // wrong place" symptom the user observed. Path 1 writes live
  // transforms during drag for real-time 3D sync and commits via a
  // single tracked `updateNode`.
  floorplanMoveTarget: shelfFloorplanMoveTarget,

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '放置货架' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: '货架',
    description: '可配置的仓库/工厂货架，支持多层承载物品。',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    paletteSection: 'structure',
    paletteOrder: 24,
  },

  mcp: {
    description:
      'A parametric warehouse shelf/rack. Four styles (wall-shelf / bookshelf / open-rack / cubby) with configurable rows, columns, sides, and back. Items host on each row.',
  },
}
