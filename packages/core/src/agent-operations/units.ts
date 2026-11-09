import { refuse } from '../agent-tools/refusal'
import { buildUnitReport } from '../lib/unit-report'
import { type BuildingNode, type UnitKind, UnitNode, type ZoneNode } from '../schema'
import { targetBuilding } from './add-level'
import { queryNodes } from './scene-queries'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

type CreateUnitInput = {
  buildingId?: string
  name: string
  kind?: UnitKind
  color?: string
  memberZoneIds?: string[]
  move?: boolean
}

type SetUnitMembersInput = { unitId: string; memberZoneIds: string[]; move?: boolean }

type ListUnitsInput = { buildingId?: string }

const unitsOf = (nodes: SceneNodes, buildingId: string) =>
  queryNodes<UnitNode>(nodes, { type: 'unit' }).filter((unit) => unit.parentId === buildingId)

/**
 * The zones as the unit may hold them: each one a zone on a level of the building, in no other
 * unit of it unless the call moves it, each once. Answers the members and the units that lose one.
 */
function memberZones(
  nodes: SceneNodes,
  building: BuildingNode,
  zoneIds: readonly string[],
  except: string | null,
  move: boolean | undefined,
) {
  const levelIds = new Set<string>(
    queryNodes(nodes, { type: 'level' })
      .filter(
        (level) =>
          level.parentId === building.id ||
          (building.children as readonly string[]).includes(level.id),
      )
      .map((level) => level.id),
  )
  const others = unitsOf(nodes, building.id).filter((unit) => unit.id !== except)
  const leaving = new Map<string, Set<string>>()
  const members: ZoneNode['id'][] = []
  for (const zoneId of new Set(zoneIds)) {
    const zone = nodes[zoneId]
    if (!zone) refuse('zone_not_found', `Zone not found: ${zoneId}.`, { zoneId })
    if (zone.type !== 'zone')
      refuse('zone_not_found', `Node ${zoneId} is a ${zone.type}, not a zone.`, {
        zoneId,
        type: zone.type,
      })
    if (!zone.parentId || !levelIds.has(zone.parentId))
      refuse(
        'zone_outside_building',
        `Zone ${zoneId} (${zone.name}) is not on a level of building ${building.id}.`,
        { zoneId, buildingId: building.id },
      )
    const holder = others.find((unit) => unit.members.includes(zone.id))
    if (holder) {
      if (!move)
        refuse(
          'zone_in_other_unit',
          `Zone ${zoneId} (${zone.name}) is already in unit ${holder.id} (${holder.name}). Pass move: true to move it.`,
          { zoneId, unitId: holder.id, unitName: holder.name },
        )
      leaving.set(holder.id, (leaving.get(holder.id) ?? new Set()).add(zone.id))
    }
    members.push(zone.id)
  }
  const released: NonNullable<SceneChanges['update']> = [...leaving].map(([unitId, zones]) => ({
    id: unitId,
    data: { members: (nodes[unitId] as UnitNode).members.filter((id) => !zones.has(id)) },
  }))
  const moved = [...leaving.values()].reduce((n, zones) => n + zones.size, 0)
  return { members, released, moved }
}

const describe = (unit: UnitNode) => ({
  unitId: unit.id,
  name: unit.name,
  kind: unit.kind,
  color: unit.color,
  members: unit.members,
})

/** `create_unit`: a unit under its building, holding the zones named. */
export const createUnit: AgentOperation<CreateUnitInput> = (nodes, input, context) => {
  const building = targetBuilding(nodes, input.buildingId, context)
  const { members, released, moved } = memberZones(
    nodes,
    building,
    input.memberZoneIds ?? [],
    null,
    input.move,
  )
  const unit = UnitNode.parse({
    parentId: building.id,
    name: input.name,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.color ? { color: input.color } : {}),
    members,
  })
  return {
    result: {
      ...describe(unit),
      buildingId: building.id,
      memberCount: members.length,
      message: `Made ${unit.kind} "${unit.name}" in ${building.name ?? building.id} with ${members.length} room${members.length === 1 ? '' : 's'}${moved ? `, ${moved} moved from ${released.length === 1 ? 'another unit' : 'other units'}` : ''}.`,
    },
    changes: {
      create: [{ node: unit, parentId: building.id }],
      ...(released.length ? { update: released } : {}),
    },
  }
}

/** `set_unit_members`: the unit's rooms from now on. */
export const setUnitMembers: AgentOperation<SetUnitMembersInput> = (nodes, input) => {
  const unit = nodes[input.unitId]
  if (!unit) refuse('unit_not_found', `Unit not found: ${input.unitId}.`, { unitId: input.unitId })
  if (unit.type !== 'unit')
    refuse('unit_not_found', `Node ${input.unitId} is a ${unit.type}, not a unit.`, {
      unitId: input.unitId,
      type: unit.type,
    })
  const building = unit.parentId ? nodes[unit.parentId] : undefined
  if (building?.type !== 'building')
    refuse('building_not_found', `Unit ${unit.id} is in no building.`, { unitId: unit.id })
  const { members, released, moved } = memberZones(
    nodes,
    building,
    input.memberZoneIds,
    unit.id,
    input.move,
  )
  const next = { ...unit, members }
  return {
    result: {
      ...describe(next),
      buildingId: building.id,
      memberCount: members.length,
      message: `"${unit.name}" now holds ${members.length} room${members.length === 1 ? '' : 's'}${moved ? `, ${moved} moved from ${released.length === 1 ? 'another unit' : 'other units'}` : ''}.`,
    },
    changes: { update: [{ id: unit.id, data: { members } }, ...released] },
  }
}

/** `list_units`: every unit of a building, or of the scene, with its report. */
export const listUnits: AgentOperation<ListUnitsInput> = (nodes, input, context) => {
  const building = input.buildingId ? targetBuilding(nodes, input.buildingId, context) : null
  const units = queryNodes<UnitNode>(nodes, { type: 'unit' }).filter(
    (unit) => !building || unit.parentId === building.id,
  )
  return {
    result: {
      units: units.map((unit) => ({ ...describe(unit), report: buildUnitReport(unit, nodes) })),
    },
  }
}
