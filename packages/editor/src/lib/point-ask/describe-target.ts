import {
  type AnyNode,
  area,
  getScaledDimensions,
  getWallCurveLength,
  getWallEffectiveHeightForNodes,
  getWallThickness,
  type ItemNode,
  resolveLevelId,
  type SlabNode,
  type StairNode,
  type WallNode,
  type WindowNode,
  type ZoneNode,
} from '@pascal-app/core'
import {
  formatLinearMeasurement,
  getAreaUnitLabel,
  type LinearUnit,
  type MetricNotation,
  squareMetersToAreaUnit,
} from '../measurements'
import type { PointKind, PointTarget } from './types'

// Point and ask names what the finger is on (the owner, 8 October): the label chip and the
// bubble's context row read it in the viewer's unit; the agent reads the same element's `sizes` in
// metres. Pure: the scene is handed in.

export type PointUnit = { unit: LinearUnit; metricNotation?: MetricNotation }

/** A described element: the chip's fields, plus what the agent's context carries. */
export type DescribedTarget = PointTarget & {
  levelId: string
  /** The room it is in or bounds. */
  zoneId?: string
  /** The wall an opening is in, the item an item stands on. */
  parentId?: string
  /** Metres: wall {length, height, thickness}; zone {area, width, depth}; window/door {width,
   *  height, sill}; item {width, depth, height}. */
  sizes: Record<string, number>
}

type Nodes = Readonly<Record<string, AnyNode | undefined>>

const KINDS: Partial<Record<string, PointKind>> = {
  zone: 'room',
  wall: 'wall',
  window: 'window',
  door: 'door',
  item: 'item',
  roof: 'roof',
  'roof-segment': 'roof',
  stair: 'stair',
  'stair-segment': 'stair',
}

const DEFAULT_NAMES: Partial<Record<string, string>> = {
  slab: 'Floor',
  ceiling: 'Ceiling',
}

