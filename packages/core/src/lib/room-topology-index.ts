import type { WallNode } from '../schema'
import { getClampedWallCurveOffset } from '../systems/wall/wall-curve'

type SceneNodes = Record<string, any>
type Point = [number, number]

type IndexedRoom = {
  boundaryFaces: Array<{ wallId: WallNode['id'] }>
}

type IndexedLevelTopology<TRoom extends IndexedRoom> = {
  walls: Map<string, WallNode>
  rooms: TRoom[]
  wallIdsByCell: Map<string, Set<string>>
  cellKeysByWallId: Map<string, string[]>
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
  detectRooms: (walls: WallNode[]) => TRoom[]
  sampleWall: (wall: WallNode) => Point[]
  junctionTolerance: number
}

const CELL_SIZE = 2

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
  const keys: string[] = []
  for (let x = Math.floor(box.minX / CELL_SIZE); x <= Math.floor(box.maxX / CELL_SIZE); x += 1) {
    for (let y = Math.floor(box.minY / CELL_SIZE); y <= Math.floor(box.maxY / CELL_SIZE); y += 1) {
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
  return room.boundaryFaces.some((boundary) => wallIds.has(boundary.wallId))
}

function sameIndexedWall(left: WallNode | undefined, right: WallNode | undefined) {
  if (!(left && right)) return left === right
  return (
    left.parentId === right.parentId &&
    left.start[0] === right.start[0] &&
    left.start[1] === right.start[1] &&
    left.end[0] === right.end[0] &&
    left.end[1] === right.end[1] &&
    getClampedWallCurveOffset(left) === getClampedWallCurveOffset(right)
  )
}

export class RoomTopologyIndex<TRoom extends IndexedRoom> {
  private readonly levels = new Map<string, IndexedLevelTopology<TRoom>>()
  private readonly queryMargin: number

  constructor(private readonly options: RoomTopologyIndexOptions<TRoom>) {
    this.queryMargin = options.junctionTolerance + 0.02
  }

  rebuild(nodes: SceneNodes) {
    this.levels.clear()
    const wallsByLevel = new Map<string, WallNode[]>()
    for (const node of Object.values(nodes)) {
      if (node?.type !== 'wall' || !node.parentId) continue
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
        previous?.type === 'wall' && previous.parentId === levelId ? previous : undefined
      if (!sameIndexedWall(cached, previousWall)) {
        level = this.rebuildLevel(levelId, beforeNodes)
        strategy = 'fallback'
        break
      }
    }

    const beforeComponentIds = this.connectedWallIds(level, changedWallIds)
    for (const wallId of changedWallIds) {
      const current = currentNodes[wallId]
      if (current?.type === 'wall' && current.parentId === levelId) {
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
    const currentRooms = this.options.detectRooms(currentWalls)
    const allCurrentRooms = [
      ...level.rooms.filter((room) => !roomUsesAnyWall(room, examinedIds)),
      ...currentRooms,
    ]
    level.rooms = allCurrentRooms

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

  private wallsForLevel(nodes: SceneNodes, levelId: string) {
    const level = nodes[levelId]
    if (level?.type !== 'level') return []
    return level.children.flatMap((id: string) => {
      const node = nodes[id]
      return node?.type === 'wall' && node.parentId === levelId ? [node as WallNode] : []
    })
  }

  private wallsFromNodes(nodes: SceneNodes, levelId: string, ids: ReadonlySet<string>) {
    return [...ids].flatMap((wallId) => {
      const node = nodes[wallId]
      return node?.type === 'wall' && node.parentId === levelId ? [node as WallNode] : []
    })
  }

  private createLevel(walls: WallNode[]): IndexedLevelTopology<TRoom> {
    const level: IndexedLevelTopology<TRoom> = {
      walls: new Map(),
      rooms: this.options.detectRooms(walls),
      wallIdsByCell: new Map(),
      cellKeysByWallId: new Map(),
    }
    for (const wall of walls) this.setWall(level, wall)
    return level
  }

  private wallBbox(wall: WallNode) {
    return bboxOf(this.options.sampleWall(wall))
  }

  private cellKeysForWall(wall: WallNode) {
    return cellKeysForBbox(expandedBbox(this.wallBbox(wall), this.queryMargin))
  }

  private removeWall(level: IndexedLevelTopology<TRoom>, wallId: string) {
    for (const key of level.cellKeysByWallId.get(wallId) ?? []) {
      const ids = level.wallIdsByCell.get(key)
      ids?.delete(wallId)
      if (ids?.size === 0) level.wallIdsByCell.delete(key)
    }
    level.cellKeysByWallId.delete(wallId)
    level.walls.delete(wallId)
  }

  private setWall(level: IndexedLevelTopology<TRoom>, wall: WallNode) {
    this.removeWall(level, wall.id)
    level.walls.set(wall.id, wall)
    const keys = this.cellKeysForWall(wall)
    level.cellKeysByWallId.set(wall.id, keys)
    for (const key of keys) {
      const ids = level.wallIdsByCell.get(key) ?? new Set<string>()
      ids.add(wall.id)
      level.wallIdsByCell.set(key, ids)
    }
  }

  private queryWalls(level: IndexedLevelTopology<TRoom>, wall: WallNode) {
    const ids = new Set<string>()
    for (const key of this.cellKeysForWall(wall)) {
      for (const id of level.wallIdsByCell.get(key) ?? []) ids.add(id)
    }
    return ids
  }

  private wallsTouch(left: WallNode, right: WallNode) {
    const leftPoints = this.options.sampleWall(left)
    const rightPoints = this.options.sampleWall(right)
    const touchesPolyline = (points: Point[], other: Point[]) => {
      const endpoints = [points[0], points.at(-1)].filter((point): point is Point => Boolean(point))
      for (const endpoint of endpoints) {
        for (let index = 0; index < other.length - 1; index += 1) {
          if (
            distanceToSegment(endpoint, other[index]!, other[index + 1]!) <=
            this.options.junctionTolerance
          ) {
            return true
          }
        }
      }
      return false
    }
    return touchesPolyline(leftPoints, rightPoints) || touchesPolyline(rightPoints, leftPoints)
  }

  private connectedWallIds(level: IndexedLevelTopology<TRoom>, seedIds: Iterable<string>) {
    const connected = new Set<string>()
    const queue = [...seedIds]
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
    return connected
  }
}
