import type { BoundaryNode } from '../../lib/room-topology-index'
import type { AnyNode, WallNode } from '../../schema'
import {
  getWallArcData,
  getWallCurveFrameAt,
  getWallCurveLength,
} from '../../systems/wall/wall-curve'
import { at, boundaries, type Point, type StructureConflict, type StructureNodes } from './shared'
import { wallAttachments, wallStation } from './zone-wall-merge'

export function boundaryStation(wall: BoundaryNode, point: Point) {
  const arc = wall.type === 'wall' ? getWallArcData(wall) : null
  if (!arc) return wallStation(wall, point)
  let angle =
    (Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x) - arc.startAngle) * arc.direction
  while (angle < -1e-8) angle += 2 * Math.PI
  return angle / Math.abs(arc.delta)
}

export function boundaryPoint(wall: BoundaryNode, t: number): Point {
  if (wall.type === 'separator') return at(wall.start, wall.end, t)
  const { point } = getWallCurveFrameAt(wall, t)
  return [point.x, point.y]
}

function crossings(a: BoundaryNode, b: BoundaryNode): Point[] {
  const aa = a.type === 'wall' ? getWallArcData(a) : null
  const bb = b.type === 'wall' ? getWallArcData(b) : null
  let points: Point[] = []
  if (aa && bb) {
    const dx = bb.center.x - aa.center.x,
      dz = bb.center.y - aa.center.y,
      distance = Math.hypot(dx, dz)
    if (
      distance < 1e-8 ||
      distance > aa.radius + bb.radius + 1e-8 ||
      distance < Math.abs(aa.radius - bb.radius) - 1e-8
    )
      return []
    const along = (aa.radius ** 2 - bb.radius ** 2 + distance ** 2) / (2 * distance)
    const offset = Math.sqrt(Math.max(0, aa.radius ** 2 - along ** 2))
    points = [-1, 1].map((side) => [
      aa.center.x + (along * dx) / distance - (side * offset * dz) / distance,
      aa.center.y + (along * dz) / distance + (side * offset * dx) / distance,
    ])
  } else if (aa || bb) {
    const arc = (aa ?? bb)!,
      line = aa ? b : a
    const dx = line.end[0] - line.start[0],
      dz = line.end[1] - line.start[1]
    const x = line.start[0] - arc.center.x,
      z = line.start[1] - arc.center.y
    const length2 = dx * dx + dz * dz,
      dot = x * dx + z * dz
    const discriminant = dot * dot - length2 * (x * x + z * z - arc.radius * arc.radius)
    if (discriminant < -1e-8 || length2 < 1e-12) return []
    points = [-1, 1].map((side) =>
      at(line.start, line.end, (-dot + side * Math.sqrt(Math.max(0, discriminant))) / length2),
    )
  } else {
    const ax = a.end[0] - a.start[0],
      az = a.end[1] - a.start[1]
    const bx = b.end[0] - b.start[0],
      bz = b.end[1] - b.start[1]
    const determinant = ax * bz - az * bx
    if (Math.abs(determinant) < 1e-9) {
      if (Math.abs((b.start[0] - a.start[0]) * az - (b.start[1] - a.start[1]) * ax) < 1e-8)
        points = [a.start, a.end, b.start, b.end]
    } else {
      const t = ((b.start[0] - a.start[0]) * bz - (b.start[1] - a.start[1]) * bx) / determinant
      points = [at(a.start, a.end, t)]
    }
  }
  return points.filter((point) =>
    [a, b].every((wall) => {
      const t = boundaryStation(wall, point)
      return t >= -1e-6 && t <= 1 + 1e-6
    }),
  )
}

export function dropCrossingCuts(nodes: StructureNodes, moving: Set<string>, levelId: string) {
  const walls = boundaries(nodes, levelId)
  const cuts = new Map<string, number[]>()
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i]!,
        b = walls[j]!
      if (!moving.has(a.id) && !moving.has(b.id)) continue
      for (const point of crossings(a, b))
        for (const wall of [a, b]) {
          const t = boundaryStation(wall, point)
          if (t <= 1e-6 || t >= 1 - 1e-6) continue
          const values = cuts.get(wall.id) ?? []
          if (!values.some((value) => Math.abs(value - t) < 1e-6)) values.push(t)
          cuts.set(
            wall.id,
            values.sort((a, b) => a - b),
          )
        }
    }
  return cuts
}

