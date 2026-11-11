import {
  ElevatorNode as ElevatorNodeSchema,
  type ElevatorNode as ElevatorNodeType,
  elevatorSlots,
  getElevatorCabDepth,
  getElevatorCabWidth,
  getElevatorShaftDepth,
  getElevatorShaftWallThickness,
  getElevatorShaftWidth,
  resolveElevatorDimensions,
  resolveElevatorLevels,
  resolveElevatorNodeSupportY,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildElevatorFloorplan } from './floorplan'
import { ElevatorNode } from './schema'

export function elevatorOuterHalfExtents(n: ElevatorNodeType): { halfX: number; halfZ: number } {
  const cabWidth = getElevatorCabWidth(n)
  const cabDepth = getElevatorCabDepth(n)
  const wallThickness = getElevatorShaftWallThickness(n)
  return {
    halfX: getElevatorShaftWidth(n, cabWidth) / 2 + wallThickness,
    halfZ: getElevatorShaftDepth(n, cabDepth) / 2 + wallThickness,
  }
}

export const elevatorRenderDefinition: NodeRenderDefinition<typeof ElevatorNode> & {
  kind: 'elevator'
} = {
  kind: 'elevator',
  schemaVersion: 1,
  schema: ElevatorNode,
  category: 'structure',
  surfaceRole: 'joinery',
  defaults: () => {
    const stub = ElevatorNodeSchema.parse({ id: 'elevator_default' as never, type: 'elevator' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    surfacePlacement: 'floor-only',
    selectable: { hitVolume: 'bbox' },
    // Generic XZ translate so the floating action menu's Move button
    // (and the side move-arrows emitted from `def.floorplan`) drive the
    // 2D body-move flow through `FloorplanRegistryMoveOverlay`'s
    // Path 2 — position[0] / position[2] update with a 0.5m grid snap.
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      resolvePosition: ({ node, position, nodes }) => [
        position[0],
        resolveElevatorNodeSupportY(node as ElevatorNodeType, position, nodes),
        position[2],
      ],
    },
    // Align by the OUTER SHAFT (shaft + wall — what's drawn in plan and 3D),
    // not the cab `width × depth`: the cab is inset by the shaft wall +
    // clearance, so cab corners sit ~9 cm inside the visible edge — past the
    // 8 cm snap, which is why the elevator never surfaced a guide. A `box`
    // shape (not `aabb`) because the elevator is `movable`, so the anchor
    // bridge relocates this same footprint to the drag point.
    alignmentFootprint: (node) => {
      const e = node as ElevatorNodeType
      const { halfX, halfZ } = elevatorOuterHalfExtents(e)
      return {
        shape: 'box',
        dimensions: [halfX * 2, 1, halfZ * 2],
        rotation: [0, e.rotation ?? 0, 0],
      }
    },
    // Drag box wraps just the OUTER SHAFT × full shaft height — same footprint
    // alignment uses, same height the rendered shell occupies. Without this
    // override, `DragBoundingBox` would measure the whole mesh tree (per-level
    // landing assemblies, cab interior, buttons) and the box would feel
    // vertically off-centre when the elevator's lowest served level isn't the
    // building origin.
    dragBounds: (node, nodes) => {
      const e = node as ElevatorNodeType
      const { halfX, halfZ } = elevatorOuterHalfExtents(e)
      const { shaftBaseY, totalHeight } = resolveElevatorLevels(e, nodes ?? {})
      const cabHeight = resolveElevatorDimensions(e).cabHeight
      const shaftHeight = Math.max(totalHeight, cabHeight + 0.3)
      return {
        size: [halfX * 2, shaftHeight, halfZ * 2],
        centerY: shaftBaseY + shaftHeight / 2,
      }
    },
    duplicable: true,
    deletable: true,
    slots: (node) => elevatorSlots(node as ElevatorNodeType),
  },
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  floorplan: buildElevatorFloorplan,
  // Elevators are parented to the building (siblings of levels), so the
  // floor-plan layer's level-rooted DFS never reaches them. Declaring
  // `floorplanScope: 'building'` tells `FloorplanRegistryLayer` to walk
  // building-scoped kinds separately and synthesise `ctx.parent` as the
  // active level — that's what `buildElevatorFloorplan` reads via
  // `ctx.parent?.id` to decide whether this floor is in the elevator's
  // service range.
  floorplanScope: 'building',
  presentation: {
    label: 'Elevator',
    description: 'A multi-level elevator shaft with configurable openings per level.',
    icon: { kind: 'url', src: '/icons/elevator.webp' },
    paletteSection: 'structure',
    paletteOrder: 80,
  },
  mcp: {
    description: 'A multi-level elevator with shaft + openings per level.',
  },
}
