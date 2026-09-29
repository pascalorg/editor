import {
  type AnyNode,
  type AnyNodeId,
  floorStepKeysOf,
  floorStepOverrideFor,
  floorStepRole,
  floorStepRoleCovers,
  parseCeilingRegionRole,
  parseFloorStepRole,
  parseRoomFinishRole,
  roomFinishRole,
  type SlabNode,
  type ZoneNode,
} from '@pascal-app/core'
import { create } from 'zustand'
import { roomFootprint } from './floor-footprints'

export type PaintSurface = { nodeId: AnyNodeId; role: string }

const isFloorPlate = (node: AnyNode | undefined): node is SlabNode =>
  node?.type === 'slab' && node.boundary === 'auto'

/**
 * Every floor-plate surface one paint click changes: the painted surface and
 * the surfaces whose finish falls back to it. A room's floor carries its steps
 * until they are painted on their own (room-wide or per doorway); the
 * footprint's edge band carries the edges of the rooms on it that have no edge
 * finish; a step paints its doorway, or in the room scope (`step:<zoneId>`)
 * every step of the room, wherever they are drawn. A region paint changes only
 * the region. The whole room (`room:<zoneId>/*`) paints its floor, its painted
 * parts and the steps that follow it; erased, it also clears its steps and edge.
 *
 * This set is the hover outline; `platePreviewSurfaces` previews it, so what
 * lights up is exactly what the click changes. Null for anything but a floor
 * plate.
 */
export function plateAffectedSurfaces(
  nodes: Readonly<Record<string, AnyNode>>,
  node: AnyNode,
  role: string,
  options: { erasing?: boolean } = {},
): PaintSurface[] | null {
  if (!isFloorPlate(node)) return null
  const plates = Object.values(nodes).filter(
    (other): other is SlabNode => isFloorPlate(other) && other.parentId === node.parentId,
  )
  const onEveryPlate = (paintRole: string) =>
    plates.map((plate) => ({ nodeId: plate.id as AnyNodeId, role: paintRole }))
  const zoneOf = (zoneId: string) => {
    const zone = nodes[zoneId]
    return zone?.type === 'zone' ? zone : null
  }
  // The room's steps that no doorway paint holds: the ones its floor carries.
  const followingSteps = (zone: ZoneNode) => {
    const zones = Object.values(nodes).filter(
      (other): other is ZoneNode => other.type === 'zone' && other.parentId === zone.parentId,
    )
    return floorStepKeysOf(nodes, zone.parentId ?? '', zone.id)
      .filter((key) => !floorStepOverrideFor(zone, key, null, zones))
      .flatMap((key) => onEveryPlate(floorStepRole(zone.id, key)))
  }

  if (parseFloorStepRole(role)) return onEveryPlate(role)

  const floor = parseRoomFinishRole(role)
  if (floor) {
    const zone = zoneOf(floor.zoneId)
    if (floor.regionId === '*') {
      const surfaces = onEveryPlate(roomFinishRole(floor.zoneId))
      if (!zone) return surfaces
      for (const region of zone.floor?.regions ?? [])
        surfaces.push(...onEveryPlate(roomFinishRole(zone.id, region.id)))
      if (!options.erasing)
        return zone.floorStepFinish ? surfaces : [...surfaces, ...followingSteps(zone)]
      surfaces.push(...followingSteps(zone))
      if (zone.floorEdgeFinish) surfaces.push(...onEveryPlate(`edge:${zone.id}`))
      return surfaces
    }
    const surfaces = onEveryPlate(role)
    if (floor.regionId || !zone || zone.floorStepFinish) return surfaces
    return [...surfaces, ...followingSteps(zone)]
  }

  if (role === 'edge' && node.plateRole === 'base') {
    const surfaces: PaintSurface[] = [{ nodeId: node.id as AnyNodeId, role }]
    for (const zone of Object.values(nodes)) {
      if (zone.type !== 'zone' || zone.parentId !== node.parentId || zone.floorEdgeFinish) continue
      if (roomFootprint(nodes as Record<string, AnyNode>, zone.id)?.id !== node.id) continue
      surfaces.push(...onEveryPlate(`edge:${zone.id}`))
    }
    return surfaces
  }

  return [{ nodeId: node.id as AnyNodeId, role }]
}

