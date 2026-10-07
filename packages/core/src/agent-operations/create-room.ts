import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import { doorFacing, planWallOpening } from '../building/wall-openings'
import { createZone } from '../commands/structure/create-zone'
import { structureChangeBatch } from '../commands/structure/shared'
import { type AnyNode, generateId, type WallNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { type LevelTargetInput, targetLevel } from './level-target'
import { polygonArea, type Vec2 } from './plan-geometry'
import { levelRole } from './scene-queries'
import type { AgentOperation, SceneNodes } from './types'

type OpeningSpec = {
  wallIndex: number
  t?: number
  width?: number
  height?: number
  sillHeight?: number
  hingesSide?: 'left' | 'right'
  swingDirection?: 'inward' | 'outward'
  style?: string
}

type CreateRoomInput = LevelTargetInput & {
  name: string
  polygon: number[][]
  color?: string
  wallHeight?: number
  wallThickness?: number
  outdoor?: boolean
  doors?: OpeningSpec[]
  windows?: OpeningSpec[]
}

type SkippedOpening = { kind: 'door' | 'window'; index: number; code: string; message: string }

// A wall counts as running along a polygon edge when both its ends sit this close to the edge's line.
const EDGE_TOLERANCE = 0.2

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]

/** Distance from `point` to the line through a and b, and where it projects along a → b (0..1). */
export function edgeProjection(a: Vec2, b: Vec2, point: readonly number[]) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < 1e-12) return { distance: Math.hypot(point[0]! - a[0], point[1]! - a[1]), t: 0 }
  const rx = point[0]! - a[0]
  const rz = point[1]! - a[1]
  return {
    distance: Math.abs(rx * dz - rz * dx) / Math.sqrt(lengthSq),
    t: (rx * dx + rz * dz) / lengthSq,
  }
}

const wallsOn = (nodes: SceneNodes, levelId: string) =>
  Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )

/** The walls of the level that run along the edge a → b, both ends on its line. */
function wallsAlong(nodes: SceneNodes, levelId: string, a: Vec2, b: Vec2) {
  return wallsOn(nodes, levelId).filter((wall) => {
    const start = edgeProjection(a, b, wall.start)
    const end = edgeProjection(a, b, wall.end)
    return (
      start.distance < EDGE_TOLERANCE &&
      end.distance < EDGE_TOLERANCE &&
      Math.min(1, Math.max(start.t, end.t)) - Math.max(0, Math.min(start.t, end.t)) > 1e-6
    )
  })
}

/**
 * Where on which wall a point of a polygon edge falls: by position among the walls of the room's
 * own level, never by the id a wall had — walls split and join, and the floor below has walls on
 * the same line.
 */
function wallAt(nodes: SceneNodes, levelId: string, a: Vec2, b: Vec2, point: Vec2) {
  for (const wall of wallsAlong(nodes, levelId, a, b)) {
    const { t } = edgeProjection(wall.start, wall.end, point)
    if (t >= -1e-6 && t <= 1 + 1e-6) return { wallId: wall.id, t: Math.min(1, Math.max(0, t)) }
  }
  return null
}

