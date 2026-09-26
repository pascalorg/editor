import { nodeRegistry } from '../registry/registry'
import type { FloorPlacedConfig } from '../registry/types'
import { type BlockNode, blockBounds } from '../schema/nodes/block'
import { type ColumnNode, columnFootprintHalf } from '../schema/nodes/column'
import type { DuctTerminalNode } from '../schema/nodes/duct-terminal'
import type { HvacEquipmentNode } from '../schema/nodes/hvac-equipment'
import type { StairNode } from '../schema/nodes/stair'
import { getStairFloorPlacedFootprints } from '../systems/stair/stair-floor-stack'

/**
 * `floorPlaced` capabilities of the built-in kinds whose footprint is not an
 * item-like box. The built-in definitions register these same objects, and
 * headless runtimes that never load the built-in plugin (MCP, hosted scene
 * API, bench) read them through `floorPlacedConfig`, so a floor lift there
 * matches the viewer.
 */
export const columnFloorPlaced: FloorPlacedConfig = {
  footprint: (node) => {
    const column = node as ColumnNode
    const { halfX, halfZ } = columnFootprintHalf(column)
    return {
      dimensions: [halfX * 2, column.height, halfZ * 2],
      // Column stores Y rotation as a scalar; the slab-overlap query
      // expects the full Euler tuple.
      rotation: [0, column.rotation, 0],
    }
  },
  collides: true,
}

export const blockFloorPlaced: FloorPlacedConfig = {
  footprint: (rawNode) => {
    const node = rawNode as BlockNode
    const { size, center } = blockBounds(node)
    const cos = Math.cos(node.rotation)
    const sin = Math.sin(node.rotation)
    return {
      dimensions: size,
      position: [
        node.position[0] + center[0] * cos + center[2] * sin,
        node.position[1],
        node.position[2] - center[0] * sin + center[2] * cos,
      ],
      rotation: [0, node.rotation, 0],
    }
  },
  collides: true,
}

export const spawnFloorPlaced: FloorPlacedConfig = {
  footprint: () => ({ dimensions: [0.6, 1.8, 0.6], rotation: [0, 0, 0] }),
}

export const hvacEquipmentFloorPlaced: FloorPlacedConfig = {
  footprint: (node) => {
    const n = node as HvacEquipmentNode
    return { dimensions: [n.width, n.height, n.depth], rotation: [0, n.rotation, 0] }
  },
}

export const ductTerminalFloorPlaced: FloorPlacedConfig = {
  footprint: (node) => {
    const t = node as DuctTerminalNode
    return { dimensions: [t.width, 0, t.depth], rotation: [0, t.rotation, 0] }
  },
  applies: (node) => (node as DuctTerminalNode).mount === 'floor',
}

export const stairFloorPlaced: FloorPlacedConfig = {
  footprints: (node, ctx) =>
    ctx ? getStairFloorPlacedFootprints(node as StairNode, ctx.nodes) : [],
}

const BUILTIN_FLOOR_PLACED: Readonly<Record<string, FloorPlacedConfig>> = {
  block: blockFloorPlaced,
  column: columnFloorPlaced,
  'duct-terminal': ductTerminalFloorPlaced,
  'hvac-equipment': hvacEquipmentFloorPlaced,
  spawn: spawnFloorPlaced,
  stair: stairFloorPlaced,
}

/**
 * A kind's `floorPlaced` capability: the registered definition's when the
 * kind is registered, otherwise the built-in one above.
 */
export function floorPlacedConfig(kind: string): FloorPlacedConfig | undefined {
  const definition = nodeRegistry.get(kind)
  return definition ? definition.capabilities.floorPlaced : BUILTIN_FLOOR_PLACED[kind]
}
