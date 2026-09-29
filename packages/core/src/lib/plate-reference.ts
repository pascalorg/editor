import { proceduralFootprint } from '../procedural-items/query'
import type { AnyNode, SlabNode } from '../schema'
import { getFenceCenterlineFrameAt } from '../systems/fence/fence-centerline'
import { getStairFloorPlacedFootprints } from '../systems/stair/stair-floor-footprints'
import { stairArrivalOpening } from '../systems/stair/stair-footprint'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { planFootprintCorners } from './plan-footprint'
import {
  area,
  containsPoint,
  intersection,
  type MultiPolygon,
  type Ring,
  union,
} from './polygon-boolean'

export function replacementPlateFor(
  node: AnyNode,
  field: 'supportSlabId' | 'deckSlabId',
  plates: readonly SlabNode[],
  nodes: Readonly<Record<string, AnyNode>>,
): string | undefined {
  let footprint: Ring | MultiPolygon = []
  let point: [number, number] | undefined
  if (field === 'deckSlabId' && node.type === 'stair') {
    if (!node.position || !node.children) return undefined
    const arrival = stairArrivalOpening(node, nodes)
    if (arrival.length)
      point = [
        arrival.reduce((s, p) => s + p[0], 0) / arrival.length,
        arrival.reduce((s, p) => s + p[1], 0) / arrival.length,
      ]
  } else if (node.type === 'item') {
    footprint = planFootprintCorners(
      node.position,
      node.asset.dimensions.map((v, i) => v * node.scale[i]!) as [number, number, number],
      node.rotation[1],
    )
  } else if (node.type === 'procedural-item') {
    const box = proceduralFootprint(node)
    footprint = planFootprintCorners(box.position, box.dimensions, box.rotation[1])
  } else if (node.type === 'stair') {
    footprint = union(
      getStairFloorPlacedFootprints(node, nodes).map((box) =>
        planFootprintCorners(box.position ?? node.position, box.dimensions, box.rotation[1]),
      ),
    )
  } else if (node.type === 'block') {
    const positions = node.topology.vertices.map((vertex) => vertex.position)
    if (positions.length) {
      const minX = Math.min(...positions.map((p) => p[0])),
        maxX = Math.max(...positions.map((p) => p[0]))
      const minZ = Math.min(...positions.map((p) => p[2])),
        maxZ = Math.max(...positions.map((p) => p[2]))
      const x = (minX + maxX) / 2,
        z = (minZ + maxZ) / 2
      footprint = planFootprintCorners(
        [
          node.position[0] + x * Math.cos(node.rotation) + z * Math.sin(node.rotation),
          node.position[1],
          node.position[2] - x * Math.sin(node.rotation) + z * Math.cos(node.rotation),
        ],
        [maxX - minX, 0, maxZ - minZ],
        node.rotation,
      )
    }
  } else if (node.type === 'fence') {
    const sides = [1, -1].map((sign) =>
      Array.from({ length: 97 }, (_, i): [number, number] => {
        const frame = getFenceCenterlineFrameAt(node, i / 96)
        return [
          frame.point.x + (sign * frame.normal.x * node.thickness) / 2,
          frame.point.y + (sign * frame.normal.y * node.thickness) / 2,
        ]
      }),
    )
    footprint = [...sides[0]!, ...sides[1]!.reverse()]
  } else if (node.type === 'wall') {
    const walls = Object.values(nodes).filter(
      (candidate): candidate is typeof node =>
        candidate.type === 'wall' && candidate.parentId === node.parentId,
    )
    footprint = getWallPlanFootprint(node, calculateLevelMiters(walls)).map(
      (point): [number, number] => [point.x, point.y],
    )
  } else if ('polygon' in node && Array.isArray(node.polygon)) footprint = node.polygon as Ring
  else if ('position' in node && Array.isArray(node.position)) {
    const rotation =
      'rotation' in node ? (Array.isArray(node.rotation) ? node.rotation[1] : node.rotation) : 0
    if (
      'width' in node &&
      'depth' in node &&
      typeof node.width === 'number' &&
      typeof node.depth === 'number'
    )
      footprint = planFootprintCorners(
        node.position as [number, number, number],
        [node.width, 0, node.depth],
        typeof rotation === 'number' ? rotation : 0,
      )
    else point = [node.position[0], node.position[2]]
  }
  return plates
    .filter(
      (plate) =>
        plate.parentId ===
          (field === 'deckSlabId' && 'deckSlabId' in node
            ? (nodes[node.deckSlabId ?? '']?.parentId ?? node.parentId)
            : node.parentId) &&
        (node.type !== 'wall' ||
          (plate.support !== 'open' &&
            plate.plateRole !== 'platform' &&
            plate.plateRole !== 'sunken')),
    )
    .map((plate) => ({
      plate,
      overlap: point
        ? Number(containsPoint([{ outer: plate.polygon, holes: plate.holes }], point))
        : footprint.length
          ? area(intersection(footprint, { outer: plate.polygon, holes: plate.holes }))
          : 0,
    }))
    .filter((p) => p.overlap > 0)
    .sort(
      (a, b) =>
        b.plate.elevation - a.plate.elevation ||
        b.overlap - a.overlap ||
        a.plate.id.localeCompare(b.plate.id),
    )[0]?.plate.id
}