const sentence = (type: string) => {
  const words = type.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const metres = (value: number, unit: PointUnit) => {
  if (unit.unit === 'imperial') return formatLinearMeasurement(value, 'imperial')
  return unit.metricNotation === 'millimeters' ? `${Math.round(value * 1000)}` : value.toFixed(2)
}

/** "4.80 × 2.70 m", "3'11" × 4'7"", "1200 × 1400 mm". */
function dimensions(values: number[], unit: PointUnit): string {
  const parts = values.map((value) => metres(value, unit)).join(' × ')
  if (unit.unit === 'imperial') return parts
  return `${parts} ${unit.metricNotation === 'millimeters' ? 'mm' : 'm'}`
}

/** "2.10 m wide". */
function wide(value: number, unit: PointUnit): string {
  return `${dimensions([value], unit)} wide`
}

function areaLabel(squareMetres: number, unit: PointUnit): string {
  return `${squareMetersToAreaUnit(squareMetres, unit.unit).toFixed(1)} ${getAreaUnitLabel(unit.unit)}`
}

function extent(points: readonly (readonly number[])[], axis: 0 | 1): number {
  const values = points.map((point) => point[axis]!)
  return values.length ? Math.max(...values) - Math.min(...values) : 0
}

function insidePolygon(point: readonly [number, number], polygon: readonly (readonly number[])[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = [polygon[i]![0]!, polygon[i]![1]!]
    const [xj, zj] = [polygon[j]![0]!, polygon[j]![1]!]
    if (
      zi > point[1] !== zj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi
    )
      inside = !inside
  }
  return inside
}

const zonesOf = (nodes: Nodes, levelId: string) =>
  Object.values(nodes).filter(
    (node): node is ZoneNode => node?.type === 'zone' && node.parentId === levelId,
  )

/** The room a wall bounds: the zone that lists it among its boundary walls. */
const roomOfWall = (nodes: Nodes, levelId: string, wallId: string) =>
  zonesOf(nodes, levelId).find((zone) => zone.boundaryWallIds?.includes(wallId as never))

function wallHeight(wall: WallNode, nodes: Nodes): number {
  try {
    const height = getWallEffectiveHeightForNodes(wall, nodes as Record<string, AnyNode>)
    if (Number.isFinite(height) && height > 0) return height
  } catch {
    // No slab election to consult in a bare scene: the wall's own height stands.
  }
  return wall.height ?? 2.5
}

export function describeTarget(node: AnyNode, nodes: Nodes, unit: PointUnit): DescribedTarget {
  const levelId = resolveLevelId(node, nodes as Record<string, AnyNode>)
  const named = (fallback: string) => (node as { name?: string }).name?.trim() || fallback
  const base = {
    id: node.id,
    type: node.type,
    kind: KINDS[node.type] ?? ('other' as PointKind),
    levelId,
  }

  if (node.type === 'zone') {
    const zone = node as ZoneNode
    const squareMetres = area([{ outer: zone.polygon, holes: zone.holes }])
    return {
      ...base,
      name: named('Room'),
      size: areaLabel(squareMetres, unit),
      sizes: {
        area: squareMetres,
        width: extent(zone.polygon, 0),
        depth: extent(zone.polygon, 1),
      },
    }
  }

  if (node.type === 'wall') {
    const wall = node as WallNode
    const room = roomOfWall(nodes, levelId, wall.id)
    const length = getWallCurveLength(wall)
    const height = wallHeight(wall, nodes)
    return {
      ...base,
      name: named(room ? `Wall · ${room.name?.trim() || 'Room'}` : 'Wall'),
      size: dimensions([length, height], unit),
      sizes: { length, height, thickness: getWallThickness(wall) },
      ...(room ? { zoneId: room.id } : {}),
    }
  }

  if (node.type === 'window' || node.type === 'door') {
    const opening = node as WindowNode & { wallId?: string }
    const wallId = opening.wallId ?? opening.parentId ?? undefined
    const room = wallId ? roomOfWall(nodes, levelId, wallId) : undefined
    return {
      ...base,
      name: named(node.type === 'window' ? 'Window' : 'Door'),
      size: dimensions([opening.width, opening.height], unit),
      sizes: {
        width: opening.width,
        height: opening.height,
        sill: Math.max(0, opening.position[1] - opening.height / 2),
      },
      ...(opening.parentId ? { parentId: opening.parentId } : {}),
      ...(room ? { zoneId: room.id } : {}),
    }
  }

  if (node.type === 'item') {
    const item = node as ItemNode
    const [width, height, depth] = getScaledDimensions(item)
    const room = zonesOf(nodes, levelId).find((zone) =>
      insidePolygon([item.position[0], item.position[2]], zone.polygon),
    )
    const onItem = item.parentId && nodes[item.parentId]?.type === 'item'
    return {
      ...base,
      name: named(item.asset.name?.trim() || 'Item'),
      size: wide(width, unit),
      sizes: { width, depth, height },
      ...(onItem ? { parentId: item.parentId as string } : {}),
      ...(room ? { zoneId: room.id } : {}),
    }
  }

  if (node.type === 'roof-segment') {
    const { width, depth } = node as { width: number; depth: number }
    return {
      ...base,
      name: named('Roof segment'),
      size: dimensions([width, depth], unit),
      sizes: { width, depth },
    }
  }

  if (node.type === 'stair' || node.type === 'stair-segment') {
    const stair = node as StairNode
    const sizes: Record<string, number> = { width: stair.width ?? 1 }
    if (stair.totalRise !== undefined) sizes.rise = stair.totalRise
    return { ...base, name: named('Stair'), size: wide(sizes.width!, unit), sizes }
  }

  if (node.type === 'slab' || node.type === 'ceiling') {
    const plate = node as SlabNode
    const squareMetres = area([{ outer: plate.polygon, holes: [] }])
    return {
      ...base,
      name: named(DEFAULT_NAMES[node.type] ?? sentence(node.type)),
      size: areaLabel(squareMetres, unit),
      sizes: { area: squareMetres },
    }
  }

  return {
    ...base,
    name: named(DEFAULT_NAMES[node.type] ?? sentence(node.type)),
    size: '',
    sizes: {},
  }
}
