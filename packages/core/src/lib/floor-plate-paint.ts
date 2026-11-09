import type { AnyNode } from '../schema'
import { parseRoomFinishRole } from './plate-surface'

export type FloorPlatePaintRefusal = {
  status: 'refused'
  code: 'floor-surface-without-room' | 'floor-built-by-script'
  message: string
}

/** Why a room's floor cannot be painted: a script builds it, and the script owns its colours. */
export function floorScriptPaintRefusal(
  zone: AnyNode | undefined,
): FloorPlatePaintRefusal | undefined {
  if (zone?.type === 'zone' && zone.floor?.script)
    return {
      status: 'refused',
      code: 'floor-built-by-script',
      message: `${zone.name?.trim() || 'This room'}'s floor is built by a script, which owns its colours. Remove the script to paint the floor.`,
    }
}

/** Why a slab's top cannot be painted: its own surface script builds it, and owns its colours. */
export function slabSurfaceScriptPaintRefusal(
  slab: AnyNode | undefined,
  role: string,
): FloorPlatePaintRefusal | undefined {
  if (slab?.type === 'slab' && slab.surfaceScript && role === 'surface')
    return {
      status: 'refused',
      code: 'floor-built-by-script',
      message: `${slab.name?.trim() || 'This slab'}'s surface is built by a script, which owns its colours. Remove the script to paint the surface.`,
    }
}

export function floorPlatePaintRefusal(
  nodes: Readonly<Record<string, AnyNode>>,
  node: AnyNode,
  role: string,
): FloorPlatePaintRefusal | undefined {
  if (node.type !== 'slab') return
  const scripted = slabSurfaceScriptPaintRefusal(node, role)
  if (scripted) return scripted
  const room = parseRoomFinishRole(role)
  if (room) return floorScriptPaintRefusal(nodes[room.zoneId])
  if (node.plateRole !== 'base' || role !== 'surface') return
  const zones = (node.zoneIds ?? []).map((id) => nodes[id])
  if (!zones.some((zone) => zone?.type === 'zone' && zone.hasFloor !== false))
    return {
      status: 'refused',
      code: 'floor-surface-without-room',
      message: 'This structural floor band has no room finish to paint. Paint its edge instead.',
    }
  for (const zone of zones) {
    const refusal = floorScriptPaintRefusal(zone)
    if (refusal) return refusal
  }
}
