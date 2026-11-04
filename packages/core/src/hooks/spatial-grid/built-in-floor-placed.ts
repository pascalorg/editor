import type { ProceduralItemNode } from '../../procedural-items/node'
import { proceduralFootprint } from '../../procedural-items/query'
import { nodeRegistry } from '../../registry/registry'
import type { FloorPlacedConfig, FloorPlacedFootprint } from '../../registry/types'
import type {
  AnyNode,
  AnyNodeId,
  BlockNode,
  CabinetModuleNode,
  CabinetNode,
  ColumnNode,
  DuctTerminalNode,
  HvacEquipmentNode,
  ItemNode,
  ShelfNode,
  StairNode,
} from '../../schema'
import { getScaledDimensions } from '../../schema/nodes/item'
import { getStairFloorPlacedFootprints } from '../../systems/stair/stair-floor-footprints'

// How each built-in kind stands on its floor: the `floorPlaced` capability its node definition
// declares (the definitions reference these very objects), kept in core so a host that loads no
// node definitions (the MCP lanes) elects a node's support exactly as the editor does.

type Nodes = Readonly<Record<AnyNodeId, AnyNode>>
type Vec3 = [number, number, number]

const yaw = (rotation: number): Vec3 => [0, rotation, 0]

const ROUND_CROSS_SECTIONS = new Set<ColumnNode['crossSection']>([
  'round',
  'octagonal',
  'sixteen-sided',
])

/** A column's plan half-extents: its shaft, or its widest brace. */
export function columnFootprintHalf(n: ColumnNode): { halfX: number; halfZ: number } {
  if (n.source) return { halfX: n.width / 2, halfZ: n.depth / 2 }
  if (n.supportStyle === 'vertical') {
    if (ROUND_CROSS_SECTIONS.has(n.crossSection)) return { halfX: n.radius, halfZ: n.radius }
    if (n.crossSection === 'square') return { halfX: n.width / 2, halfZ: n.width / 2 }
    return { halfX: n.width / 2, halfZ: n.depth / 2 }
  }
  return {
    halfX:
      Math.max(n.width, n.braceWidth ?? 0, n.braceBottomSpread ?? 0, n.braceTopSpread ?? 0) / 2,
    halfZ: Math.max(n.depth, n.braceDepth ?? 0) / 2,
  }
}

/** A block's local bounds from its topology. */
export function blockBounds(node: BlockNode): { size: Vec3; center: Vec3 } {
  const positions = node.topology.vertices.map((vertex) => vertex.position)
  if (positions.length === 0) return { size: [0, 0, 0], center: [0, 0, 0] }
  const min = [0, 1, 2].map((axis) => Math.min(...positions.map((p) => p[axis] ?? 0)))
  const max = [0, 1, 2].map((axis) => Math.max(...positions.map((p) => p[axis] ?? 0)))
  return {
    size: [0, 1, 2].map((axis) => (max[axis] ?? 0) - (min[axis] ?? 0)) as Vec3,
    center: [0, 1, 2].map((axis) => ((min[axis] ?? 0) + (max[axis] ?? 0)) / 2) as Vec3,
  }
}

const BLOCK_ON_FLOOR_MAX_BOTTOM = 0.1
const BLOCK_ON_FLOOR_MIN_TOP = 0.01

/**
 * Floor collision is for blocks standing on the floor. Soffits, vaults, gutters and mantels hang
 * above floor placements, and foundation pads sit under the floor, so neither blocks furniture
 * nor gets refused when moved.
 */
export function blockRestsOnFloor(node: BlockNode): boolean {
  const { size, center } = blockBounds(node)
  const bottom = node.position[1] + center[1] - size[1] / 2
  const top = node.position[1] + center[1] + size[1] / 2
  return bottom <= BLOCK_ON_FLOOR_MAX_BOTTOM && top > BLOCK_ON_FLOOR_MIN_TOP
}

