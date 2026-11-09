import { roomDrawnFloor } from '../../lib/room-drawn-floor'
import type { SlabNode } from '../../schema'
import { MIN_SLAB_THICKNESS } from '../../schema/nodes/slab'
import { FloorFoundationPatch, setFloorFoundation } from './set-floor-foundation'
import { conflict, requireZone, type StructureNodes, type StructurePlan } from './shared'

export function setRoomFloorConstruction(
  nodes: StructureNodes,
  input: { zoneId: string; slabId?: string; patch: typeof FloorFoundationPatch._output },
): StructurePlan {
  const zone = requireZone(nodes, input.zoneId)
  // A drawn-slab floor is edited on the slab the room visibly stands on.
  const drawn = roomDrawnFloor(nodes, zone.id)
  const options = Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.parentId === zone.parentId &&
      (node.id === zone.floor?.sourceSlabId ||
        node.id === drawn?.slabId ||
        (node.plateRole === 'base' && (node.zoneIds ?? []).includes(zone.id))),
  )
  const selected = input.slabId
    ? options.find((plate) => plate.id === input.slabId)
    : (options.find((plate) => plate.id === (drawn?.slabId ?? zone.floor?.sourceSlabId)) ??
      (options.length === 1 ? options[0] : undefined))
  if (!selected)
    return conflict(
      'room-floor-owner',
      [zone.id, ...options.map((plate) => plate.id)],
      options.length
        ? `This room spans more than one floor construction. Choose slabId from: ${options.map((plate) => plate.id).join(', ')}.`
        : 'This room has no associated floor construction.',
    )
  const patch = FloorFoundationPatch.parse(input.patch)
  if (selected.plateRole === 'base') {
    const key = zone.floor?.footprint
    if (!key) return setFloorFoundation(nodes, { slabId: selected.id, patch })
    const plates = Object.values(nodes).filter(
      (node): node is SlabNode =>
        node.type === 'slab' &&
        node.parentId === zone.parentId &&
        node.plateRole === 'base' &&
        !!node.zoneIds?.some((id) => {
          const room = nodes[id]
          return room?.type === 'zone' && room.floor?.footprint === key
        }),
    )
    return setFloorFoundation(nodes, {
      slabIds: [
        selected.id,
        ...plates.filter((plate) => plate.id !== selected.id).map((plate) => plate.id),
      ],
      patch,
      sameConstruction: true,
    })
  }
  if (
    patch.foundation !== undefined ||
    patch.foundationHeight !== undefined ||
    patch.floorHeight === null
  )
    return conflict(
      'room-authored-floor-construction',
      [zone.id, selected.id],
      'An authored slab has no foundation or automatic height to restore. Supply a numeric floorHeight to move its top, or edit thickness and finishes.',
    )
  const elevation = patch.floorHeight === undefined ? undefined : patch.floorHeight
  return {
    changes: [
      {
        op: 'update',
        id: selected.id,
        data: {
          ...(elevation === undefined ? {} : { elevation }),
          ...(patch.thickness === undefined
            ? {}
            : { thickness: Math.max(MIN_SLAB_THICKNESS, patch.thickness) }),
          ...(patch.slots === undefined ? {} : { slots: { ...selected.slots, ...patch.slots } }),
        },
      },
      ...(elevation !== undefined && zone.floor?.elevation !== undefined
        ? [
            {
              op: 'update' as const,
              id: zone.id,
              data: { floor: { ...zone.floor, elevation } },
            },
          ]
        : []),
    ],
  }
}
