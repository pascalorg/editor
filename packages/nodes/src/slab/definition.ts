import {
  type HandleDescriptor,
  type NodeDefinition,
  pointInPolygon2D,
  type SlabNode as SlabNodeType,
} from '@pascal-app/core'
import { buildSlabFloorplan } from './floorplan'
import {
  slabAddVertexAffordance,
  slabMoveEdgeAffordance,
  slabMoveVertexAffordance,
} from './floorplan-affordances'
import { slabFloorplanMoveTarget } from './floorplan-move'
import { buildSlabGeometry } from './geometry'
import { slabPaint } from './paint'
import { slabParametrics } from './parametrics'
import { SlabNode } from './schema'
import { slabSlots } from './slots'

const HEIGHT_HANDLE_OFFSET = 0.22
const MIN_SLAB_ELEVATION = 0.02

function polygonVertexAverage(polygon: SlabNodeType['polygon']): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let cx = 0
  let cz = 0
  for (const [x, z] of polygon) {
    cx += x
    cz += z
  }
  return [cx / polygon.length, cz / polygon.length]
}

function pointIsOnSolidSlab(point: [number, number], slab: SlabNodeType) {
  if (!pointInPolygon2D(point, slab.polygon, { includeBoundary: false })) return false
  return !(slab.holes ?? []).some(
    (hole) => hole.length >= 3 && pointInPolygon2D(point, hole, { includeBoundary: true }),
  )
}

function slabHandleAnchor(slab: SlabNodeType): [number, number] {
  const polygon = slab.polygon ?? []
  const fallback = polygonVertexAverage(polygon)
  if (polygon.length < 3) return fallback
  if (pointIsOnSolidSlab(fallback, slab)) return fallback

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  const candidates: [number, number][] = []
  for (const point of polygon) {
    candidates.push([
      fallback[0] + (point[0] - fallback[0]) * 0.35,
      fallback[1] + (point[1] - fallback[1]) * 0.35,
    ])
  }

  const steps = 12
  for (let xi = 1; xi < steps; xi += 1) {
    const x = minX + ((maxX - minX) * xi) / steps
    for (let zi = 1; zi < steps; zi += 1) {
      const z = minZ + ((maxZ - minZ) * zi) / steps
      candidates.push([x, z])
    }
  }

  let best: [number, number] | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (!pointIsOnSolidSlab(candidate, slab)) continue
    const dx = candidate[0] - fallback[0]
    const dz = candidate[1] - fallback[1]
    const distance = dx * dx + dz * dz
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  return best ?? fallback
}

// Slab height arrow — vertical chevron on solid slab surface near the
// polygon center. Drags elevation (the extrusion thickness) with
// `anchor: 'min'` so the bottom stays at world Y=0 and the top follows
// the pointer. Same registry-handle pipeline as the column height arrow,
// so live override + commit-on-release come for free.
function slabHeightHandle(): HandleDescriptor<SlabNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_SLAB_ELEVATION,
    currentValue: (n) => n.elevation ?? 0.05,
    apply: (_n, newValue) => ({ elevation: newValue }),
    placement: {
      position: (n) => {
        const [cx, cz] = slabHandleAnchor(n)
        const elevation = n.elevation ?? 0.05
        return [cx, elevation + HEIGHT_HANDLE_OFFSET, cz]
      },
    },
  }
}

function slabHandles(_node: SlabNodeType): HandleDescriptor<SlabNodeType>[] {
  return [slabHeightHandle()]
}

/**
 * Slab — Phase 5 batch kind, polygon-based. Stage B: `def.geometry`
 * drives the rebuild via generic <GeometrySystem>; <ParametricNodeRenderer>
 * mounts the empty group. No per-kind renderer or system file.
 *
 * Capabilities:
 *  - **No `movable`**: slab's "move" today is whole-slab translation via
 *    legacy `MoveSlabTool`, which integrates with the floor-plan boundary /
 *    hole editors. Capability-driven dispatch keeps the legacy mover.
 *  - **`surfaces.top`**: items host on the slab top at `elevation`.
 *  - `selectable`, `duplicable`, `deletable` standard.
 *
 * Relations:
 *  - `hosts: ['item']` — items mount on the slab top.
 *  - `cascadeDelete: 'descendants'` — deleting a slab removes hosted items.
 */
export const slabDefinition: NodeDefinition<typeof SlabNode> = {
  kind: 'slab',
  snapProfile: 'structural',
  schemaVersion: 1,
  schema: SlabNode,
  category: 'structure',
  surfaceRole: 'floor',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: [],
    holes: [],
    holeMetadata: [],
    elevation: 0.05,
    autoFromWalls: false,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: {
      top: { height: (n) => (n as SlabNode).elevation },
    },
    duplicable: true,
    deletable: true,
    // Unified slot model: one paintable floor surface with a declared default,
    // painted through the registry `capabilities.paint` dispatch like the shelf.
    slots: () => slabSlots(),
    paint: slabPaint,
  },

  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  parametrics: slabParametrics,
  handles: slabHandles,

  // Stage D: kind-owned placement tool. Multi-click polygon drawing
  // with 15° angle snap (Shift to defeat).
  tool: () => import('./tool'),

  // Stage D — all four slab drag-affordances live in this folder.
  // boundary-edit / hole-edit are thin <PolygonEditor> wrappers; move
  // is a 1:1 port of the legacy MoveSlabTool (scene.update per tick
  // with the same history dance, no live-drag exception).
  affordanceTools: {
    'boundary-edit': () => import('./boundary-editor'),
    'hole-edit': () => import('./hole-editor'),
    move: () => import('./move-tool'),
  },

  // Stage B: pure geometry function.
  geometry: buildSlabGeometry,
  // Stage C: floor-plan rendering. Legacy `slabPolygons` short-circuits
  // to [] when slab is registered (see floorplan-panel.tsx).
  floorplan: buildSlabFloorplan,
  // 2D move handler — translates polygon by cursor delta from first
  // pointer position. The 3D `MoveSlabTool` in `affordanceTools.move`
  // skips events sourced from the 2D scene so the two paths don't
  // double-write on commit.
  floorplanMoveTarget: slabFloorplanMoveTarget,
  // Sister to `affordanceTools['boundary-edit']` (the 3D `PolygonEditor`
  // wrapper). The 2D version edits the same `polygon` field via SVG
  // pointer events on the vertex handles emitted by `def.floorplan`.
  floorplanAffordances: {
    'move-vertex': slabMoveVertexAffordance,
    'add-vertex': slabAddVertexAffordance,
    'move-edge': slabMoveEdgeAffordance,
  },

  toolHints: [
    { key: 'Left click', label: 'Trace slab outline' },
    { key: 'Enter', label: 'Finish slab', minDraftVertices: 3 },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Slab',
    description: 'A polygon-bounded floor surface that hosts items on top.',
    icon: { kind: 'url', src: '/icons/floor.webp' },
    paletteSection: 'structure',
    paletteOrder: 30,
  },

  mcp: {
    description: 'A polygon-bounded slab (floor) with optional cutout holes.',
  },
}
