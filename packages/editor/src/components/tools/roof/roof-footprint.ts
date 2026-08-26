import {
  type AnyNode,
  detectSpacesForLevel,
  emitter,
  getLevelBelow,
  getLevelElevations,
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
  isCurvedWall,
  type LevelNode,
  pointInPolygon2D,
  type RoofType,
  resolveLevelId,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'

export type RoofFootprintSource = 'room' | 'walls' | 'draw'

export type RoofFootprintTarget = {
  id: string
  polygon: Array<[number, number]>
  wallIds: WallNode['id'][]
  center: [number, number]
  width: number
  depth: number
  rotation: number
  rectangular: boolean
}

export function parseRoofFootprintSource(value: unknown, roofType: RoofType): RoofFootprintSource {
  if (value === 'draw') return 'draw'
  return roofType === 'conical' ? 'walls' : 'room'
}

export function subscribeToConicalRoofWallClicks(options: {
  footprintSource: RoofFootprintSource
  onPreview?: (wall: WallNode | null) => void
  onSelect: (wall: WallNode) => void
  roofType: RoofType
}): () => void {
  if (!(options.roofType === 'conical' && options.footprintSource === 'walls')) return () => {}

  let previewedWallId: WallNode['id'] | null = null
  const onWallHover = (event: WallEvent) => {
    const wall = isCurvedWall(event.node) ? event.node : null
    const nextId = wall?.id ?? null
    if (nextId === previewedWallId) return
    previewedWallId = nextId
    options.onPreview?.(wall)
  }
  const onWallLeave = (event: WallEvent) => {
    if (event.node.id !== previewedWallId) return
    previewedWallId = null
    options.onPreview?.(null)
  }
  const onWallClick = (event: WallEvent) => {
    if (!isCurvedWall(event.node)) return
    event.stopPropagation()
    options.onSelect(event.node)
  }
  emitter.on('wall:enter', onWallHover)
  emitter.on('wall:move', onWallHover)
  emitter.on('wall:leave', onWallLeave)
  emitter.on('wall:click', onWallClick)
  return () => {
    emitter.off('wall:enter', onWallHover)
    emitter.off('wall:move', onWallHover)
    emitter.off('wall:leave', onWallLeave)
    emitter.off('wall:click', onWallClick)
  }
}

function polygonArea(polygon: ReadonlyArray<readonly [number, number]>): number {
  return Math.abs(
    polygon.reduce((area, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? area + point[0] * next[1] - next[0] * point[1] : area
    }, 0) / 2,
  )
}

export function fitRoofFootprint(
  id: string,
  polygon: Array<[number, number]>,
  wallIds: WallNode['id'][],
): RoofFootprintTarget | null {
  if (polygon.length < 3) return null

  let best:
    | {
        center: [number, number]
        width: number
        depth: number
        rotation: number
        area: number
      }
    | undefined

  for (let index = 0; index < polygon.length; index++) {
    const point = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    if (!(point && next)) continue
    const rotation = Math.atan2(next[1] - point[1], next[0] - point[0])
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const rotated = polygon.map(([x, z]) => [x * cos + z * sin, -x * sin + z * cos] as const)
    const xs = rotated.map(([x]) => x)
    const zs = rotated.map(([, z]) => z)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)
    const width = maxX - minX
    const depth = maxZ - minZ
    const area = width * depth
    if (area <= 0 || (best && best.area <= area)) continue
    const localCenterX = (minX + maxX) / 2
    const localCenterZ = (minZ + maxZ) / 2
    best = {
      center: [localCenterX * cos - localCenterZ * sin, localCenterX * sin + localCenterZ * cos],
      width,
      depth,
      rotation: -rotation,
      area,
    }
  }

  if (!best) return null
  return {
    id,
    polygon,
    wallIds,
    center: best.center,
    width: best.width,
    depth: best.depth,
    rotation: best.rotation,
    rectangular: polygonArea(polygon) / best.area >= 0.96,
  }
}

export function resolveRoomRoofFootprint(
  levelId: LevelNode['id'],
  nodes: Readonly<Record<string, AnyNode>>,
  point: [number, number],
): RoofFootprintTarget | null {
  const activeTarget = resolveRoomRoofFootprintOnLevel(levelId, nodes, point)
  if (activeTarget) return activeTarget
  const levelBelow = getLevelBelow(levelId, nodes as Record<string, AnyNode>)
  return levelBelow ? resolveRoomRoofFootprintOnLevel(levelBelow.id, nodes, point) : null
}

export function resolveRoofFootprintElevation(
  targetLevelId: LevelNode['id'],
  target: RoofFootprintTarget,
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  const completeNodes = nodes as Record<string, AnyNode>
  const elevations = getLevelElevations(completeNodes)
  return Math.max(
    0,
    ...target.wallIds.map((id) => {
      const wall = nodes[id]
      return wall?.type === 'wall'
        ? resolveRoofWallTopElevation(targetLevelId, wall, completeNodes, elevations)
        : 0
    }),
  )
}

export function resolveRoofWallTopElevation(
  targetLevelId: LevelNode['id'],
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
  elevations = getLevelElevations(nodes as Record<string, AnyNode>),
): number {
  const completeNodes = nodes as Record<string, AnyNode>
  const sourceLevelY = elevations.get(resolveLevelId(wall, completeNodes))?.baseY ?? 0
  const targetLevelY = elevations.get(targetLevelId)?.baseY ?? 0
  return Math.max(
    0,
    sourceLevelY +
      getWallBaseElevationForNodes(wall, completeNodes) +
      getWallEffectiveHeightForNodes(wall, completeNodes) -
      targetLevelY,
  )
}

function resolveRoomRoofFootprintOnLevel(
  levelId: LevelNode['id'],
  nodes: Readonly<Record<string, AnyNode>>,
  point: [number, number],
): RoofFootprintTarget | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  const walls = level.children
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall')
  const spaces = detectSpacesForLevel(levelId, walls)
    .spaces.filter((space) => !space.isExterior && pointInPolygon2D(point, space.polygon))
    .sort((left, right) => polygonArea(left.polygon) - polygonArea(right.polygon))
  const space = spaces[0]
  return space ? fitRoofFootprint(space.id, space.polygon, space.wallIds) : null
}
