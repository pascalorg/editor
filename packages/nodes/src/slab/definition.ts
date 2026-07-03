import {
  type HandleDescriptor,
  type NodeDefinition,
  pointInPolygon2D,
  type SlabNode as SlabNodeType,
} from '@pascal-app/core'
import { overallMaterialTarget } from '../shared/material-targets'
import { buildSlabFloorplan } from './floorplan'
import {
  slabAddVertexAffordance,
  slabMoveEdgeAffordance,
  slabMoveVertexAffordance,
} from './floorplan-affordances'
import { slabFloorplanMoveTarget } from './floorplan-move'
import { buildSlabGeometry } from './geometry'
import { slabParametrics } from './parametrics'
import { SlabNode } from './schema'

const SLAB_HEIGHT_HANDLE_OFFSET = 0.24
const SLAB_HANDLE_SAMPLE_COUNT = 9

function isSolidSlabPoint(point: [number, number], slab: SlabNodeType): boolean {
  return (
    pointInPolygon2D(point, slab.polygon, { includeBoundary: false }) &&
    !slab.holes.some((hole) => pointInPolygon2D(point, hole, { includeBoundary: true }))
  )
}

function averagePoint(points: readonly (readonly [number, number])[]): [number, number] {
  let totalX = 0
  let totalZ = 0
  for (const point of points) {
    totalX += point[0]
    totalZ += point[1]
  }
  return [totalX / points.length, totalZ / points.length]
}

function slabHeightHandlePoint(slab: SlabNodeType): [number, number] {
  if (slab.polygon.length === 0) return [0, 0]

  const center = averagePoint(slab.polygon)
  if (isSolidSlabPoint(center, slab)) return center

  const xs = slab.polygon.map((point) => point[0])
  const zs = slab.polygon.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const spanX = maxX - minX
  const spanZ = maxZ - minZ

  let bestPoint: [number, number] | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let ix = 1; ix < SLAB_HANDLE_SAMPLE_COUNT; ix += 1) {
    for (let iz = 1; iz < SLAB_HANDLE_SAMPLE_COUNT; iz += 1) {
      const candidate: [number, number] = [
        minX + (spanX * ix) / SLAB_HANDLE_SAMPLE_COUNT,
        minZ + (spanZ * iz) / SLAB_HANDLE_SAMPLE_COUNT,
      ]
      if (!isSolidSlabPoint(candidate, slab)) continue
      const distance = Math.hypot(candidate[0] - center[0], candidate[1] - center[1])
      if (distance < bestDistance) {
        bestDistance = distance
        bestPoint = candidate
      }
    }
  }

  return bestPoint ?? center
}

const slabHandles: HandleDescriptor<SlabNodeType>[] = [
  {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: 0,
    currentValue: (node) => node.elevation,
    apply: (_node, newValue) => ({ elevation: newValue }),
    placement: {
      position: (node) => {
        const [x, z] = slabHeightHandlePoint(node)
        return [x, node.elevation + SLAB_HEIGHT_HANDLE_OFFSET, z]
      },
    },
  },
]

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
  schemaVersion: 1,
  schema: SlabNode,
  category: 'structure',

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
    sceneSelection: {
      role: 'zone-content',
      zoneFootprint: 'polygon',
      hover: false,
      outline: false,
    },
    surfaces: {
      top: { height: (n) => (n as SlabNode).elevation },
    },
    duplicable: true,
    deletable: true,
  },

  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },

  parametrics: slabParametrics,
  handles: slabHandles,

  materialTargets: overallMaterialTarget,

  // Stage D: kind-owned placement tool. Multi-click polygon drawing
  // with axis/45° snap (Shift to defeat).
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
    { key: 'Left click', label: '添加楼板顶点' },
    { key: 'Enter', label: '完成楼板' },
    { key: 'Esc', label: '取消' },
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
