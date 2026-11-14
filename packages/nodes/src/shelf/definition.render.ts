import { shelfSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { staticBatchable } from '../shared/node-batch/batchable'
import { sanitizeShelfDimensions } from './dimensions'
import { buildShelfFloorplan } from './floorplan'
import { buildShelfGeometry, shelfRowSurfaceYs } from './geometry'
import { ShelfNode } from './schema'

export const shelfRenderDefinition: NodeRenderDefinition<typeof ShelfNode> & { kind: 'shelf' } = {
  kind: 'shelf',
  schemaVersion: 2,
  schema: ShelfNode,
  category: 'furnish',
  surfaceRole: 'joinery',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 1,
    depth: 0.5,
    thickness: 0.05,
    height: 1.8,
    style: 'cubby',
    rows: 3,
    columns: 2,
    withBack: true,
    withSides: true,
    withBottom: true,
    bracketStyle: 'minimal',
    // material / materialPreset left undefined — geometry falls back to
    // the per-slot off-white default, and slot paint mode writes chosen
    // catalog materials into `slots`.
  }),
  capabilities: {
    batchable: staticBatchable,
    reveal: { phase: 'furnishing', style: 'drop', height: 0.3 },
    revealOnEdit: ['width', 'depth', 'height', 'thickness', 'rows', 'columns', 'style'],
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
    duplicable: { subtree: 'with-children' },
    deletable: true,
    slots: (n) => shelfSlots(n as ShelfNode),
    // Slab elevation lift via the generic `<FloorElevationSystem>` — a
    // shelf sitting over a raised slab visually rests on top of it.
    floorPlaced: {
      footprint: (node) => {
        const shelf = sanitizeShelfDimensions(node as ShelfNode)
        return {
          dimensions: [shelf.width, shelf.height, shelf.depth] as [number, number, number],
          rotation: shelf.rotation,
        }
      },
      collides: true,
    },
  },
  // Items host on shelves the same way they host on slabs / other items —
  // declared here so the placement coordinator's shelf strategy can
  // confirm parent-kind compatibility before reparenting.
  relations: {
    hosts: ['item', 'procedural-item'],
    cascadeDelete: 'descendants',
  },
  // Three-checkbox composition: shelf needs only pure builder functions.
  // The framework's <ParametricNodeRenderer> + <GeometrySystem> handle 3D
  // mount and rebuild on dirty; the <FloorplanRegistryLayer> calls
  // buildShelfFloorplan for the 2D top-down view. No renderer.tsx, no
  // system.tsx, no inline floor-plan SVG — see
  // `wiki/architecture/node-definitions.md`.
  geometry: buildShelfGeometry,
  // Boards/posts/back depend only on these fields — never on hosted
  // `children`. Lets <GeometrySystem> skip the dispose+rebuild (and the
  // pointer enter/leave churn it causes) when an item reparents onto a row.
  geometryChildTypes: [],
  geometryKey: (n) => {
    const s = sanitizeShelfDimensions(n as ShelfNode)
    return JSON.stringify([
      s.style,
      s.width,
      s.depth,
      s.thickness,
      s.height,
      s.rows,
      s.columns,
      s.withBack,
      s.withSides,
      s.withBottom,
      s.bracketStyle,
      s.material,
      s.materialPreset,
      JSON.stringify(s.slots ?? null),
    ])
  },
  floorplan: buildShelfFloorplan,
  presentation: {
    label: 'Shelf',
    description: 'A configurable shelving unit. Items host on each row.',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    paletteSection: 'furnish',
    paletteOrder: 30,
  },
  mcp: {
    description:
      'A parametric shelving unit. Four styles (wall-shelf / bookshelf / open-rack / cubby) with configurable rows, columns, sides, and back. Items host on each row.',
  },
}
