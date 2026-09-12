import { pointInPolygon as pointInPolygon2D } from '../../lib/polygon-relations'
import { detectSpacesForLevel } from '../../lib/space-detection'
import type { AnyNode, LevelNode, WallNode } from '../../schema'
import { getLevelBelow } from '../../services/storey'

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
  options: { rectangularOnly?: boolean } = {},
): RoofFootprintTarget | null {
  const activeTarget = resolveRoomRoofFootprintOnLevel(levelId, nodes, point)
  if (activeTarget && (!options.rectangularOnly || activeTarget.rectangular)) return activeTarget
  if (activeTarget) return null
  const levelBelow = getLevelBelow(levelId, nodes as Record<string, AnyNode>)
  const levelBelowTarget = levelBelow
    ? resolveRoomRoofFootprintOnLevel(levelBelow.id, nodes, point)
    : null
  return levelBelowTarget && (!options.rectangularOnly || levelBelowTarget.rectangular)
    ? levelBelowTarget
    : null
}

export function resolveRoomRoofFootprintOnLevel(
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
