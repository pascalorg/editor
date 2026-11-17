import type { AnyNode, AnyNodeId, SlabNode } from '../schema'
import { getLevelElevations } from '../services/storey'
import { surfaceHeightAt, type TerrainField } from './terrain-field'
import { persistedTerrainFieldOf, terrainFieldOf } from './terrain-source'

export type SlabTerrainFrame = {
  field: TerrainField | null
  baseY: number
  toSite: (x: number, z: number) => [number, number]
}

export function slabTerrainFrameOf(
  slab: SlabNode,
  nodes: Readonly<Record<string, AnyNode>>,
  source: 'persisted' | 'live' = 'persisted',
): SlabTerrainFrame | null {
  if (
    slab.terrainMode !== 'draped' ||
    slab.plateRole ||
    slab.boundary === 'auto' ||
    slab.autoFromWalls ||
    slab.recessed
  )
    return null
  const level = slab.parentId ? nodes[slab.parentId] : undefined
  const building = level?.parentId ? nodes[level.parentId] : undefined
  const site = building?.parentId ? nodes[building.parentId] : undefined
  if (level?.type !== 'level' || building?.type !== 'building' || site?.type !== 'site') return null
  if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9) return null
  const angle = building.rotation[1]
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const baseY =
    building.position[1] +
    (getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(level.id)?.baseY ?? 0)
  return {
    field: source === 'live' ? terrainFieldOf(site, nodes) : persistedTerrainFieldOf(site, nodes),
    baseY,
    toSite: (x, z) => [
      cosine * x + sine * z + building.position[0],
      -sine * x + cosine * z + building.position[2],
    ],
  }
}

export function slabTerrainHeightAt(
  slab: SlabNode,
  nodes: Readonly<Record<string, AnyNode>>,
  x: number,
  z: number,
  source: 'persisted' | 'live' = 'persisted',
): number {
  const frame = slabTerrainFrameOf(slab, nodes, source)
  if (!frame) return slab.elevation
  const [siteX, siteZ] = frame.toSite(x, z)
  return (
    (frame.field ? surfaceHeightAt(frame.field, siteX, siteZ) : 0) - frame.baseY + slab.elevation
  )
}