/** The construction the host derived for the room: its floor plate and its ceiling. */
function derivedSurfaces(nodes: SceneNodes, levelId: string, zoneId: string) {
  const children = Object.values(nodes).filter((node) => node.parentId === levelId)
  const slab = children.find(
    (node) => node.type === 'slab' && node.boundary === 'auto' && node.zoneIds?.includes(zoneId),
  )
  const ceiling = children.find(
    (node) => node.type === 'ceiling' && node.boundary === 'auto' && node.zoneId === zoneId,
  )
  return { slabId: slab?.id ?? null, ceilingId: ceiling?.id ?? null }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * `create_room`: the editor's room command — walls where no wall runs yet, the zone that names the
 * room — then the doors and windows declared by polygon edge, each placed as add_door / add_window
 * place one. The floor plate and the ceiling are the host's to derive; the result reads them back.
 */
export const createRoom: AgentOperation<CreateRoomInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  if (levelRole(nodes, level).role === 'roof')
    refuse(
      'roof_level',
      `${level.name || level.id} is a roof level, not a storey: build the room on the storey below it.`,
      { levelId: level.id },
    )
  const polygon = input.polygon as Vec2[]

  let plan: ReturnType<typeof createZone>
  try {
    plan = createZone(nodes, {
      levelId: level.id,
      polygon,
      name: input.name,
      enclose: !input.outdoor,
      ...(input.outdoor
        ? { intent: { hasCeiling: false } }
        : {
            wall: {
              ...(input.wallHeight === undefined ? {} : { height: input.wallHeight }),
              ...(input.wallThickness === undefined ? {} : { thickness: input.wallThickness }),
            },
          }),
      mintId: generateId,
    })
  } catch (error) {
    if (!(error instanceof Error && error.name === 'Error')) throw error
    if (/valid polygon/.test(error.message))
      refuse(
        'invalid_polygon',
        'The polygon is not a room: give at least three corners in order, edges that do not cross, an area above 0.01 m².',
      )
    refuse('cannot_enclose', error.message, { levelId: level.id })
  }
  // The refusal takes the conflict's own code: today createZone reports only a terrace overlapping
  // a room (outdoor-room-overlap), and an indoor conflict must not borrow that name.
  if (plan.conflicts?.length)
    refuse(
      plan.conflicts[0]!.code.replaceAll('-', '_'),
      plan.conflicts.map((conflict) => conflict.message).join(' '),
      { conflicts: plan.conflicts },
    )

  const roomChanges = structureChangeBatch(plan.changes)
  if (input.color)
    roomChanges.create = roomChanges.create.map((entry) =>
      entry.node.id === plan.zoneId
        ? { ...entry, node: { ...entry.node, color: input.color } as AnyNode }
        : entry,
    )
  let scene = applySceneChanges(nodes, roomChanges)

  const openings: { node: AnyNode; parentId: string }[] = []
  const skippedOpenings: SkippedOpening[] = []
  const place = (kind: 'door' | 'window', specs: OpeningSpec[] = []) =>
    specs.flatMap(({ wallIndex, t = 0.5, ...spec }, index) => {
      const skip = (code: string, message: string) => {
        skippedOpenings.push({ kind, index, code, message })
        return []
      }
      if (wallIndex >= polygon.length)
        return skip(
          'edge_out_of_range',
          `The polygon has ${polygon.length} edges (0–${polygon.length - 1}); there is no edge ${wallIndex}.`,
        )
      const a = polygon[wallIndex]!
      const b = polygon[(wallIndex + 1) % polygon.length]!
      const host = wallAt(scene, level.id, a, b, lerp(a, b, t))
      if (!host) return skip('no_wall', `No wall runs along edge ${wallIndex} at t ${t}.`)
      try {
        const planned = planWallOpening(scene, { kind, ...spec, wallId: host.wallId, t: host.t })
        const create = { node: planned.node, parentId: planned.wallId }
        scene = applySceneChanges(scene, { create: [create] })
        openings.push(create)
        return [planned.node.id]
      } catch (error) {
        if (!isAgentRefusal(error)) throw error
        return skip(error.code, error.message)
      }
    })
  const doorIds = place('door', input.doors)
  const windowIds = place('window', input.windows)

  const wallIds = polygon.map(
    (a, i) => wallsAlong(scene, level.id, a, polygon[(i + 1) % polygon.length]!)[0]?.id ?? null,
  )
  const reusedWalls = wallIds.filter((id) => id && nodes[id]).length
  const result = {
    ok: true,
    zoneId: plan.zoneId,
    wallIds,
    reusedWalls,
    areaSqMeters: Math.round(polygonArea(polygon) * 100) / 100,
    doorIds,
    windowIds,
    ...(skippedOpenings.length ? { skippedOpenings } : {}),
    message: [
      `Created ${input.outdoor ? 'outdoor room' : 'room'} "${input.name}" on ${level.name || level.id}`,
      ...(reusedWalls ? [`reused ${plural(reusedWalls, 'wall')} already there`] : []),
      ...(doorIds.length ? [plural(doorIds.length, 'door')] : []),
      ...(windowIds.length ? [plural(windowIds.length, 'window')] : []),
      ...(skippedOpenings.length
        ? [`skipped ${plural(skippedOpenings.length, 'opening')} (see skippedOpenings)`]
        : []),
    ].join(', '),
  }
  return {
    result,
    changes: { ...roomChanges, create: [...roomChanges.create, ...openings] },
    // The doors were planned before the host derived the room, so a new wall did not know its
    // outside yet; once it does, a door on an outside wall faces out, as add_door's does.
    afterReconcile: (derived) => {
      const update = doorIds.flatMap((id) => {
        const door = derived[id]
        const wall = derived[door?.parentId ?? '']
        if (door?.type !== 'door' || wall?.type !== 'wall') return []
        const facing = doorFacing(wall)
        return facing.side && facing.side !== door.side ? [{ id, data: facing }] : []
      })
      return {
        result: { ...result, ...derivedSurfaces(derived, level.id, plan.zoneId) },
        ...(update.length ? { changes: { update } } : {}),
      }
    },
  }
}
