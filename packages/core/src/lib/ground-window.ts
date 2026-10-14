import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '../schema'
import { getLevelElevations, levelFloorWorldY } from '../services/storey'
import { heightAt } from './terrain-field'
import { terrainFieldOf } from './terrain-source'
import { levelLocalToWorldXZ } from './terrain-support-query'

/**
 * The ground between an eye and the house: a hillside can hide a level that no floor-burial
 * test flags — the owner's street-side plateau stands 6 m tall just past the walls, over a
 * pad flattened to 0. These boxes and the march along the sight line are what the ground
 * window (the veiled patch of ground in the way) is decided from, live and in a capture.
 */
export type GroundBox = { min: [number, number, number]; max: [number, number, number] }

/** The world box of one level: its floor slabs' extent (its walls' if it has no slab), floor to ceiling. */
export function levelGroundBox(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): GroundBox | null {
  const level = nodes[levelId as LevelNode['id']]
  const floorY = levelFloorWorldY(nodes, levelId)
  if (level?.type !== 'level' || floorY === null) return null
  const height = getLevelElevations(nodes).get(levelId)?.height ?? 3
  const points = footprintPoints(nodes, level)
  if (points.length === 0) return null
  return boxOf(points, floorY, floorY + height)
}

/**
 * The world box of a building (every building, with no id): the union of its levels' boxes.
 * The window's target when the whole building is shown.
 */
export function buildingGroundBox(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId?: string | null,
): GroundBox | null {
  let box: GroundBox | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level') continue
    if (buildingId && getLevelElevations(nodes).get(node.id)?.buildingId !== buildingId) continue
    const levelBox = levelGroundBox(nodes, node.id)
    if (levelBox) box = box ? unionBox(box, levelBox) : levelBox
  }
  return box
}

/** How far past the sight line the ground must stand to count as in the way. */
const SIGHT_CLEARANCE = 0.05
/** Sight-line marches at most this long, however far the eye is. */
const MAX_MARCH_STEPS = 240

/**
 * Whether sculpted ground stands between `eye` and `box`: any of the sight lines to the box's
 * floor corners and centre passes under the terrain before it reaches the box. Pure height
 * field arithmetic — the few throttled CPU rays the view bar's word and the window's on/off
 * are decided by; the window's shape itself is per-fragment in the renderer. `false` on a
 * flat site, and for an eye inside the box (a walkthrough sees out, not through a window).
 */
export function terrainBetweenEyeAndBox(
  nodes: Record<AnyNodeId, AnyNode>,
  eye: readonly [number, number, number],
  box: GroundBox,
): boolean {
  const site = Object.values(nodes).find((node) => node.type === 'site')
  const field = site?.type === 'site' ? terrainFieldOf(site) : null
  if (!field) return false
  if (
    eye[0] >= box.min[0] &&
    eye[0] <= box.max[0] &&
    eye[1] >= box.min[1] &&
    eye[1] <= box.max[1] &&
    eye[2] >= box.min[2] &&
    eye[2] <= box.max[2]
  )
    return false
  const floorY = box.min[1]
  const targets: Array<[number, number, number]> = [
    [box.min[0], floorY, box.min[2]],
    [box.min[0], floorY, box.max[2]],
    [box.max[0], floorY, box.min[2]],
    [box.max[0], floorY, box.max[2]],
    [(box.min[0] + box.max[0]) / 2, floorY, (box.min[2] + box.max[2]) / 2],
  ]
  return targets.some((target) => sightLineBuried(field, eye, target, box))
}

function sightLineBuried(
  field: NonNullable<ReturnType<typeof terrainFieldOf>>,
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  box: GroundBox,
): boolean {
  const dx = target[0] - eye[0]
  const dz = target[2] - eye[2]
  const planLength = Math.hypot(dx, dz)
  if (planLength < 1e-6) return false
  const steps = Math.min(MAX_MARCH_STEPS, Math.max(2, Math.ceil(planLength / field.spacing)))
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps
    const x = eye[0] + dx * t
    const z = eye[2] + dz * t
    // Ground under the house itself is not "between" the eye and it.
    if (x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2]) continue
    const sightY = eye[1] + (target[1] - eye[1]) * t
    if (heightAt(field, x, z) > sightY + SIGHT_CLEARANCE) return true
  }
  return false
}

function footprintPoints(
  nodes: Record<AnyNodeId, AnyNode>,
  level: LevelNode,
): Array<[number, number]> {
  const buildingId = getLevelElevations(nodes).get(level.id)?.buildingId
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  const placed = building?.type === 'building' ? (building as BuildingNode) : null
  const points: Array<[number, number]> = []
  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type === 'slab' && child.recessed !== true)
      for (const [x, z] of child.polygon) points.push(levelLocalToWorldXZ(placed, x, z))
    else if (child?.type === 'wall')
      for (const [x, z] of [child.start, child.end]) points.push(levelLocalToWorldXZ(placed, x, z))
  }
  return points
}

function boxOf(points: Array<[number, number]>, minY: number, maxY: number): GroundBox {
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  return {
    min: [Math.min(...xs), minY, Math.min(...zs)],
    max: [Math.max(...xs), maxY, Math.max(...zs)],
  }
}

function unionBox(a: GroundBox, b: GroundBox): GroundBox {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }
}
