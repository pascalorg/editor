import type { SeparatorNode, WallNode } from '../schema'
import { getClampedWallCurveOffset } from '../systems/wall/wall-curve'

import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { containsPoint, type Ring } from './polygon-boolean'
import { boundariesCross, junctionReach, TEE_REACH } from './room-graph'

export type BoundaryNode = WallNode | SeparatorNode
export type BoundarySpan = {
  roomId: string
  boundaryId: string
  kind: 'wall' | 'separator'
  face: 'a' | 'b'
  t0: number
  t1: number
}
export type ExteriorBoundarySpan = Omit<BoundarySpan, 'roomId'> & { roomId: null }
export type LevelFootprintContext = {
  revision: number
  walls: ReadonlyMap<string, WallNode>
  wallFootprints: ReadonlyMap<string, Ring>
}
export type TopologyRoom = {
  id: string
  polygon: Ring
  holes: Ring[]
  spans: BoundarySpan[]
  context: LevelFootprintContext
}
export type LevelTopology = {
  revision: number
  rooms: TopologyRoom[]
  exteriorSpans: ExteriorBoundarySpan[]
  spansByBoundary: ReadonlyMap<string, BoundarySpan[]>
}

type SceneNodes = Record<string, any>
type Point = [number, number]

type IndexedRoom = {
  id: string
  referencePolygon: Ring
  holes: Ring[]
  spans: BoundarySpan[]
  boundaryFaces: Array<{ wallId: WallNode['id'] }>
}

type IndexedLevelTopology<TRoom extends IndexedRoom> = {
  revision: number
  topology?: LevelTopology
  walls: Map<string, BoundaryNode>
  rooms: TRoom[]
  wallIdsByCell: Map<string, Set<string>>
  cellKeysByWallId: Map<string, string[]>
  cellEntries: number
  flat: boolean
}

export type IndexedTopologyDelta<TRoom extends IndexedRoom> = {
  strategy: 'indexed' | 'fallback'
  beforeRooms: TRoom[]
  currentRooms: TRoom[]
  allCurrentRooms: TRoom[]
  previousWalls: WallNode[]
  currentWalls: WallNode[]
  examinedWallIds: string[]
}

type RoomTopologyIndexOptions<TRoom extends IndexedRoom> = {
  includeSeparators?: boolean
  includeHoles?: boolean
  detectRooms: (walls: BoundaryNode[]) => TRoom[]
  sampleWall: (wall: BoundaryNode) => Point[]
  junctionTolerance: number
}

const CELL_SIZE = 2
const MAX_CELL_ENTRIES = 4096

function bboxOf(points: Point[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

function expandedBbox(box: ReturnType<typeof bboxOf>, margin: number) {
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
  }
}

function cellKeysForBbox(box: ReturnType<typeof bboxOf>) {
  const minX = Math.floor(box.minX / CELL_SIZE)
  const maxX = Math.floor(box.maxX / CELL_SIZE)
  const minY = Math.floor(box.minY / CELL_SIZE)
  const maxY = Math.floor(box.maxY / CELL_SIZE)
  // Unsafe integer coordinates can make x += 1 stall even for a tiny bbox.
  if (
    ![minX, maxX, minY, maxY].every(Number.isSafeInteger) ||
    (maxX - minX + 1) * (maxY - minY + 1) > MAX_CELL_ENTRIES
  )
    return null
  const keys: string[] = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      keys.push(`${x},${y}`)
    }
  }
  return keys
}