function blockFootprintPosition(node: BlockNode, center: Vec3): Vec3 {
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  return [
    node.position[0] + center[0] * cos + center[2] * sin,
    node.position[1],
    node.position[2] - center[0] * sin + center[2] * cos,
  ]
}

function clampShelfDim(value: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(Math.max(v, lo), hi)
}

/** A shelf with every dimension held inside the range the shelf tool allows. */
export function sanitizeShelfDimensions(node: ShelfNode): ShelfNode {
  return {
    ...node,
    width: clampShelfDim(node.width, 0.3, 3.0, 1.2),
    depth: clampShelfDim(node.depth, 0.1, 1.0, 0.3),
    thickness: clampShelfDim(node.thickness, 0.01, 0.1, 0.04),
    height: clampShelfDim(node.height, 0.05, 2.5, 0.9),
    rows: Math.round(clampShelfDim(node.rows, 1, 8, 1)),
    columns: Math.round(clampShelfDim(node.columns, 1, 6, 1)),
  }
}

type CabinetHeightFields = Pick<
  CabinetNode,
  'showPlinth' | 'plinthHeight' | 'carcassHeight' | 'withCountertop' | 'countertopThickness'
>

/** A cabinet's height from the floor: plinth, carcass and countertop. */
export function totalCabinetHeight(node: CabinetHeightFields) {
  return (
    (node.showPlinth ? node.plinthHeight : 0) +
    node.carcassHeight +
    (node.withCountertop ? node.countertopThickness : 0)
  )
}

/** A module's height, with a top cabinet or trim above it. */
export function cabinetModuleTotalHeight(node: CabinetModuleNode): number {
  return (
    totalCabinetHeight(node) +
    (node.topFinish === 'top-cabinet' || node.topFinish === 'trim' ? node.topFinishHeight : 0)
  )
}

/** A cabinet nested in another stands on that one, not on the floor. */
export function hasCabinetParentId(node: Pick<CabinetNode, 'parentId'>): boolean {
  const parentId = node.parentId
  return (
    typeof parentId === 'string' &&
    (parentId.startsWith('cabinet_') || parentId.startsWith('cabinet-module_'))
  )
}

function composedPose(parent: Vec3, parentYaw: number, child: readonly number[]): Vec3 {
  const cos = Math.cos(parentYaw)
  const sin = Math.sin(parentYaw)
  const [x = 0, y = 0, z = 0] = child
  return [parent[0] + x * cos + z * sin, parent[1] + y, parent[2] - x * sin + z * cos]
}

function appendCabinetFootprints(
  run: CabinetNode,
  nodes: Nodes,
  parentPosition: Vec3,
  parentYaw: number,
  footprints: FloorPlacedFootprint[],
) {
  const runPosition = composedPose(parentPosition, parentYaw, run.position)
  const runYaw = parentYaw + run.rotation
  const children = (run.children ?? []).map((id) => nodes[id as AnyNodeId])
  const modules = children.filter(
    (child): child is CabinetModuleNode => child?.type === 'cabinet-module',
  )
  for (const module of modules)
    footprints.push({
      position: composedPose(runPosition, runYaw, module.position),
      dimensions: [module.width, cabinetModuleTotalHeight(module), module.depth],
      rotation: yaw(runYaw + module.rotation),
    })
  if (!modules.length)
    footprints.push({
      position: runPosition,
      dimensions: [run.width, totalCabinetHeight(run), run.depth],
      rotation: yaw(runYaw),
    })
  for (const child of children)
    if (child?.type === 'cabinet')
      appendCabinetFootprints(child, nodes, runPosition, runYaw, footprints)
}

/** A cabinet run's footprints: one per module, through any runs nested in it. */
export function cabinetFloorPlacedFootprints(
  node: CabinetNode,
  nodes?: Nodes,
): FloorPlacedFootprint[] {
  if (!nodes)
    return [
      {
        position: [...node.position],
        dimensions: [node.width, totalCabinetHeight(node), node.depth],
        rotation: yaw(node.rotation),
      },
    ]
  const footprints: FloorPlacedFootprint[] = []
  appendCabinetFootprints(node, nodes, [0, 0, 0], 0, footprints)
  return footprints
}

