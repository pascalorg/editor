import { z } from 'zod'
import { floorIntentConflicts } from '../../lib/floor-intent-changes'
import { ownFloorIntentChanges } from '../../lib/own-floor-intent'
import { drawnFloorElevationConflict } from '../../lib/room-drawn-floor'
import { roundFloorElevation } from '../../lib/room-floor-feasibility'
import { ZoneNode } from '../../schema'
import { mezzanineElevationConflict } from './mezzanine-content'
import { requireZone, type StructureNodes, type StructurePlan } from './shared'

const floor = ZoneNode.shape.floor.unwrap()
const ceiling = ZoneNode.shape.ceiling.unwrap()
export const ZoneIntentPatch = z.strictObject({
  name: z.string().nullable().optional(),
  floor: z
    .strictObject({
      footprint: floor.shape.footprint.unwrap().nullable().optional(),
      thickness: floor.shape.thickness.unwrap().nullable().optional(),
      elevation: floor.shape.elevation.unwrap().nullable().optional(),
      finish: floor.shape.finish.unwrap().nullable().optional(),
      regions: floor.shape.regions.unwrap().nullable().optional(),
    })
    .nullable()
    .optional(),
  ceiling: z
    .strictObject({
      regions: ceiling.shape.regions.unwrap().nullable().optional(),
    })
    .nullable()
    .optional(),
  floorStepFinish: z.string().nullable().optional(),
  floorStepOverrides: ZoneNode.shape.floorStepOverrides.unwrap().nullable().optional(),
  floorEdgeFinish: z.string().nullable().optional(),
  wallMaterial: z.string().nullable().optional(),
  hasFloor: z.boolean().nullable().optional(),
  hasCeiling: z.boolean().nullable().optional(),
})
export type ZoneIntentPatch = z.infer<typeof ZoneIntentPatch>

export function setZoneIntent(
  nodes: StructureNodes,
  input: { zoneId: string; patch: ZoneIntentPatch },
): StructurePlan {
  const zone = requireZone(nodes, input.zoneId)
  const patch = ZoneIntentPatch.parse(input.patch)
  const requestedKey = patch.floor?.footprint
  if (
    requestedKey &&
    requestedKey !== 'new' &&
    requestedKey !== zone.floor?.footprint &&
    !Object.values(nodes).some(
      (node) =>
        node.type === 'zone' &&
        node.parentId === zone.parentId &&
        node.floor?.footprint === requestedKey,
    )
  )
    return {
      changes: [],
      conflicts: [
        {
          code: 'room-floor-footprint',
          nodeIds: [zone.id],
          message: 'Choose an existing floor key on this level, or "new".',
        },
      ],
    }
  const data: Partial<ZoneNode> = {}
  for (const key of ['floorStepFinish', 'floorEdgeFinish'] as const)
    if (patch[key] !== undefined) data[key] = patch[key] ?? undefined
  if (patch.floorStepOverrides !== undefined)
    data.floorStepOverrides = patch.floorStepOverrides?.length
      ? patch.floorStepOverrides
      : undefined
  if (patch.name !== undefined) data.name = patch.name ?? ''
  if (patch.wallMaterial !== undefined) data.wallMaterial = patch.wallMaterial ?? undefined
  for (const key of ['hasFloor', 'hasCeiling'] as const)
    if (patch[key] !== undefined) data[key] = patch[key] === false ? false : undefined
  if (patch.floor !== undefined) {
    data.floor = patch.floor === null ? undefined : { ...zone.floor }
    if (patch.floor)
      for (const key of ['elevation', 'finish', 'regions', 'thickness', 'footprint'] as const) {
        const value = patch.floor[key]
        if (value === null) delete data.floor![key]
        else if (value !== undefined)
          Object.assign(data.floor!, {
            [key]:
              key === 'elevation' && typeof value === 'number' ? roundFloorElevation(value) : value,
          })
      }
  }
  if (patch.ceiling !== undefined) {
    const regions = patch.ceiling === null ? null : patch.ceiling.regions
    if (regions === null) data.ceiling = undefined
    else if (regions !== undefined) data.ceiling = { ...zone.ceiling, regions }
  }
  if (zone.floor?.support === 'open') {
    if (patch.floor === null || patch.floor?.elevation === null)
      return {
        changes: [],
        conflicts: [
          {
            code: 'mezzanine-intent',
            nodeIds: [zone.id],
            message: 'A mezzanine must retain its open support and explicit elevation.',
          },
        ],
      }
    const invalid = mezzanineElevationConflict(nodes, { ...zone, ...data })
    if (invalid) return { changes: [], conflicts: [invalid] }
  }
  // A drawn-slab floor keeps its height on the slab; a room height would move nothing.
  if (typeof data.floor?.elevation === 'number' && data.floor.elevation !== zone.floor?.elevation) {
    const drawn = drawnFloorElevationConflict(nodes, zone.id)
    if (drawn) return { changes: [], conflicts: [drawn] }
  }
  if (
    zone.floor?.support !== 'open' &&
    (patch.floor === null || patch.floor?.elevation !== undefined)
  ) {
    const conflicts = floorIntentConflicts(nodes, [{ id: zone.id, data }])
    if (conflicts.length) return { changes: [], conflicts }
  }
  ZoneNode.parse({ ...zone, ...data })
  const own = ownFloorIntentChanges(nodes, Object.keys(data).length ? [{ id: zone.id, data }] : [])
  return {
    changes: own.updates.map((update) => ({ op: 'update', ...update })),
    ...(own.conflicts.length ? { conflicts: own.conflicts } : {}),
  }
}
