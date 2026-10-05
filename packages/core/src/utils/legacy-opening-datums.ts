import { roomFace } from '../commands/structure/shared'
import { floorRoomFaces } from '../lib/floor-room-faces'
import {
  openingDatumFromSupport,
  openingFitsAtDatum,
  supportSegmentAt,
  wallSupportForNodes,
} from '../lib/opening-floor-datum'
import { roomFloorPlate } from '../lib/room-floor-plate'
import type { AnyNode, DoorNode, SlabNode, WallNode, WindowNode } from '../schema'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'

type Facing = { face: 'a' | 'b'; from: number; to: number; zoneId: string; raised: boolean }
const contexts = new WeakMap<object, Map<string, Map<string, Facing[]>>>()

function roomSpans(nodes: Readonly<Record<string, AnyNode>>, levelId: string) {
  let levels = contexts.get(nodes)
  if (!levels) {
    levels = new Map()
    contexts.set(nodes, levels)
  }
  const cached = levels.get(levelId)
  if (cached) return cached
  const children = Object.values(nodes).filter((node) => node.parentId === levelId)
  const faces = floorRoomFaces(
    children.filter((node) => node.type === 'wall' || node.type === 'separator'),
  )
  const slabs = children.filter((node): node is SlabNode => node.type === 'slab')
  const result = new Map<string, Facing[]>()
  for (const zone of children) {
    if (
      zone.type !== 'zone' ||
      zone.spaceRole !== 'room' ||
      zone.hasFloor === false ||
      zone.floor?.support === 'open'
    )
      continue
    const room = roomFace(nodes, zone, faces)
    const plate = roomFloorPlate(slabs, zone.id)
    for (const span of room?.spans ?? []) {
      const spans = result.get(span.boundaryId) ?? []
      spans.push({
        face: span.face,
        from: span.t0,
        to: span.t1,
        zoneId: zone.id,
        raised: plate?.plateRole === 'platform',
      })
      result.set(span.boundaryId, spans)
    }
  }
  levels.set(levelId, result)
  return result
}

/** A legacy wall election changing is not evidence of an authored floor step. */
export function legacyOpeningFloorChange(
  wall: WallNode,
  opening: DoorNode | WindowNode,
  nodes: Readonly<Record<string, AnyNode>>,
  oldSupport: number,
  tolerance = 1e-6,
  legacyFloor = oldSupport,
) {
  const support = wallSupportForNodes(wall, nodes)
  const datum = openingDatumFromSupport(wall, opening, support)
  const fits = openingFitsAtDatum(wall, opening, datum, nodes, support)
  const delta = datum - oldSupport
  const length = getWallCurveLength(wall)
  const from = Math.max(0, (opening.position[0] - opening.width / 2) / length)
  const to = Math.min(1, (opening.position[0] + opening.width / 2) / length)
  const heights = [...support.faceDatum.a, ...support.faceDatum.b].flatMap((segment) => {
    const a = Math.max(from, segment.start),
      b = Math.min(to, segment.end)
    return b > a ? [supportSegmentAt(segment, a), supportSegmentAt(segment, b)] : []
  })
  const difference = heights.length ? Math.max(...heights) - Math.min(...heights) : 0
  const chord = (t: number) => {
    const { point } = getWallCurveFrameAt(wall, t)
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1]
    return ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dz) / (dx * dx + dz * dz)
  }
  const start = chord(from),
    end = chord(to)
  const spans = (roomSpans(nodes, wall.parentId!).get(wall.id) ?? []).filter(
    (span) => span.to > start && span.from < end,
  )
  const covered = (face: 'a' | 'b') => {
    let cursor = start
    for (const span of spans.filter((span) => span.face === face).sort((a, b) => a.from - b.from)) {
      if (span.from > cursor + 1e-6) return false
      cursor = Math.max(cursor, span.to)
    }
    return end > start && cursor >= end - 1e-6
  }
  const a = covered('a'),
    b = covered('b')
  const step = difference >= 0.001 - 1e-6 && Math.abs(delta) <= difference + tolerance
  const reason =
    step && a && b
      ? 'between-heights'
      : step && spans.some((span) => span.raised && covered(span.face))
        ? 'raised-room'
        : delta >= -tolerance &&
            delta <= Math.min(0.05, legacyFloor - oldSupport) + tolerance &&
            (a || b)
          ? 'finished-floor'
          : undefined
  return {
    datum,
    delta,
    difference,
    reason: fits ? reason : undefined,
    fits,
    zoneIds: [...new Set(spans.map((span) => span.zoneId))],
  }
}
