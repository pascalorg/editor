import { floorsOf } from '../../agent-operations/circulation-spaces'
import { USAGE_INDICATORS } from '../../building/code-profile'
import type { WallNode } from '../../schema'
import { isCurvedWall } from '../../systems/wall/wall-curve'
import { getWallFaceLine } from '../../systems/wall/wall-frame'
import { type FloorGroup, floorGroups, inRegion } from './level-field'
import { obstacleOf, signedDistance } from './obstacles'
import type { Prism, PrismKind, UsageShapes } from './types'
import type { Nodes } from './walls'

/** What a cane finds: a wall object whose lower edge is between 27 in and 80 in (ADA 307.2). */
export const PROTRUSION_LOWER_EDGE_M = [
  USAGE_INDICATORS.protrusionLowest.value,
  USAGE_INDICATORS.protrusionHighest.value,
] as const
/** 4 in (ADA 307.2): nearer than this to the wall, an object is not an obstacle. */
export const PROTRUSION_LIMIT_M = USAGE_INDICATORS.protrusionLimit.value
const OBJECT_KINDS: PrismKind[] = ['item', 'cabinet', 'shelf']
/** An object is "on" a wall if its back is this close to the face (it may stand off, or sink a little in). */
const BACK_REACH = { standOff: 0.15, sunk: 0.12 }

export type Protrusion = {
  nodeId: string
  wallId: string
  face: 'a' | 'b'
  /** How far the object stands out of the wall face, at most. */
  depth: number
  /** Height of the lower edge of the part that protrudes, above the floor. */
  bottom: number
  roomId: string
  roomName: string
  at: [number, number]
  approximate: boolean
}

type Face = {
  wall: WallNode
  face: 'a' | 'b'
  ox: number
  oz: number
  nx: number
  nz: number
  tx: number
  tz: number
  length: number
}

function faces(nodes: Nodes, levelId: string): Face[] {
  const out: Face[] = []
  for (const node of Object.values(nodes)) {
    if (
      node.type !== 'wall' ||
      node.parentId !== levelId ||
      node.visible === false ||
      isCurvedWall(node)
    )
      continue
    const dx = node.end[0] - node.start[0]
    const dz = node.end[1] - node.start[1]
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) continue
    for (const face of ['a', 'b'] as const) {
      const line = getWallFaceLine(node, face)
      const nx = (face === 'a' ? -dz : dz) / length
      const nz = (face === 'a' ? dx : -dx) / length
      out.push({
        wall: node,
        face,
        ox: line.start.x,
        oz: line.start.y,
        nx,
        nz,
        tx: dx / length,
        tz: dz / length,
        length,
      })
    }
  }
  return out
}

/** Signed distance of a plan point beyond a wall face, outward (the room side) positive. */
const beyond = (f: Face, x: number, z: number) => (x - f.ox) * f.nx + (z - f.oz) * f.nz
const along = (f: Face, x: number, z: number) => (x - f.ox) * f.tx + (z - f.oz) * f.tz

/**
 * Wall objects (hung cabinets, mounted shelves and screens) that stand out of a wall face by more
 * than 0.10 m with their lower edge at the height a cane does not find, over a free floor in a room.
 * An object is on a wall when it is hosted by it or its back is within reach of its face; the depth
 * is measured from the face, whatever the object's own frame says.
 */