type BuiltInFloorPlacedKind =
  | 'item'
  | 'column'
  | 'block'
  | 'shelf'
  | 'stair'
  | 'spawn'
  | 'duct-terminal'
  | 'hvac-equipment'
  | 'procedural-item'
  | 'cabinet'
  | 'cabinet-module'

export const BUILT_IN_FLOOR_PLACED: Readonly<Record<BuiltInFloorPlacedKind, FloorPlacedConfig>> = {
  item: {
    footprint: (node) => {
      const item = node as ItemNode
      return { dimensions: getScaledDimensions(item), rotation: item.rotation }
    },
    applies: (node) => !(node as ItemNode).asset.attachTo,
    collides: true,
  },
  column: {
    footprint: (node) => {
      const column = node as ColumnNode
      const { halfX, halfZ } = columnFootprintHalf(column)
      // Column stores Y rotation as a scalar; the slab-overlap query expects the full Euler tuple.
      return { dimensions: [halfX * 2, column.height, halfZ * 2], rotation: yaw(column.rotation) }
    },
    collides: true,
  },
  block: {
    footprint: (node) => {
      const block = node as BlockNode
      const { size, center } = blockBounds(block)
      return {
        dimensions: size,
        position: blockFootprintPosition(block, center),
        rotation: yaw(block.rotation),
      }
    },
    collides: (node) => blockRestsOnFloor(node as BlockNode),
  },
  shelf: {
    footprint: (node) => {
      const shelf = sanitizeShelfDimensions(node as ShelfNode)
      return { dimensions: [shelf.width, shelf.height, shelf.depth], rotation: shelf.rotation }
    },
    collides: true,
  },
  stair: {
    footprints: (node, ctx) =>
      ctx ? getStairFloorPlacedFootprints(node as StairNode, ctx.nodes) : [],
  },
  spawn: {
    footprint: () => ({ dimensions: [0.6, 1.8, 0.6], rotation: [0, 0, 0] }),
  },
  'duct-terminal': {
    footprint: (node) => {
      const terminal = node as DuctTerminalNode
      return { dimensions: [terminal.width, 0, terminal.depth], rotation: yaw(terminal.rotation) }
    },
    applies: (node) => (node as DuctTerminalNode).mount === 'floor',
  },
  'hvac-equipment': {
    footprint: (node) => {
      const unit = node as HvacEquipmentNode
      return { dimensions: [unit.width, unit.height, unit.depth], rotation: yaw(unit.rotation) }
    },
  },
  'procedural-item': {
    footprint: (node) => proceduralFootprint(node as unknown as ProceduralItemNode),
    applies: (node) => !(node as unknown as ProceduralItemNode).recipe.mounting,
    collides: true,
  },
  cabinet: {
    applies: (node) => !hasCabinetParentId(node as CabinetNode),
    footprints: (node, ctx) => cabinetFloorPlacedFootprints(node as CabinetNode, ctx?.nodes),
    collides: true,
  },
  'cabinet-module': {
    applies: (node) => !hasCabinetParentId(node as CabinetModuleNode),
    footprint: (node) => {
      const module = node as CabinetModuleNode
      return {
        dimensions: [module.width, cabinetModuleTotalHeight(module), module.depth],
        rotation: yaw(module.rotation),
      }
    },
    collides: true,
  },
}

/**
 * A kind's `floorPlaced` capability: the one its loaded definition declares, else the built-in
 * kind's, so support is elected the same with or without node definitions.
 */
export function floorPlacedOf(type: string): FloorPlacedConfig | undefined {
  return (
    nodeRegistry.get(type)?.capabilities?.floorPlaced ??
    (BUILT_IN_FLOOR_PLACED as Readonly<Record<string, FloorPlacedConfig | undefined>>)[type]
  )
}
