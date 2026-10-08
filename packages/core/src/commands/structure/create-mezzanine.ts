import { GROUND_SUPPORT_ID } from '../../hooks/spatial-grid/support-host-id'
import { containsPoint } from '../../lib/polygon-boolean'
import { polygonInteriorPoint } from '../../lib/polygon-label'
import { newZone } from '../../lib/new-zone'
import type { SlabNode } from '../../schema'
import { getStoredLevelHeight } from '../../services/storey'
import { isFloorPlacedIntent } from './mezzanine-content'
import {
  type NodeChange,
  type Point,
  requireZone,
  type StructureMintId,
  type StructureNodes,
  type StructurePlan,
} from './shared'

import { validateMezzanine } from './validate-mezzanine'

export type CreateMezzanineInput = {
  hostZoneId: string
  polygon: Point[]
  elevation?: number
  thickness?: number
  mintId: StructureMintId
}

export function createMezzanine(
  nodes: StructureNodes,
  input: CreateMezzanineInput,
): StructurePlan & { zoneId: string } {
  const host = requireZone(nodes, input.hostZoneId)
  const level = host.parentId ? nodes[host.parentId] : undefined
  if (level?.type !== 'level' || host.floor?.support === 'open')
    throw Error('A mezzanine needs a host room on a level.')
  const polygon = input.polygon
  const zone = newZone({
    id: input.mintId('zone'),
    parentId: level.id,
    name: 'Mezzanine',
    spaceRole: 'room',
    hostZoneId: host.id,
    polygon,
    seed: polygonInteriorPoint({ polygon }, true),
    floor: {
      support: 'open',
      elevation: input.elevation ?? Math.round(getStoredLevelHeight(level) * 10) / 20,
      thickness: input.thickness ?? 0.2,
    },
  })
  const invalid = validateMezzanine(nodes, zone)
  if (invalid) return { zoneId: '', changes: [], conflicts: [invalid] }
  if (nodes[zone.id]) throw Error(`Duplicate zone id: ${zone.id}`)
  const hostPlates = Object.values(nodes).filter(
    (node): node is SlabNode => node.type === 'slab' && !!node.zoneIds?.includes(host.id),
  )
  hostPlates.sort((a, b) => b.elevation - a.elevation)
  const pins: NodeChange[] = Object.values(nodes).flatMap((node): NodeChange[] => {
    if (
      !isFloorPlacedIntent(node) ||
      node.parentId !== level.id ||
      node.supportSlabId ||
      !containsPoint([{ outer: polygon, holes: [] }], [node.position[0], node.position[2]])
    )
      return []
    const plate = hostPlates.find((slab) =>
      containsPoint(
        [{ outer: slab.polygon, holes: slab.holes }],
        [node.position[0], node.position[2]],
      ),
    )
    return [{ op: 'update', id: node.id, data: { supportSlabId: plate?.id ?? GROUND_SUPPORT_ID } }]
  })
  return { zoneId: zone.id, changes: [{ op: 'create', node: zone }, ...pins] }
}