export function clearOpeningCuts(
  nodes: Record<string, AnyNode>,
  wall: WallNode,
  cuts: number[],
  force: boolean,
): StructureConflict | undefined {
  const length = getWallCurveLength(wall)
  const stations = cuts
    .filter((t) => t > 1e-6 && t < 1 - 1e-6)
    .map((t) => {
      const point = boundaryPoint(wall, t)
      const tangent = getWallCurveFrameAt(wall, t).tangent
      const padding = boundaries(nodes, wall.parentId!).reduce((pad, other) => {
        if (other.type !== 'wall' || other.id === wall.id) return pad
        const station = boundaryStation(other, point)
        if (station < -1e-6 || station > 1 + 1e-6) return pad
        const frame = getWallCurveFrameAt(other, station)
        if (
          Math.hypot(frame.point.x - point[0], frame.point.y - point[1]) > 1e-6 ||
          Math.abs(tangent.x * frame.tangent.y - tangent.y * frame.tangent.x) < 1e-6
        )
          return pad
        return Math.max(pad, (other.thickness ?? 0.1) / 2)
      }, 0)
      return [t * length - padding, t * length + padding] as Point
    })
    .sort((a, b) => a[0] - b[0])
  const openings = wallAttachments(nodes, wall).filter(
    (node) => node.type === 'door' || node.type === 'window',
  )
  const occupied = openings.filter((node) =>
    stations.some(
      ([lo, hi]) =>
        hi > node.position[0] - node.width / 2 + 1e-5 &&
        lo < node.position[0] + node.width / 2 - 1e-5,
    ),
  )
  if (!occupied.length) return
  const refused = (): StructureConflict => ({
    code: 'occupied-split',
    nodeIds: [wall.id, ...occupied.map((node) => node.id)],
    message: force
      ? 'No space on the wall fits the opening clear of every crossing.'
      : 'A crossing falls inside a door or window. Force moves the opening along its wall if it fits.',
  })
  if (!force) return refused()
  const fixed = openings
    .filter((node) => !occupied.includes(node))
    .map((node) => [node.position[0] - node.width / 2, node.position[0] + node.width / 2] as Point)
  occupied.sort((a, b) => b.width - a.width || a.id.localeCompare(b.id))
  const arrange = (index: number, placed: Point[]): number[] | undefined => {
    const node = occupied[index]
    if (!node) return []
    const half = node.width / 2
    const candidates = new Set<number>()
    let ranges: Point[] = [[half, length - half]]
    for (const [lo, hi] of [...stations, ...placed])
      ranges = ranges.flatMap(([a, b]) => {
        const left = lo - half,
          right = hi + half
        if (right <= a || left >= b) return [[a, b]]
        return [
          [a, Math.min(b, left)],
          [Math.max(a, right), b],
        ].filter(([a, b]) => b! >= a! - 1e-8) as Point[]
      })
    for (const [lo, hi] of ranges)
      if (hi >= lo - 1e-8) {
        candidates.add(Math.max(lo, Math.min(hi, node.position[0])))
        candidates.add(lo)
        candidates.add(Math.max(lo, hi))
      }
    // Trying interval edges as well as the nearest pose avoids rejecting a fit
    // just because an earlier opening occupied the only space for another.
    for (const station of [...candidates].sort(
      (a, b) => Math.abs(a - node.position[0]) - Math.abs(b - node.position[0]) || a - b,
    )) {
      const rest = arrange(index + 1, [...placed, [station - half, station + half]])
      if (rest) return [station, ...rest]
    }
  }
  const relocated = arrange(0, fixed)
  if (!relocated) return refused()
  occupied.forEach((node, i) => {
    nodes[node.id] = { ...node, position: [relocated[i]!, node.position[1], node.position[2]] }
  })
}
