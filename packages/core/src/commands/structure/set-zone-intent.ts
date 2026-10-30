import { z } from 'zod'
import { floorIntentConflicts } from '../../lib/floor-intent-changes'
import { floorScriptPaintRefusal } from '../../lib/floor-plate-paint'
import {
  isOutdoorRoomDefaultName,
  isOutdoorRoomType,
  nextOutdoorRoomName,
  OUTDOOR_ROOM_DEFAULTS,
} from '../../lib/outdoor-room'
import { ownFloorIntentChanges } from '../../lib/own-floor-intent'
import { drawnFloorElevationConflict } from '../../lib/room-drawn-floor'
import { roundFloorElevation } from '../../lib/room-floor-feasibility'
import { slabRoomDoorChanges, slabRoomElevation } from '../../lib/slab-room'
import { type AnyNode, type AnyNodeId, ZoneNode } from '../../schema'
import { mezzanineElevationConflict } from './mezzanine-content'
import { requireZone, type StructureNodes, type StructurePlan } from './shared'

const floor = ZoneNode.shape.floor.unwrap()
const ceiling = ZoneNode.shape.ceiling.unwrap()
const decking = ZoneNode.shape.decking.unwrap()
export const ZoneIntentPatch = z.strictObject({
  name: z.string().nullable().optional(),
  floor: z
    .strictObject({
      footprint: floor.shape.footprint.unwrap().nullable().optional(),
      thickness: floor.shape.thickness.unwrap().nullable().optional(),
      elevation: floor.shape.elevation.unwrap().nullable().optional(),
      finish: floor.shape.finish.unwrap().nullable().optional(),
      regions: floor.shape.regions.unwrap().nullable().optional(),
      foundation: floor.shape.foundation.unwrap().nullable().optional(),
      drop: floor.shape.drop.unwrap().nullable().optional(),
    })
    .nullable()
    .optional(),
  roomType: ZoneNode.shape.roomType.unwrap().nullable().optional(),
  // A porch's posts and beam (`lib/porch-framing`), a deck's or patio's once switched on (`auto`
  // true). Choosing a size or the spacing rebuilds them from the settings, automatic again,
  // unless the patch says otherwise.
  porchFraming: z
    .strictObject({
      auto: z.boolean().nullable().optional(),
      postSize: z.string().nullable().optional(),
      postSpacing: z.number().positive().nullable().optional(),
      beamSize: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  // A deck's boards (`lib/deck-boards`): the stock, the gap and the way they run; null clears one
  // back to its default, a null `decking` all three.
  decking: z
    .strictObject({
      boardSize: decking.shape.boardSize.unwrap().nullable().optional(),
      gap: decking.shape.gap.unwrap().nullable().optional(),
      direction: decking.shape.direction.unwrap().nullable().optional(),
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
  // The room's declaration of artificial light and mechanical ventilation (the IRC R303.1
  // exceptions to daylight), kept in its metadata under `daylight`: what a check of the room's
  // daylight reads, beside a window to outside.
  daylight: z
    .strictObject({ artificialLight: z.boolean(), mechanicalVentilation: z.boolean() })
    .nullable()
    .optional(),
})
export type ZoneIntentPatch = z.infer<typeof ZoneIntentPatch>

/**
 * The patch with what an explicit choice of slab or raised foundation asks of the room's floor.
 */
function withRoomFoundation(
  nodes: StructureNodes,
  zone: ZoneNode,
  patch: ZoneIntentPatch,
): ZoneIntentPatch {
  const asked = patch.floor?.foundation
  if (asked === undefined) return patch
  const choice = asked
  const scene = nodes as Record<AnyNodeId, AnyNode>
  // In a raised house a slab room's floor comes down to its slab on grade; a room back on the
  // raised floor goes back up to it.
  const lowered = choice === 'slab' ? slabRoomElevation(scene, zone) : null
  const raised = choice !== 'slab' && zone.floor?.foundation === 'slab'
  return {
    ...patch,
    floor: {
      ...patch.floor,
      foundation: choice,
      ...(lowered !== null && patch.floor?.elevation === undefined ? { elevation: lowered } : {}),
      ...(raised && patch.floor?.elevation === undefined ? { elevation: null } : {}),
    },
  }
}

/**
 * The patch with what a change of room type brings (`lib/outdoor-room`): a porch, deck or patio
 * steps its floor down from the house's, takes its floor finish, a ceiling or none, and its name
 * while the room still has a default one; back to an ordinary room drops them again. What the
 * patch sets itself wins.
 */
function withRoomType(
  nodes: StructureNodes,
  zone: ZoneNode,
  patch: ZoneIntentPatch,
): ZoneIntentPatch {
  const asked = patch.roomType
  if (asked === undefined || (asked ?? undefined) === zone.roomType) return patch
  const previous = isOutdoorRoomType(zone.roomType) ? OUTDOOR_ROOM_DEFAULTS[zone.roomType] : null
  const next = isOutdoorRoomType(asked) ? OUTDOOR_ROOM_DEFAULTS[asked] : null
  // A finish the old type gave the room goes with it; one the user picked stays.
  const finish = zone.floor?.finish
  const typeFinish = finish === undefined || finish === previous?.finish
  const defaultName = /^Room \d+$/.test(zone.name) || isOutdoorRoomDefaultName(zone.name)
  const names = Object.values(nodes).flatMap((node) =>
    node.type === 'zone' && node.parentId === zone.parentId && node.id !== zone.id
      ? [node.name]
      : [],
  )
  return {
    ...patch,
    ...(patch.name === undefined && next && defaultName
      ? { name: nextOutdoorRoomName(asked as keyof typeof OUTDOOR_ROOM_DEFAULTS, names) }
      : {}),
    ...(patch.hasCeiling === undefined ? { hasCeiling: next ? next.covered : true } : {}),
    floor: {
      ...patch.floor,
      ...(patch.floor?.drop === undefined && patch.floor?.elevation === undefined
        ? { drop: next ? next.drop : null }
        : {}),
      ...(patch.floor?.finish === undefined && typeFinish
        ? { finish: next ? next.finish : null }
        : {}),
    },
  }
}

/**
 * A room's intent: its name, floor, ceiling and finishes. Its floor's foundation (`floor.foundation`)
 * moves its floor with it in a raised house: a slab room comes
 * down to its slab on grade (`slabRoomElevation`), and back up when it goes back on the raised floor.
 */
export function setZoneIntent(
  nodes: StructureNodes,
  input: { zoneId: string; patch: ZoneIntentPatch },
): StructurePlan {
  const zone = requireZone(nodes, input.zoneId)
  const patch = withRoomFoundation(
    nodes,
    zone,
    withRoomType(nodes, zone, ZoneIntentPatch.parse(input.patch)),
  )
  const painted = zone.floor?.script && (patch.floor?.finish ?? patch.floor?.regions)
  const scripted = painted ? floorScriptPaintRefusal(zone) : undefined
  if (scripted)
    return {
      changes: [],
      conflicts: [{ code: scripted.code, nodeIds: [zone.id], message: scripted.message }],
    }
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
  if (patch.roomType !== undefined) data.roomType = patch.roomType ?? undefined
  if (patch.porchFraming !== undefined) {
    const asked = patch.porchFraming
    const framing: Record<string, unknown> = asked === null ? {} : { ...zone.porchFraming }
    if (asked)
      for (const key of ['auto', 'postSize', 'postSpacing', 'beamSize'] as const) {
        if (asked[key] === null) delete framing[key]
        else if (asked[key] !== undefined) framing[key] = asked[key]
      }
    const resized =
      asked && (['postSize', 'postSpacing', 'beamSize'] as const).some((key) => key in asked)
    if (resized && asked.auto === undefined) framing.auto = true
    // A porch's are automatic by default, stored only when off; a deck's or patio's are off by
    // default, stored when switched on.
    const roomType = patch.roomType !== undefined ? (patch.roomType ?? undefined) : zone.roomType
    if (roomType === 'porch' && framing.auto === true) delete framing.auto
    data.porchFraming = Object.keys(framing).length
      ? (framing as ZoneNode['porchFraming'])
      : undefined
  }
  if (patch.decking !== undefined) {
    const asked = patch.decking
    const boards: Record<string, unknown> = asked === null ? {} : { ...zone.decking }
    if (asked)
      for (const key of ['boardSize', 'gap', 'direction'] as const) {
        if (asked[key] === null) delete boards[key]
        else if (asked[key] !== undefined) boards[key] = asked[key]
      }
    data.decking = Object.keys(boards).length ? (boards as ZoneNode['decking']) : undefined
  }
  if (patch.wallMaterial !== undefined) data.wallMaterial = patch.wallMaterial ?? undefined
  for (const key of ['hasFloor', 'hasCeiling'] as const)
    if (patch[key] !== undefined) data[key] = patch[key] === false ? false : undefined
  if (patch.daylight !== undefined) {
    const { daylight: _declared, ...metadata } = zone.metadata ?? {}
    data.metadata = patch.daylight === null ? metadata : { ...metadata, daylight: patch.daylight }
  }
  if (patch.floor !== undefined) {
    data.floor = patch.floor === null ? undefined : { ...zone.floor }
    if (patch.floor)
      for (const key of [
        'elevation',
        'finish',
        'regions',
        'thickness',
        'footprint',
        'foundation',
        'drop',
      ] as const) {
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
  // A slab room's doors to the outside open from its slab: their sills move with its floor.
  const sill = (room: ZoneNode) =>
    room.floor?.foundation === 'slab' ? (room.floor.elevation ?? 0) : 0
  const doors = slabRoomDoorChanges(
    nodes as Record<AnyNodeId, AnyNode>,
    zone,
    sill(zone),
    sill({ ...zone, ...data } as ZoneNode),
  )
  return {
    changes: [...own.updates, ...doors].map((update) => ({ op: 'update', ...update })),
    ...(own.conflicts.length ? { conflicts: own.conflicts } : {}),
  }
}
