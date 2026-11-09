import { floorPlacedOf } from '../../hooks/spatial-grid/built-in-floor-placed'
import { getFloorPlacedFootprints } from '../../hooks/spatial-grid/floor-placed-footprints'
import { resolveLevelId } from '../../lib/node-ancestry'
import type { AnyNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { floorUnder, isHidden, type SupportCache } from './support'
import type { Prism, PrismKind, Ring, Skipped } from './types'
import type { Nodes } from './walls'

/** The standing kinds read as the box the editor itself keeps them off each other by. */
const BOX_KINDS: Readonly<Record<string, PrismKind>> = {
  cabinet: 'cabinet',
  'cabinet-module': 'cabinet',
  shelf: 'shelf',
  column: 'column',
  block: 'other',
  'hvac-equipment': 'other',
  'procedural-item': 'other',
}

export type NodePrisms = { nodeId: string; levelId: string | null; prisms: Prism[] }

const yawOf = (rotation: unknown): number =>
  typeof rotation === 'number' ? rotation : Array.isArray(rotation) ? (rotation[1] ?? 0) : 0

/**
 * Cabinets, shelves, columns, furniture and the like as the footprint boxes their `floorPlaced`
 * capability declares, on the floor under them. Every one is approximate: a plinth, a handle, a
 * round shaft or a mitred end is not in a box.
 */
export function boxBodies(nodes: Nodes): { nodes: NodePrisms[]; skipped: Skipped[] } {
  const out: NodePrisms[] = []
  const skipped: Skipped[] = []
  const elevations = getLevelElevations(nodes as never)
  const support: SupportCache = new Map()
  for (const node of Object.values(nodes) as AnyNode[]) {
    const kind = BOX_KINDS[node.type]
    if (!kind || isHidden(node, nodes)) continue
    try {
      const config = floorPlacedOf(node.type)
      if (!config || (config.applies && !config.applies(node))) continue
      const footprints = getFloorPlacedFootprints(config, node, { nodes })
      if (footprints.length === 0) continue
      const levelId = resolveLevelId(node, nodes as Record<string, AnyNode>)
      const baseY = elevations.get(levelId)?.baseY ?? 0
      const first = footprints[0]!
      const origin = (node as { position?: [number, number, number] }).position ?? [0, 0, 0]
      const floor = floorUnder(
        node as AnyNode & { supportSlabId?: string },
        {
          position: [first.position?.[0] ?? origin[0], 0, first.position?.[2] ?? origin[2]],
          dimensions: first.dimensions,
          rotation: first.rotation,
        },
        nodes,
        levelId,
        support,
      )
      const prisms: Prism[] = []
      for (const [index, footprint] of footprints.entries()) {
        const [w, h, d] = footprint.dimensions
        if (!(h > 0) || !(w > 0) || !(d > 0)) continue
        const at = footprint.position ?? origin
        const yaw = yawOf(footprint.rotation)
        const cos = Math.cos(yaw)
        const sin = Math.sin(yaw)
        const ring: Ring = (
          [
            [-w / 2, -d / 2],
            [w / 2, -d / 2],
            [w / 2, d / 2],
            [-w / 2, d / 2],
          ] as [number, number][]
        ).map(([x, z]) => [at[0] + x * cos + z * sin, at[2] - x * sin + z * cos])
        const z0 = baseY + floor + at[1]
        prisms.push({
          id: `${node.id}#box${footprints.length > 1 ? `.${index}` : ''}`,
          nodeId: node.id,
          kind,
          z0,
          z1: z0 + h,
          outer: ring,
          holes: [],
          shape: 'approx',
          why: `a ${node.type} as its footprint box`,
        })
      }
      out.push({ nodeId: node.id, levelId, prisms })
    } catch (error) {
      skipped.push({ nodeId: node.id, why: error instanceof Error ? error.message : String(error) })
    }
  }
  return { nodes: out, skipped }
}
