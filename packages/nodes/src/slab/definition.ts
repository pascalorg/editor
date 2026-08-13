import {
  type AnyNode,
  type AnyNodeId,
  type HandleDescriptor,
  MIN_SLAB_THICKNESS,
  markSlabChangeDependents,
  type NodeDefinition,
  pointInPolygon2D,
  type SceneApi,
  type SlabNode as SlabNodeType,
  syncStairRises,
} from '@pascal-app/core'
import {
  clearStructuralElevationGuide,
  publishStructuralElevationGuide,
  resolveStructuralElevationSnap,
} from '@pascal-app/editor'
import { polygonMeasurementFeatures } from '../shared/polygon-measurement'
import {
  applySlabBaseElevationChange,
  applySlabThicknessChange,
  applySlabTopChange,
  getSlabBaseElevation,
  slabElevationUpperBound,
} from './elevation-limit'
import { buildSlabFloorplan } from './floorplan'
import {
  slabAddVertexAffordance,
  slabDeleteVertexAffordance,
  slabMoveEdgeAffordance,
  slabMoveVertexAffordance,
} from './floorplan-affordances'
import { slabFloorplanMoveTarget } from './floorplan-move'
import { buildSlabGeometry } from './geometry'
import { slabPaint } from './paint'
import { slabParametrics } from './parametrics'
import { slabQuantities } from './quantities'
import { slabQuickMeasurement } from './quick-measurement'
import { SlabNode } from './schema'
import { slabSlots } from './slots'

const HEIGHT_HANDLE_OFFSET = 0.22
const MIN_SLAB_ELEVATION = -1

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

function slabElevationGuideSource(slab: SlabNodeType) {
  return {
    nodeId: slab.id,
    levelId: slab.parentId,
    anchor: slabHandleAnchor(slab),
  }
}

function slabChangePreviewOverrides(
  slab: SlabNodeType,
  patch: Partial<SlabNodeType>,
  sceneApi: SceneApi,
): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const next = { ...slab, ...patch } as SlabNodeType
  const nodes = { ...sceneApi.nodes(), [slab.id]: next } as Record<AnyNodeId, AnyNode>
  const previews = new Map<AnyNodeId, Partial<AnyNode>>()

  markSlabChangeDependents(slab, next, nodes, (id) => previews.set(id, {}))
  for (const update of syncStairRises(nodes)) {
    const segment = nodes[update.id]
    if (
      segment?.type !== 'stair-segment' ||
      !segment.parentId ||
      !previews.has(segment.parentId as AnyNodeId)
    ) {
      continue
    }
    previews.set(update.id, update.data)
  }

  return [...previews]
}

function slabRecessedDepthHandle(): HandleDescriptor<SlabNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_SLAB_ELEVATION,
    max: (n, sceneApi) => slabElevationUpperBound(sceneApi.nodes(), n),
    currentValue: (n) => n.elevation ?? 0.05,
    magneticSnap: (n, newValue, sceneApi) =>
      resolveStructuralElevationSnap(slabElevationGuideSource(n), newValue, sceneApi.nodes()),
    onDrag: (n, sceneApi) =>
      publishStructuralElevationGuide(
        slabElevationGuideSource(n),
        n.elevation ?? 0.05,
        sceneApi.nodes(),
      ),
    onDragEnd: (n) => clearStructuralElevationGuide(n.id),
    apply: (n, newValue) => applySlabTopChange(n, newValue),
    previewOverrides: (n, newValue, sceneApi) =>
      slabChangePreviewOverrides(n, applySlabTopChange(n, newValue), sceneApi),
    placement: {
      position: (n) => {
        const [cx, cz] = slabHandleAnchor(n)
        const elevation = n.elevation ?? 0.05
        return [cx, elevation + HEIGHT_HANDLE_OFFSET, cz]
      },
    },
  }
}

function slabThicknessHandle(): HandleDescriptor<SlabNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_SLAB_THICKNESS,
    max: (n, sceneApi) =>
      Math.max(
        MIN_SLAB_THICKNESS,
        slabElevationUpperBound(sceneApi.nodes(), n) - getSlabBaseElevation(n),
      ),
    currentValue: (n) => n.thickness ?? 0.05,
    magneticSnap: (n, newThickness, sceneApi) => {
      const base = getSlabBaseElevation(n)
      const snappedTop = resolveStructuralElevationSnap(
        slabElevationGuideSource(n),
        base + newThickness,
        sceneApi.nodes(),
      )
      return Math.max(MIN_SLAB_THICKNESS, snappedTop - base)
    },
    onDrag: (n, sceneApi) =>
      publishStructuralElevationGuide(
        slabElevationGuideSource(n),
        n.elevation ?? 0.05,
        sceneApi.nodes(),
      ),
    onDragEnd: (n) => clearStructuralElevationGuide(n.id),
    apply: (n, newThickness) => applySlabThicknessChange(n, newThickness),
    previewOverrides: (n, newThickness, sceneApi) =>
      slabChangePreviewOverrides(n, applySlabThicknessChange(n, newThickness), sceneApi),
    placement: {
      position: (n) => {
        const [cx, cz] = slabHandleAnchor(n)
        return [cx, (n.elevation ?? 0.05) + HEIGHT_HANDLE_OFFSET, cz]
      },
    },
  }
}

function slabBaseElevationHandle(): HandleDescriptor<SlabNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    shape: 'tracker',
    gridSnap: true,
    min: (n) => MIN_SLAB_ELEVATION - (n.thickness ?? 0.05),
    max: (n, sceneApi) => slabElevationUpperBound(sceneApi.nodes(), n) - (n.thickness ?? 0.05),
    currentValue: (n) => getSlabBaseElevation(n),
    magneticSnap: (n, newValue, sceneApi) =>
      resolveStructuralElevationSnap(slabElevationGuideSource(n), newValue, sceneApi.nodes()),
    onDrag: (n, sceneApi) =>
      publishStructuralElevationGuide(
        slabElevationGuideSource(n),
        getSlabBaseElevation(n),
        sceneApi.nodes(),
      ),
    onDragEnd: (n) => clearStructuralElevationGuide(n.id),
    apply: (n, newBase) => applySlabBaseElevationChange(n, newBase),
    previewOverrides: (n, newBase, sceneApi) =>
      slabChangePreviewOverrides(n, applySlabBaseElevationChange(n, newBase), sceneApi),
    placement: {
      position: (n) => {
        const [cx, cz] = slabHandleAnchor(n)
        return [cx, getSlabBaseElevation(n), cz]
      },
    },
  }
}

function slabHandles(node: SlabNodeType): HandleDescriptor<SlabNodeType>[] {
  return node.recessed
    ? [slabRecessedDepthHandle()]
    : [slabThicknessHandle(), slabBaseElevationHandle()]
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
  quantities: slabQuantities,
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
    thickness: 0.05,
    recessed: false,
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
  measurement: {
    features: (node) =>
      polygonMeasurementFeatures({
        featurePrefix: 'slab',
        height: node.elevation,
        label: 'Slab',
        polygon: node.polygon,
      }),
    quickMeasure: (node) => slabQuickMeasurement(node),
  },

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
  // Dependency tracker only — dirties level slabs when walls / sibling
  // slabs change, since the renderable polygon derives from level context.
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  // The fill reads walls + sibling slabs via ctx (per-edge render offsets),
  // so committed sibling edits must invalidate the cached floor-plan entry.
  floorplanDependsOnSiblings: true,
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
    'delete-vertex': slabDeleteVertexAffordance,
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