export function distanceToSegment(point: Point, segStart: Point, segEnd: Point) {
  const [px, py] = point
  const [x1, y1] = segStart
  const [x2, y2] = segEnd
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy

  if (lenSq < 0.0001) return Math.hypot(px - x1, py - y1)

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function roomUsesAnyWall(room: IndexedRoom, wallIds: ReadonlySet<string>) {
  return room.spans.some((span) => wallIds.has(span.boundaryId))
}

function sameIndexedWall(left: BoundaryNode | undefined, right: BoundaryNode | undefined) {
  if (!(left && right)) return left === right
  return (
    left.type === right.type &&
    left.parentId === right.parentId &&
    left.start[0] === right.start[0] &&
    left.start[1] === right.start[1] &&
    left.end[0] === right.end[0] &&
    left.end[1] === right.end[1] &&
    getClampedWallCurveOffset(left) === getClampedWallCurveOffset(right) &&
    (left.type === 'separator' ||
      (right.type === 'wall' &&
        left.thickness === right.thickness &&
        left.justification === right.justification))
  )
}

export class RoomTopologyIndex<TRoom extends IndexedRoom> {
  private readonly levels = new Map<string, IndexedLevelTopology<TRoom>>()
  private readonly queryMargin: number
  private readonly options: RoomTopologyIndexOptions<TRoom>
  private revision = 0

  constructor(options: RoomTopologyIndexOptions<TRoom>) {
    this.options = options
    this.queryMargin = Math.max(options.junctionTolerance, TEE_REACH) + 0.02
  }

  rebuild(nodes: SceneNodes) {
    this.levels.clear()
    const wallsByLevel = new Map<string, BoundaryNode[]>()
    for (const node of Object.values(nodes)) {
      if (!(this.isBoundary(node) && node.parentId)) continue
      const walls = wallsByLevel.get(node.parentId) ?? []
      walls.push(node)
      wallsByLevel.set(node.parentId, walls)
    }
    for (const [levelId, walls] of wallsByLevel) {
      this.levels.set(levelId, this.createLevel(walls))
    }
  }

  rebuildLevel(levelId: string, nodes: SceneNodes) {
    const level = this.createLevel(this.wallsForLevel(nodes, levelId))
    this.levels.set(levelId, level)
    return level
  }

  applyWallDelta(
    levelId: string,
    changedWallIds: ReadonlySet<string>,
    beforeNodes: SceneNodes,
    currentNodes: SceneNodes,
  ): IndexedTopologyDelta<TRoom> {
    let strategy: IndexedTopologyDelta<TRoom>['strategy'] = 'indexed'
    let level = this.levels.get(levelId)
    if (!level) {
      level = this.rebuildLevel(levelId, beforeNodes)
      strategy = 'fallback'
    }
    for (const wallId of changedWallIds) {
      const cached = level.walls.get(wallId)
      const previous = beforeNodes[wallId]
      const previousWall =
        this.isBoundary(previous) && previous.parentId === levelId ? previous : undefined
      if (!sameIndexedWall(cached, previousWall)) {
        level = this.rebuildLevel(levelId, beforeNodes)
        strategy = 'fallback'
        break
      }
    }

    const beforeComponentIds = this.connectedWallIds(level, changedWallIds)
    for (const wallId of changedWallIds) {
      const current = currentNodes[wallId]
      if (this.isBoundary(current) && current.parentId === levelId) {
        this.setWall(level, current)
      } else {
        this.removeWall(level, wallId)
      }
    }
    const currentSeedIds = new Set<string>(changedWallIds)
    for (const wallId of beforeComponentIds) {
      if (level.walls.has(wallId)) currentSeedIds.add(wallId)
    }
    const currentComponentIds = this.connectedWallIds(level, currentSeedIds)
    const examinedIds = new Set([...changedWallIds, ...beforeComponentIds, ...currentComponentIds])
    const beforeRooms = level.rooms.filter((room) => roomUsesAnyWall(room, examinedIds))
    const previousWalls = this.wallsFromNodes(beforeNodes, levelId, examinedIds)
    const currentWalls = this.wallsFromNodes(currentNodes, levelId, examinedIds)
    const currentRooms = this.options.detectRooms(
      [...examinedIds].flatMap((id) => {
        const boundary = level.walls.get(id)
        return boundary ? [boundary] : []
      }),
    )
    const allCurrentRooms = [
      ...level.rooms.filter((room) => !roomUsesAnyWall(room, examinedIds)),
      ...currentRooms,
    ]
    level.rooms = allCurrentRooms
    level.revision = ++this.revision
    level.topology = undefined

    return {
      strategy,
      beforeRooms,
      currentRooms,
      allCurrentRooms,
      previousWalls,
      currentWalls,
      examinedWallIds: [...examinedIds].sort(),
    }
  }

  private isBoundary(node: any): node is BoundaryNode {
    return (
      node?.type === 'wall' ||
      (this.options.includeSeparators !== false && node?.type === 'separator')
    )
  }

  getLevelTopology(levelId: string): LevelTopology | undefined {
    const level = this.levels.get(levelId)
    if (!level) return
    if (level.topology) return level.topology
    const walls = [...level.walls.values()].filter((node): node is WallNode => node.type === 'wall')
    const miters = calculateLevelMiters(walls)
    const context: LevelFootprintContext = {
      revision: level.revision,
      walls: new Map(walls.map((wall) => [wall.id, wall])),
      wallFootprints: new Map(
        walls.map((wall) => [
          wall.id,
          getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
        ]),
      ),
    }
    const rooms = level.rooms
      .map(
        (room): TopologyRoom => ({
          id: room.id,
          polygon: room.referencePolygon,
          holes: room.holes,
          spans: room.spans,
          context,
        }),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
    const spansByBoundary = new Map<string, BoundarySpan[]>()
    for (const room of rooms) {
      for (const span of room.spans) {
        const spans = spansByBoundary.get(span.boundaryId) ?? []
        spans.push(span)
        spansByBoundary.set(span.boundaryId, spans)
      }
    }
    const exteriorSpans: ExteriorBoundarySpan[] = []
    for (const boundary of [...level.walls.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (boundary.start[0] === boundary.end[0] && boundary.start[1] === boundary.end[1]) continue
      const spans = spansByBoundary.get(boundary.id) ?? []
      spans.sort(
        (a, b) => a.face.localeCompare(b.face) || a.t0 - b.t0 || a.roomId.localeCompare(b.roomId),
      )
      const cuts = [...new Set([0, 1, ...spans.flatMap((span) => [span.t0, span.t1])])].sort(
        (a, b) => a - b,
      )
      for (const face of ['a', 'b'] as const) {
        for (let i = 0; i < cuts.length - 1; i++) {
          const t0 = cuts[i]!,
            t1 = cuts[i + 1]!
          const mid = (t0 + t1) / 2
          if (!spans.some((span) => span.face === face && span.t0 <= mid && mid < span.t1)) {
            exteriorSpans.push({
              roomId: null,
              boundaryId: boundary.id,
              kind: boundary.type,
              face,
              t0,
              t1,
            })
          }
        }
      }
    }
    level.topology = { revision: level.revision, rooms, exteriorSpans, spansByBoundary }
    return level.topology
  }

  spansForWall(levelId: string, wallId: string): readonly BoundarySpan[] {
    return this.getLevelTopology(levelId)?.spansByBoundary.get(wallId) ?? []
  }

  roomAtPoint(levelId: string, point: Point): TopologyRoom | null {
    return (
      this.getLevelTopology(levelId)?.rooms.find((room) =>
        containsPoint([{ outer: room.polygon, holes: room.holes }], point),
      ) ?? null
    )
  }

  /** At a junction, intervals own their start; the final interval also owns t=1. */
  roomForWallHit(levelId: string, wallId: string, face: 'a' | 'b', t: number): TopologyRoom | null {
    const topology = this.getLevelTopology(levelId)
    const span = topology?.spansByBoundary
      .get(wallId)
      ?.find(
        (candidate) =>
          candidate.face === face &&
          t >= candidate.t0 &&
          (t < candidate.t1 || (t === 1 && candidate.t1 === 1)),
      )
    return topology?.rooms.find((room) => room.id === span?.roomId) ?? null
  }

  private wallsForLevel(nodes: SceneNodes, levelId: string) {
    const level = nodes[levelId]
    if (level?.type !== 'level') return []
    return level.children.flatMap((id: string) => {
      const node = nodes[id]
      return this.isBoundary(node) && node.parentId === levelId ? [node] : []
    })
  }

  private wallsFromNodes(nodes: SceneNodes, levelId: string, ids: ReadonlySet<string>) {
    return [...ids].flatMap((wallId) => {
      const node = nodes[wallId]
      return node?.type === 'wall' && node.parentId === levelId ? [node as WallNode] : []
    })
  }

  private createLevel(walls: BoundaryNode[]): IndexedLevelTopology<TRoom> {
    const level: IndexedLevelTopology<TRoom> = {
      revision: ++this.revision,
      walls: new Map(),
      rooms: this.options.detectRooms(walls),
      wallIdsByCell: new Map(),
      cellKeysByWallId: new Map(),
      cellEntries: 0,
      flat: false,
    }
    for (const wall of walls) this.setWall(level, wall)
    return level
  }

  private wallBbox(wall: BoundaryNode) {
    return bboxOf(this.options.sampleWall(wall))
  }

  private cellKeysForWall(wall: BoundaryNode) {
    return cellKeysForBbox(expandedBbox(this.wallBbox(wall), this.queryMargin))
  }

  private removeWall(level: IndexedLevelTopology<TRoom>, wallId: string) {
    level.cellEntries -= level.cellKeysByWallId.get(wallId)?.length ?? 0
    for (const key of level.cellKeysByWallId.get(wallId) ?? []) {
      const ids = level.wallIdsByCell.get(key)
      ids?.delete(wallId)
      if (ids?.size === 0) level.wallIdsByCell.delete(key)
    }
    level.cellKeysByWallId.delete(wallId)
    level.walls.delete(wallId)
  }

  private setWall(level: IndexedLevelTopology<TRoom>, wall: BoundaryNode) {
    this.removeWall(level, wall.id)
    level.walls.set(wall.id, wall)
    if (level.flat) return
    const keys = this.cellKeysForWall(wall)
    if (!keys || level.cellEntries + keys.length > MAX_CELL_ENTRIES) {
      level.flat = true
      level.wallIdsByCell.clear()
      level.cellKeysByWallId.clear()
      level.cellEntries = 0
      return
    }
    level.cellEntries += keys.length
    level.cellKeysByWallId.set(wall.id, keys)
    for (const key of keys) {
      const ids = level.wallIdsByCell.get(key) ?? new Set<string>()
      ids.add(wall.id)
      level.wallIdsByCell.set(key, ids)
    }
  }

  private queryWalls(level: IndexedLevelTopology<TRoom>, wall: BoundaryNode) {
    if (level.flat) return new Set(level.walls.keys())
    const keys = this.cellKeysForWall(wall)
    if (!keys) return new Set(level.walls.keys())
    const ids = new Set<string>()
    for (const key of keys) {
      for (const id of level.wallIdsByCell.get(key) ?? []) ids.add(id)
    }
    return ids
  }

  private wallsTouch(left: BoundaryNode, right: BoundaryNode) {
    const leftPoints = this.options.sampleWall(left)
    const rightPoints = this.options.sampleWall(right)
    // Detection joins a wall end to another wall's body as far as the bodies can touch.
    const reach = Math.max(this.options.junctionTolerance, junctionReach(left, right))
    const touchesPolyline = (points: Point[], other: Point[]) => {
      const endpoints = [points[0], points.at(-1)].filter((point): point is Point => Boolean(point))
      for (const endpoint of endpoints) {
        for (let index = 0; index < other.length - 1; index += 1) {
          if (distanceToSegment(endpoint, other[index]!, other[index + 1]!) <= reach) {
            return true
          }
        }
      }
      return false
    }
    // Crossing walls share a component too: detection declines near-miss joins on a
    // wall that crosses another, so an incremental rebuild must see the same crossing.
    return (
      touchesPolyline(leftPoints, rightPoints) ||
      touchesPolyline(rightPoints, leftPoints) ||
      boundariesCross(left, right)
    )
  }

  private connectedWallIds(level: IndexedLevelTopology<TRoom>, seedIds: Iterable<string>) {
    const connected = new Set<string>()
    const queue = [...seedIds]
    do {
      while (queue.length > 0) {
        const wallId = queue.pop()!
        if (connected.has(wallId)) continue
        const wall = level.walls.get(wallId)
        if (!wall) continue
        connected.add(wallId)
        for (const neighborId of this.queryWalls(level, wall)) {
          if (connected.has(neighborId)) continue
          const neighbor = level.walls.get(neighborId)
          if (neighbor && this.wallsTouch(wall, neighbor)) queue.push(neighborId)
        }
      }
      if (this.options.includeHoles === false || !connected.size) break
      // Disconnected enclosures still share a face. Bounds conservatively expand
      // the affected component; extraction decides actual containment by booleans.
      const bounds = bboxOf(
        [...connected].flatMap((id) => this.options.sampleWall(level.walls.get(id)!)),
      )
      for (const room of level.rooms) {
        const box = bboxOf(room.referencePolygon)
        if (
          box.minX > bounds.maxX ||
          box.maxX < bounds.minX ||
          box.minY > bounds.maxY ||
          box.maxY < bounds.minY
        )
          continue
        for (const span of room.spans) {
          if (!connected.has(span.boundaryId) && level.walls.has(span.boundaryId))
            queue.push(span.boundaryId)
        }
      }
    } while (queue.length > 0)
    return connected
  }
}
