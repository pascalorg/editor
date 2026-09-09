/**
 * SHOW IT IN THE SCENE — the Bones panel's highlight.
 *
 * The X-ray meshes never take the host's raycast (renderer.tsx: the framing
 * is a pure visual, the wall selection gate needs it that way), so "click a
 * member in 3D" is not how Bones and the scene meet. They meet the other
 * way round: a takeoff row, a section, a placed service point or the
 * selected wall names a SET of members, the renderer paints that set in the
 * highlight colour, and the camera goes to it (Steve, 2026-09-09: "when i
 * click things in bones it doesnt show up in the scene").
 *
 * Pure: the spec, the match, the bounds and the camera pose — no React, no
 * stores — so the whole path is testable headlessly.
 */
import type { Member } from '../core/types'

/** The highlight paint — an orange no member colour comes near. */
export const HIGHLIGHT_COLOR = '#ff7a1a'

export type HighlightSpec = {
  /** What the panel says it is showing. */
  label: string
  systems?: readonly string[]
  sizes?: readonly string[]
  roles?: readonly string[]
  sourceIds?: readonly string[]
  /** `wh` matches `wh` and `wh-pan`, never `whatever`. */
  sourceIdPrefixes?: readonly string[]
}

export function matchesHighlight(m: Member, spec: HighlightSpec | null | undefined): boolean {
  if (!spec) return false
  if (spec.systems && !spec.systems.includes(m.system)) return false
  if (spec.sizes && !(m.size !== undefined && spec.sizes.includes(m.size))) return false
  if (spec.roles && !spec.roles.includes(m.role)) return false
  if (spec.sourceIds || spec.sourceIdPrefixes) {
    const byId = spec.sourceIds?.includes(m.sourceId) ?? false
    const byPrefix =
      spec.sourceIdPrefixes?.some((p) => m.sourceId === p || m.sourceId.startsWith(`${p}-`)) ??
      false
    if (!byId && !byPrefix) return false
  }
  return true
}

export type Bounds = { min: [number, number, number]; max: [number, number, number] }

/** The members' level-local box (their dims are axis-aligned enough for a camera), or null. */
export function membersBounds(members: readonly Member[]): Bounds | null {
  let bounds: Bounds | null = null
  for (const m of members) {
    const r = Math.max(m.dims[0], m.dims[2]) / 2
    const lo: [number, number, number] = [
      m.position[0] - r,
      m.position[1] - m.dims[1] / 2,
      m.position[2] - r,
    ]
    const hi: [number, number, number] = [
      m.position[0] + r,
      m.position[1] + m.dims[1] / 2,
      m.position[2] + r,
    ]
    if (!bounds) bounds = { min: lo, max: hi }
    else {
      for (let i = 0; i < 3; i++) {
        if (lo[i]! < bounds.min[i]!) bounds.min[i] = lo[i]!
        if (hi[i]! > bounds.max[i]!) bounds.max[i] = hi[i]!
      }
    }
  }
  return bounds
}

export type Pose = { position: [number, number, number]; target: [number, number, number] }

/**
 * A camera pose that frames `bounds` (level-local) in the world: the target
 * at the box's centre, the eye back along a raised diagonal far enough for
 * the box's size (a stud reads from 2 m, a whole plumbing system from 15).
 */
export function framePose(
  bounds: Bounds,
  toWorld: (p: readonly [number, number, number]) => [number, number, number],
  /** A level-local plan point the eye stands toward — the house's centre, so a tank on a garage wall is seen from inside the garage and a pole from the yard. */
  towards?: readonly [number, number],
): Pose {
  const centre: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  const size = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  )
  const dist = Math.max(2.5, size * 1.3 + 1.5)
  const target = toWorld(centre)
  // the eye: toward `towards` when it is clear of the box, else out along
  // the level's +x/+z diagonal; raised half the distance
  let dx = 0.7071
  let dz = 0.7071
  if (towards) {
    const tx = towards[0] - centre[0]
    const tz = towards[1] - centre[2]
    const tl = Math.hypot(tx, tz)
    if (tl > 0.5) {
      dx = tx / tl
      dz = tz / tl
    }
  }
  const eyeLocal: [number, number, number] = [
    centre[0] + dist * dx * 0.88,
    centre[1] + dist * 0.5,
    centre[2] + dist * dz * 0.88,
  ]
  return { position: toWorld(eyeLocal), target }
}

/**
 * The level's local → world map from the scene: the building's position and
 * yaw (rotation[1]) and the level's base elevation, the same frame the
 * generator and the site probes use (world = building + R(yaw)·local).
 */
export function levelToWorld(
  nodes: Record<string, Record<string, unknown> | undefined>,
  levelId: string,
): (p: readonly [number, number, number]) => [number, number, number] {
  const level = nodes[levelId]
  const building = level && typeof level.parentId === 'string' ? nodes[level.parentId] : undefined
  const pos = Array.isArray(building?.position) ? (building?.position as number[]) : [0, 0, 0]
  const rot = Array.isArray(building?.rotation) ? (building?.rotation as number[]) : [0, 0, 0]
  const yaw = rot[1] ?? 0
  const base = typeof level?.baseElevation === 'number' ? level.baseElevation : 0
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return (p) => [
    (pos[0] ?? 0) + p[0] * c + p[2] * s,
    (pos[1] ?? 0) + base + p[1],
    (pos[2] ?? 0) - p[0] * s + p[2] * c,
  ]
}

/** The member sets a placed service point owns (the engines' sourceId conventions). */
export function serviceHighlight(serviceType: string): Omit<HighlightSpec, 'label'> {
  switch (serviceType) {
    case 'water-heater':
      return { sourceIdPrefixes: ['wh'] }
    case 'power-entry':
    case 'electric-meter':
    case 'utility-pole':
      return { sourceIdPrefixes: ['service-entrance'] }
    case 'panel':
      return { sourceIdPrefixes: ['service-entrance', 'panel'] }
    case 'water-entry':
      return { sourceIdPrefixes: ['water-service'] }
    case 'sewer-exit':
      return { sourceIdPrefixes: ['dwv-lateral', 'septic'] }
    case 'heat-pump':
    case 'thermostat':
      return { systems: ['hvac'], roles: ['equipment', 'pipe-run', 'duct-run'] }
    default:
      return { sourceIds: [] }
  }
}