/**
 * The (plate, role) pairs whose paint preview draws `plateAffectedSurfaces`.
 * A surface that follows another (a room's unpainted steps, the room edges on
 * a footprint's band) is drawn by the preview of the surface it follows on the
 * same plate: only that preview knows what the follower shows once its leader
 * is erased. So a floor and a whole room preview on every plate, and a
 * footprint's edge band on itself and on the plates drawing its rooms' edges.
 */
export function platePreviewSurfaces(
  nodes: Readonly<Record<string, AnyNode>>,
  node: AnyNode,
  role: string,
): PaintSurface[] | null {
  if (!isFloorPlate(node)) return null
  if (parseFloorStepRole(role) || parseRoomFinishRole(role))
    return Object.values(nodes)
      .filter((other) => isFloorPlate(other) && other.parentId === node.parentId)
      .map((plate) => ({ nodeId: plate.id as AnyNodeId, role }))
  if (role === 'edge' && node.plateRole === 'base')
    return mergePaintSurfaces(
      [{ nodeId: node.id as AnyNodeId, role }],
      (plateAffectedSurfaces(nodes, node, role) ?? []).map((surface) => ({
        nodeId: surface.nodeId,
        role,
      })),
    )
  return [{ nodeId: node.id as AnyNodeId, role }]
}

/** A ceiling's painted part: the click changes that region and nothing else. */
export function ceilingAffectedSurfaces(node: AnyNode, role: string): PaintSurface[] | null {
  return node.type === 'ceiling' && parseCeilingRegionRole(role)
    ? [{ nodeId: node.id as AnyNodeId, role }]
    : null
}

/** The targets a preview paints: the click's own targets plus what falls back to them. */
export function mergePaintSurfaces(
  first: readonly PaintSurface[],
  second: readonly PaintSurface[] | null,
): PaintSurface[] {
  const merged = new Map<string, PaintSurface>()
  for (const surface of [...first, ...(second ?? [])])
    merged.set(`${surface.nodeId}:${surface.role}`, surface)
  return [...merged.values()]
}

/**
 * The meshes of `surfaces` under their registered roots: what the hover
 * outline draws instead of the whole plate.
 */
export function paintSurfaceMeshes<
  T extends { userData: Record<string, unknown>; traverse: (visit: (object: T) => void) => void },
>(surfaces: readonly PaintSurface[], rootOf: (nodeId: AnyNodeId) => T | null | undefined): T[] {
  const byNode = new Map<AnyNodeId, Set<string>>()
  for (const { nodeId, role } of surfaces) {
    const roles = byNode.get(nodeId) ?? new Set<string>()
    roles.add(role)
    byNode.set(nodeId, roles)
  }
  const meshes: T[] = []
  for (const [nodeId, roles] of byNode) {
    rootOf(nodeId)?.traverse((object) => {
      const { paintRole, slotId, __fromGeometry } = object.userData as {
        paintRole?: string
        slotId?: string | null
        __fromGeometry?: boolean
      }
      if ((object as { isMesh?: boolean }).isMesh !== true || __fromGeometry !== true) return
      const role = paintRole ?? slotId
      if (role && (roles.has(role) || [...roles].some((wide) => floorStepRoleCovers(wide, role))))
        meshes.push(object)
    })
  }
  return meshes
}

/** The floor-plate surfaces the paint hover outlines (null: outline the hovered node as usual). */
export const usePaintOutline = create<{ surfaces: PaintSurface[] | null }>(() => ({
  surfaces: null,
}))
