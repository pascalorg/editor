import { getFloorPlacedFootprints } from '../../hooks/spatial-grid/floor-placed-footprints'
import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { resolvedFootprintPlane } from '../../lib/floor-foundation-datum'
import { itemOverlapsPolygon } from '../../lib/item-polygon-overlap'
import { area, difference } from '../../lib/polygon-boolean'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import type { ProceduralItemNode } from '../../procedural-items/node'
import { proceduralFootprint } from '../../procedural-items/query'
import { nodeRegistry } from '../../registry'
import type { FloorPlacedFootprint } from '../../registry/types'
import {
  type AnyNode,
  getScaledDimensions,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '../../schema'
import { getStoredLevelHeight } from '../../services/storey'
import { isDerivedNode } from '../../store/derived-node-guard'
import { pointInPolygon } from '../../systems/slab/slab-support'
import { getStairFloorPlacedFootprints } from '../../systems/stair/stair-floor-footprints'
import { roomFace, type StructureNodes } from './shared'

export type PositionedIntent = AnyNode & {
  position: [number, number, number]
  rotation: number | [number, number, number]
  supportSlabId?: string
}

export function isFloorPlacedIntent(node: AnyNode): node is PositionedIntent {
  if (isDerivedNode(node) || !('position' in node) || !Array.isArray(node.position)) return false
  const definition = nodeRegistry.get(node.type)
  if (definition) {
    const capability = definition.capabilities?.floorPlaced
    return !!capability && (!capability.applies || capability.applies(node))
  }
  // Headless authorities do not load renderer definitions.
  if (node.type === 'item') return !node.asset.attachTo
  if (node.type === 'procedural-item')
    return !(node as unknown as ProceduralItemNode).recipe.mounting
  if (node.type === 'duct-terminal') return node.mount === 'floor'
  return [
    'cabinet',
    'cabinet-module',
    'shelf',
    'stair',
    'column',
    'block',
    'spawn',
    'hvac-equipment',
  ].includes(node.type)
}

export function containedMezzanines(nodes: StructureNodes, host: ZoneNode): ZoneNode[] {
  if (host.floor?.support === 'open') return []
  const face = roomFace(nodes, host)
  const footprint = {
    outer: face?.referencePolygon ?? host.polygon,
    holes: face?.holes ?? host.holes,
  }
  return Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.floor?.support === 'open' &&
      node.parentId === host.parentId &&
      area(difference({ outer: node.polygon, holes: node.holes }, footprint)) <= 1e-6,
  )
}

export function mezzanineElevationConflict(nodes: StructureNodes, zone: ZoneNode) {
  const level = zone.parentId ? nodes[zone.parentId] : undefined
  const thickness = zone.floor?.thickness ?? 0.2
  const elevation = zone.floor?.elevation
  const maximum =
    level?.type === 'level'
      ? resolvedFootprintPlane(nodes, zone, getStoredLevelHeight(level)) - 0.3
      : 0
  return elevation === undefined ||
    !Number.isFinite(elevation) ||
    elevation <= thickness ||
    elevation > maximum
    ? {
        code: 'mezzanine-elevation',
        nodeIds: [zone.id],
        message: `Mezzanine elevation must be greater than thickness (${thickness} m) and at most ${maximum} m.`,
      }
    : undefined
}

export function electedIntentPlate(
  nodes: StructureNodes,
  node: PositionedIntent,
): SlabNode | undefined {
  if (node.supportSlabId === GROUND_SUPPORT_ID) return undefined
  const capability = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  const rotation: [number, number, number] = Array.isArray(node.rotation)
    ? node.rotation
    : [0, node.rotation, 0]
  const dimensions: [number, number, number] =
    node.type === 'item'
      ? getScaledDimensions(node)
      : [
          'width' in node && typeof node.width === 'number' ? node.width : 0.6,
          1,
          'depth' in node && typeof node.depth === 'number' ? node.depth : 0.6,
        ]
  const footprints: FloorPlacedFootprint[] = capability
    ? getFloorPlacedFootprints(capability, node, { nodes })
    : node.type === 'stair'
      ? getStairFloorPlacedFootprints(node, nodes)
      : node.type === 'procedural-item'
        ? [proceduralFootprint(node as unknown as ProceduralItemNode)]
        : [{ dimensions, rotation }]
  const siblings = Object.values(nodes).filter((n) => n.parentId === node.parentId)
  const slabs = siblings.filter((n): n is SlabNode => n.type === 'slab')
  const walls = siblings.filter((n): n is WallNode => n.type === 'wall')
  const supported = slabs.filter((slab) => {
    const polygon = getRenderableSlabPolygon(slab, {
      walls,
      siblingSlabs: slabs.filter((n) => n.id !== slab.id),
    })
    return footprints.some((footprint) => {
      const position = footprint.position ?? node.position
      return (
        itemOverlapsPolygon(position, footprint.dimensions, footprint.rotation, polygon, 0.01) &&
        !slab.holes.some((hole) => pointInPolygon(position[0], position[2], hole))
      )
    })
  })
  return (
    supported.find((slab) => slab.id === node.supportSlabId) ??
    supported.sort((a, b) => b.elevation - a.elevation)[0]
  )
}
