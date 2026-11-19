import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, AnyNodeId, BuildingNode, SlabNode, WallNode } from '../schema'
import { levelPlaneWorldY } from '../services/storey'
import { pointInPolygon, pointOnPolygonBoundary } from '../systems/slab/slab-support'
import { levelFrame } from './building-footprint'
import { liftedManualSlab } from './floor-construction-lift'
import { groundLevelOf } from './ground-level'
import { withHostedCutterHoles } from './object-cuts'
import { FLAT_GROUND_Y } from './site-ground-height'
import { getRenderableSlabPolygon } from './slab-polygon'
import { heightAt } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

/** Ground in Site metres, independent of the scene representation supplying it. */
export type GroundRead = {
  heightAt: (x: number, z: number) => number
  /** Different regions have a vertical ground face between them. */
  regionAt?: (x: number, z: number) => string
}

/** Flat ground at the datum, also usable without a scene. */
export const FLAT_GROUND: GroundRead = { heightAt: () => 0 }

/** Adapt a ground source without coupling generators to its storage or terrain implementation. */
export function groundReadOf(source: GroundRead | null): GroundRead {
  return source ?? FLAT_GROUND
}

/** Committed inputs to Site terrain, slab outlines/cuts and storey/construction elevations. */
export const SITE_GROUND_DEPENDENCY_TYPES = [
  'site',
  'building',
  'level',
  'slab',
  'wall',
  'separator',
  'zone',
  'item',
  'ceiling',
] as const

type Nodes = Readonly<Record<string, AnyNode>>
type Support = {
  slab: SlabNode
  top: number
  toLocal: (x: number, z: number) => readonly [number, number]
}

/** Main's rendered slab outline, openings and top, from committed data in its parent frame. */
export function resolveGroundSlab(node: SlabNode, nodes: Nodes): SlabNode {
  const slab = liftedManualSlab(nodes, withHostedCutterHoles(node, nodes))
  const parentId = node.parentId
  const polygon = getRenderableSlabPolygon(slab, {
    walls: queryNodes<WallNode>(nodes, { type: 'wall', parentId }),
    siblingSlabs: queryNodes<SlabNode>(nodes, { type: 'slab', parentId }).filter(
      (sibling) => sibling.id !== node.id,
    ),
  })
  return { ...slab, polygon }
}

/**
 * Main's persisted Site ground plus ground-storey slabs, never upper floors or roofs.
 * The flat fallback matches the Site renderer; an existing single-grid terrain keeps its shape.
 * A future terrain source only needs to supply GroundRead, not change either generator.
 */
export function resolveSiteGround(siteId: string | null | undefined, nodes: Nodes): GroundRead {
  const site = siteId ? nodes[siteId] : undefined
  if (site?.type !== 'site') return FLAT_GROUND
  const field = persistedTerrainFieldOf(site)
  const terrain: GroundRead = {
    heightAt: field ? (x, z) => heightAt(field, x, z) : () => FLAT_GROUND_Y,
  }
  const supports: Support[] = []
  const addSlabs = (parentId: string, building: BuildingNode | null, base: number) => {
    const toLocal = levelFrame(building)
    for (const node of queryNodes(nodes, { type: 'slab', parentId })) {
      if (node.type !== 'slab' || node.recessed || node.polygon.length < 3) continue
      const slab = resolveGroundSlab(node, nodes)
      const top = base + slab.elevation
      if (Number.isFinite(top)) supports.push({ slab, top, toLocal })
    }
  }
  addSlabs(site.id, null, 0)
  const scene = nodes as Record<AnyNodeId, AnyNode>
  for (const building of queryNodes(nodes, { type: 'building', parentId: site.id })) {
    if (building.type !== 'building') continue
    // Main's level plan frame is translation + yaw; a tipped building has no horizontal slab top.
    if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9) continue
    const ground = groundLevelOf(scene, building.id)?.level
    if (!ground) continue
    const base = levelPlaneWorldY(scene, ground.id)
    if (base !== null) addSlabs(ground.id, building, base)
  }
  if (!supports.length) return terrain
  supports.sort((a, b) => b.top - a.top || a.slab.id.localeCompare(b.slab.id))
  const contains = (ring: [number, number][], x: number, z: number) =>
    pointInPolygon(x, z, ring) || pointOnPolygonBoundary(x, z, ring)
  const supportAt = (x: number, z: number, floor: number) =>
    supports.find(({ slab, top, toLocal }) => {
      if (top <= floor) return false
      const [localX, localZ] = toLocal(x, z)
      return (
        contains(slab.polygon, localX, localZ) &&
        !slab.holes.some((hole) => contains(hole, localX, localZ))
      )
    })
  return {
    heightAt: (x, z) => {
      const floor = terrain.heightAt(x, z)
      return supportAt(x, z, floor)?.top ?? floor
    },
    // Coplanar adjacent slabs form one region; a hole falls back to the Site region.
    regionAt: (x, z) => {
      const support = supportAt(x, z, terrain.heightAt(x, z))
      return support ? `slab:${support.top}` : 'site'
    },
  }
}
