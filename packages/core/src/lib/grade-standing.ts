import type { AnyNode, AnyNodeId, BuildingNode, LevelNode, SlabNode } from '../schema'
import {
  BELOW_GRADE_TOLERANCE,
  getLevelElevations,
  isLevelBelowGrade,
  levelPlaneWorldY,
} from '../services/storey'
import { pointInPolygon } from '../systems/slab/slab-support'
import { levelUnderNamedGround } from './ground-level'
import { isSiteFlatwork } from './site-flatwork'
import { heightAt, type TerrainField } from './terrain-field'
import { terrainFieldOf } from './terrain-source'
import { levelLocalToWorldXZ, SITE_DATUM_Y } from './terrain-support-query'

/**
 * Where a level stands against the ground as it actually lies: at grade, below it everywhere,
 * or below it on part of its footprint — a hillside can bury half a floor whose other half
 * walks out. `isLevelBelowGrade` alone only knows the flat datum, so a street raised 6 m over
 * a garden level left every floor "at grade" and the ground never veiled.
 */
export type LevelGradeStanding = 'at-grade' | 'partly-below-grade' | 'below-grade'

/** Sample lines per footprint side at most: enough to catch a slope crossing a floor plate. */
const MAX_SAMPLE_LINES = 17

/**
 * `levelId`'s standing against the ground. When its building names a ground level, the line is the
 * word: a level under it is below grade, and one at or over it is not buried by the stack's own
 * elevations (a basement added under a house, a floor the stack lifted). Where the sculpted terrain
 * stands over a floor's slabs (sampled against the field, the ground over each slab's own floor
 * where it stands more than {@link BELOW_GRADE_TOLERANCE} above it: a split level's sunken room is
 * judged at its own height, not at the raised part's) it still decides how much of that floor is
 * buried: a hillside buries half a floor whose other half walks out, and a floor under the line the
 * terrain leaves out of the ground reads as partly below. Without a named ground level, or a field,
 * the flat datum answers exactly as before. `'at-grade'` for an id that is no level.
 */
export function levelGradeStanding(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): LevelGradeStanding {
  const level = nodes[levelId as LevelNode['id']]
  if (level?.type !== 'level') return 'at-grade'
  const under = levelUnderNamedGround(nodes, level)
  const flat: LevelGradeStanding =
    under === null
      ? isLevelBelowGrade(nodes, levelId)
        ? 'below-grade'
        : 'at-grade'
      : under
        ? 'below-grade'
        : 'at-grade'
  const field = terrainFieldOverLevel(nodes, level)
  if (!field) return under === null ? flatFloorsStanding(nodes, level, flat) : flat

  const samples = footprintFloorSamples(nodes, level, field)
  if (samples.length === 0) return flat
  let buried = 0
  for (const [worldX, worldZ, floorY] of samples) {
    if (heightAt(field, worldX, worldZ) - floorY > BELOW_GRADE_TOLERANCE) buried += 1
  }
  if (buried === 0) return under ? 'partly-below-grade' : 'at-grade'
  return buried === samples.length ? 'below-grade' : 'partly-below-grade'
}

/**
 * A flat site with no ground line named: the datum is the ground under every floor, and each floor
 * slab of the level is judged against it as the sampled path judges them against the field. A split
 * level whose raised part sits at grade is partly below grade over its sunken room, not at grade
 * on the strength of its highest floor. A level with no floor slab reads as `fallback` (its plane).
 */
function flatFloorsStanding(
  nodes: Record<AnyNodeId, AnyNode>,
  level: LevelNode,
  fallback: LevelGradeStanding,
): LevelGradeStanding {
  const plane = levelPlaneWorldY(nodes, level.id)
  if (plane === null) return fallback
  const slabs = floorSlabsOf(nodes, level)
  if (slabs.length === 0) return fallback
  const buried = slabs.filter((slab) => floorBuriedOnFlatSite(plane + slab.elevation)).length
  if (buried === 0) return 'at-grade'
  return buried === slabs.length ? 'below-grade' : 'partly-below-grade'
}

/** Whether a floor at world Y `floorY` lies under a flat site's datum by more than the tolerance. */
export function floorBuriedOnFlatSite(floorY: number): boolean {
  return SITE_DATUM_Y - floorY > BELOW_GRADE_TOLERANCE
}

/** The floor slabs of the house on a level: not a basin, not site flatwork, with a plan. */
function floorSlabsOf(nodes: Record<AnyNodeId, AnyNode>, level: LevelNode): SlabNode[] {
  const slabs: SlabNode[] = []
  for (const childId of level.children) {
    const slab = nodes[childId as AnyNodeId]
    if (slab?.type !== 'slab' || slab.recessed === true || slab.polygon.length < 3) continue
    if (isSiteFlatwork(slab)) continue
    slabs.push(slab)
  }
  return slabs
}

/** The site's terrain field for the site this level stands on, or null on a flat site. */
export function terrainFieldOverLevel(
  nodes: Record<AnyNodeId, AnyNode>,
  level: LevelNode,
): TerrainField | null {
  const buildingId = getLevelElevations(nodes).get(level.id)?.buildingId
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  const site =
    (building?.parentId ? nodes[building.parentId as AnyNodeId] : undefined) ??
    Object.values(nodes).find((node) => node.type === 'site')
  return site?.type === 'site' ? terrainFieldOf(site) : null
}

/**
 * World XZ samples over the level's floor slabs: each slab's corners plus a grid across it no
 * coarser than the terrain's own spacing, capped so a big plate stays cheap. Slabs are the
 * footprint the grade ring already trusts (`belowGradeFootprints`).
 */
export function footprintSamples(
  nodes: Record<AnyNodeId, AnyNode>,
  level: LevelNode,
  field: TerrainField,
): Array<[number, number]> {
  return footprintFloorSamples(nodes, level, field).map(([x, z]) => [x, z])
}

/**
 * {@link footprintSamples} with the world Y of the top of the floor slab each sample lies on as a
 * third coordinate: a level with floors at several heights (a split level) is buried by the ground
 * over each of them, not over the highest alone.
 */
export function footprintFloorSamples(
  nodes: Record<AnyNodeId, AnyNode>,
  level: LevelNode,
  field: TerrainField,
): Array<[number, number, number]> {
  const buildingId = getLevelElevations(nodes).get(level.id)?.buildingId
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  const placed = building?.type === 'building' ? (building as BuildingNode) : null
  const plane = levelPlaneWorldY(nodes, level.id)
  if (plane === null) return []
  const samples: Array<[number, number, number]> = []
  for (const slab of floorSlabsOf(nodes, level)) {
    for (const [x, z] of slabSamples(slab.polygon, field.spacing)) {
      const [worldX, worldZ] = levelLocalToWorldXZ(placed, x, z)
      samples.push([worldX, worldZ, plane + slab.elevation])
    }
  }
  return samples
}

function slabSamples(polygon: Array<[number, number]>, spacing: number): Array<[number, number]> {
  const samples: Array<[number, number]> = [...polygon]
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const stepX = Math.max(spacing, (maxX - minX) / (MAX_SAMPLE_LINES - 1))
  const stepZ = Math.max(spacing, (maxZ - minZ) / (MAX_SAMPLE_LINES - 1))
  for (let x = minX + stepX / 2; x < maxX; x += stepX) {
    for (let z = minZ + stepZ / 2; z < maxZ; z += stepZ) {
      if (pointInPolygon(x, z, polygon)) samples.push([x, z])
    }
  }
  return samples
}
