import { containsPoint, type Ring } from '../../lib/polygon-boolean'
import type { AnyNode, ItemNode, ZoneNode } from '../../schema'
import type { Prism } from './types'
import type { Nodes } from './walls'

/** What a person puts in a room and walks around: items, cabinets, columns, shelves. */
const PIECE_KINDS = new Set<string>(['item', 'cabinet', 'column', 'shelf'])
export const isPiecePrism = (prism: Prism): boolean => PIECE_KINDS.has(prism.kind)

/** Foliage is a cloud of leaves: its bounds overlap by design, and it stands in front of walls. */
const FOLIAGE = /plant|palm|foliage|tree|shrub|hedge|grass|fern|flower|bouquet|vase of|landscape/i
/** Items that are part of the building (trim, soffits, cladding, piers, guards, beams, lights): they meet walls by design. */
const BUILDING_ELEMENT =
  /trim|fascia|soffit|cladding|cornice|surround|portal|railing|balustrade|guard|pier|beam|post\b|column|canopy|pergola|awning|downlight|light/i

export const textOf = (node: ItemNode) =>
  `${node.name ?? ''} ${node.asset?.name ?? ''} ${node.asset?.category ?? ''}`

export const isFoliageItem = (node: ItemNode): boolean => FOLIAGE.test(textOf(node))

export const isBuildingElementItem = (node: ItemNode): boolean =>
  BUILDING_ELEMENT.test(textOf(node))

/** What an item is called and filed under, or '' for a node that is not an item (a candidate not in the scene yet is passed as the item itself). */
export function itemText(nodes: Nodes, nodeId: string): string {
  const node = nodes[nodeId]
  return node?.type === 'item' ? textOf(node) : ''
}

export function isFoliage(nodes: Nodes, nodeId: string): boolean {
  const node = nodes[nodeId]
  return node?.type === 'item' && isFoliageItem(node)
}

export function isBuildingElement(nodes: Nodes, nodeId: string): boolean {
  const node = nodes[nodeId]
  return node?.type === 'item' && isBuildingElementItem(node)
}

export const isBed = (node: AnyNode | undefined): node is ItemNode =>
  node?.type === 'item' && node.asset?.category === 'bed'

/** Whether `ancestor` hosts `nodeId`, however many items deep (a lamp on a table on a rug). */
export function hosts(nodes: Nodes, ancestor: string, nodeId: string): boolean {
  let at = nodes[nodeId] as AnyNode | undefined
  for (let depth = 0; at && depth < 24; depth++) {
    if (at.id === ancestor) return at.id !== nodeId
    at = at.parentId ? (nodes[at.parentId] as AnyNode | undefined) : undefined
  }
  return false
}

/** The narrowest extent of some polygons, over 36 directions: how deep one shape sits in another. */
export function narrowestExtent(polygons: readonly { outer: Ring }[]): number {
  const points = polygons.flatMap((polygon) => polygon.outer)
  if (points.length < 3) return 0
  let narrowest = Number.POSITIVE_INFINITY
  for (let k = 0; k < 36; k++) {
    const angle = (k * Math.PI) / 36
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const [x, z] of points) {
      const t = x * c + z * s
      low = Math.min(low, t)
      high = Math.max(high, t)
    }
    narrowest = Math.min(narrowest, high - low)
  }
  return narrowest
}

export const ringBox = (ring: Ring): [number, number, number, number] => {
  let x0 = Number.POSITIVE_INFINITY
  let z0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let z1 = Number.NEGATIVE_INFINITY
  for (const [x, z] of ring) {
    x0 = Math.min(x0, x)
    z0 = Math.min(z0, z)
    x1 = Math.max(x1, x)
    z1 = Math.max(z1, z)
  }
  return [x0, z0, x1, z1]
}

export const boxesMeet = (a: readonly number[], b: readonly number[], pad = 0): boolean =>
  !(a[2]! + pad < b[0]! || b[2]! + pad < a[0]! || a[3]! + pad < b[1]! || b[3]! + pad < a[1]!)

/** The room (zone) of a level that holds a point: the smallest when rooms overlap. */
export function roomAt(
  nodes: Nodes,
  levelId: string,
  point: [number, number],
): { id: string; name: string } | null {
  let best: { id: string; name: string; size: number } | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || node.parentId !== levelId) continue
    const zone = node as ZoneNode
    if (
      !containsPoint([{ outer: zone.polygon as Ring, holes: (zone.holes ?? []) as Ring[] }], point)
    )
      continue
    const ring = zone.polygon as Ring
    const size = Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length]!
        return sum + (p[0] * q[1] - q[0] * p[1])
      }, 0) / 2,
    )
    if (!best || size < best.size) best = { id: zone.id, name: String(zone.name ?? zone.id), size }
  }
  return best ? { id: best.id, name: best.name } : null
}
