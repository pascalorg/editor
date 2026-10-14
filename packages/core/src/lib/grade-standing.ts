import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '../schema'
import {
  BELOW_GRADE_TOLERANCE,
  getLevelElevations,
  isLevelBelowGrade,
  levelFloorWorldY,
} from '../services/storey'
import { pointInPolygon } from '../systems/slab/slab-support'
import { heightAt, type TerrainField } from './terrain-field'
import { terrainFieldOf } from './terrain-source'
import { levelLocalToWorldXZ } from './terrain-support-query'

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
 * `levelId`'s standing against the sculpted terrain over its own footprint (its floor slabs,
 * sampled against the terrain field): the ground counts as over the floor where it stands more
 * than {@link BELOW_GRADE_TOLERANCE} above it. A flat site (no terrain field), or a level with
 * no floor slab to sample, answers from the flat datum exactly as before. `'at-grade'` for an
 * id that is no level.
 */
export function levelGradeStanding(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): LevelGradeStanding {
  const level = nodes[levelId as LevelNode['id']]
  if (level?.type !== 'level') return 'at-grade'
  const flat: LevelGradeStanding = isLevelBelowGrade(nodes, levelId) ? 'below-grade' : 'at-grade'
  const floorY = levelFloorWorldY(nodes, levelId)
  const field = terrainFieldOverLevel(nodes, level)
  if (floorY === null || !field) return flat

  const samples = footprintSamples(nodes, level, field)
  if (samples.length === 0) return flat
  let buried = 0
  for (const [worldX, worldZ] of samples) {
    if (heightAt(field, worldX, worldZ) - floorY > BELOW_GRADE_TOLERANCE) buried += 1
  }
  if (buried === 0) return 'at-grade'
  return buried === samples.length ? 'below-grade' : 'partly-below-grade'
}

/** The site's terrain field for the site this level stands on, or null on a flat site. */
function terrainFieldOverLevel(
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
function footprintSamples(
  nodes: Record<AnyNodeId, AnyNode>,
  level: LevelNode,
  field: TerrainField,
): Array<[number, number]> {
  const buildingId = getLevelElevations(nodes).get(level.id)?.buildingId
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  const placed = building?.type === 'building' ? (building as BuildingNode) : null
  const samples: Array<[number, number]> = []
  for (const childId of level.children) {
    const slab = nodes[childId as AnyNodeId]
    if (slab?.type !== 'slab' || slab.recessed === true || slab.polygon.length < 3) continue
    for (const [x, z] of slabSamples(slab.polygon, field.spacing))
      samples.push(levelLocalToWorldXZ(placed, x, z))
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