export function wallProtrusions(nodes: Nodes, shapes: UsageShapes): Protrusion[] {
  const out: Protrusion[] = []
  const groups = floorGroups(shapes)
  const zones = floorsOf(nodes).floors
  const allPrisms = shapes.levels.flatMap((level) => level.prisms)
  for (const level of shapes.levels) {
    const levelGroups = groups.filter((g) => g.levelId === level.levelId)
    if (levelGroups.length === 0) continue
    const levelFaces = faces(nodes, level.levelId)
    const byNode = new Map<string, Prism[]>()
    // wall objects only: what a wall hosts, and a run of wall cabinets; a table on legs is not one
    const onWall = (prism: Prism) => {
      if (!OBJECT_KINDS.includes(prism.kind)) return false
      const node = nodes[prism.nodeId]
      return !!prism.host || (node?.type === 'cabinet' && node.runTier === 'wall')
    }
    for (const prism of level.prisms)
      if (onWall(prism)) byNode.set(prism.nodeId, [...(byNode.get(prism.nodeId) ?? []), prism])
    for (const [nodeId, prisms] of byNode) {
      // the face it is on: the hosted one, else the face its back is nearest
      let best: { face: Face; back: number } | null = null
      for (const f of levelFaces) {
        if (
          prisms.some((p) => p.host) &&
          !prisms.some((p) => p.host?.wallId === f.wall.id && p.host.face === f.face)
        )
          continue
        let back = Number.POSITIVE_INFINITY
        let u0 = Number.POSITIVE_INFINITY
        let u1 = Number.NEGATIVE_INFINITY
        for (const p of prisms)
          for (const [x, z] of p.outer) {
            back = Math.min(back, beyond(f, x, z))
            u0 = Math.min(u0, along(f, x, z))
            u1 = Math.max(u1, along(f, x, z))
          }
        const hosted = prisms.some((p) => p.host)
        if (!hosted && (back < -BACK_REACH.sunk || back > BACK_REACH.standOff)) continue
        if (Math.min(u1, f.length) - Math.max(u0, 0) < 0.1) continue
        if (!best || Math.abs(back) < Math.abs(best.back)) best = { face: f, back }
      }
      if (!best) continue
      const f = best.face
      // each piece of the object (a module, a band) is judged where it stands: a hung cabinet run is
      // over a counter at one end and over open floor at the other
      let lowestBottom = Number.POSITIVE_INFINITY
      let found: {
        depth: number
        at: [number, number]
        roomId: string
        roomName: string
      } | null = null
      for (const p of prisms) {
        let reach = 0
        const out: [number, number][] = []
        for (const [x, z] of p.outer) {
          const d = beyond(f, x, z)
          reach = Math.max(reach, d)
          if (d > PROTRUSION_LIMIT_M) out.push([x, z])
        }
        if (reach <= PROTRUSION_LIMIT_M || out.length === 0) continue
        const cx = out.reduce((sum, q) => sum + q[0], 0) / out.length
        const cz = out.reduce((sum, q) => sum + q[1], 0) / out.length
        const group = pick(levelGroups, cx, cz)
        if (!group) continue
        // the lower edge is the lowest the object goes over that spot: a bed's headboard stands on its frame
        const lowest = Math.min(...prisms.filter((q) => pointIn(q, cx, cz)).map((q) => q.z0), p.z0)
        const bottom = lowest - group.y
        if (!(bottom >= PROTRUSION_LOWER_EDGE_M[0] - 1e-9 && bottom < PROTRUSION_LOWER_EDGE_M[1]))
          continue
        const room = zones
          .find((floor) => floor.id === level.levelId)
          ?.zones.find(
            (zone) => !zone.outdoor && inRegion(cx, cz, { outer: zone.polygon, holes: zone.holes }),
          )
        if (!room || overFurniture(allPrisms, nodeId, f.wall.id, group.y, lowest, cx, cz)) continue
        lowestBottom = Math.min(lowestBottom, bottom)
        if (!found || reach > found.depth)
          found = {
            depth: reach,
            at: [cx, cz],
            roomId: room.id,
            roomName: String(nodes[room.id]?.name ?? room.id),
          }
      }
      if (!found) continue
      out.push({
        nodeId,
        wallId: f.wall.id,
        face: f.face,
        depth: Math.round(found.depth * 1000) / 1000,
        bottom: Math.round(lowestBottom * 1000) / 1000,
        roomId: found.roomId,
        roomName: found.roomName,
        at: [Math.round(found.at[0] * 1000) / 1000, Math.round(found.at[1] * 1000) / 1000],
        approximate: prisms.some((p) => p.shape === 'approx'),
      })
    }
  }
  return out
}

const pick = (groups: FloorGroup[], x: number, z: number): FloorGroup | undefined =>
  groups.find((g) => g.regions.some((region) => inRegion(x, z, region))) ?? groups[0]

const pointIn = (p: Prism, x: number, z: number) => signedDistance(obstacleOf(p, 0).edges, x, z) < 0

const FURNITURE: PrismKind[] = ['item', 'cabinet', 'shelf', 'column', 'other']

/**
 * Whether a piece of furniture stands under the point, below the object's lower edge: then the
 * object is over it and nobody walks there. One point, the middle of the protruding part.
 */
function overFurniture(
  all: Prism[],
  nodeId: string,
  wallId: string,
  floor: number,
  lower: number,
  x: number,
  z: number,
): boolean {
  return all.some(
    (p) =>
      FURNITURE.includes(p.kind) &&
      p.nodeId !== nodeId &&
      p.nodeId !== wallId &&
      p.z1 > floor + 0.03 &&
      p.z0 < lower - 0.01 &&
      signedDistance(obstacleOf(p, 0).edges, x, z) < 0,
  )
}
