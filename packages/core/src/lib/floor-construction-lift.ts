import type { AnyNode, SlabNode } from '../schema'
import { sampleFenceCenterline } from '../systems/fence/fence-centerline'
import { getWallCurveFrameAt } from '../systems/wall/wall-curve'
import { footprintLift } from './floor-foundation-datum'
import { area, containsPoint, distanceToBoundary, intersection } from './polygon-boolean'

const memo = new WeakMap<object, WeakMap<object, number>>()

// Construction wholly inside a footprint keeps its authored ground-relative
// height. Deriving this translation avoids feeding lifted decks or ground-pinned
// walls back into the automatic datum that defines the footprint's lift.
export function floorConstructionLift(
  nodes: Readonly<Record<string, AnyNode>>,
  node: AnyNode,
): number {
  let cache = memo.get(nodes)
  if (!cache) {
    cache = new WeakMap()
    memo.set(nodes, cache)
  }
  const hit = cache.get(node)
  if (hit !== undefined) return hit
  let lift = 0
  for (const base of Object.values(nodes)) {
    if (
      base.type !== 'slab' ||
      base.plateRole !== 'base' ||
      base.floorHeight === undefined ||
      base.parentId !== node.parentId
    )
      continue
    const polygon = [{ outer: base.polygon, holes: [] }]
    const inside = (point: [number, number]) =>
      containsPoint(polygon, point) || distanceToBoundary(polygon, point) < 1e-6
    let covered = false
    if (node.type === 'slab')
      covered =
        area(intersection(polygon, node.polygon)) >=
        area([{ outer: node.polygon, holes: [] }]) - 1e-6
    else if (node.type === 'wall')
      covered = Array.from({ length: node.curveOffset ? 33 : 3 }, (_, i) => {
        const p = getWallCurveFrameAt(node, i / (node.curveOffset ? 32 : 2)).point
        return inside([p.x, p.y])
      }).every(Boolean)
    else if (node.type === 'fence')
      covered = sampleFenceCenterline(node, 64).every((point) => inside([point.x, point.y]))
    else if ('position' in node && Array.isArray(node.position))
      covered = inside([node.position[0], node.position[2]])
    if (covered) {
      lift = footprintLift(nodes, base)
      break
    }
  }
  cache.set(node, lift)
  return lift
}

export function liftedManualSlab(
  nodes: Readonly<Record<string, AnyNode>>,
  slab: SlabNode,
): SlabNode {
  if (slab.plateRole || slab.autoFromWalls || slab.boundary === 'auto') return slab
  const lift = floorConstructionLift(nodes, slab)
  return lift ? { ...slab, elevation: slab.elevation + lift } : slab
}
