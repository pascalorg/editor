import { refuse } from '../agent-tools/refusal'
import type { AnyNode } from '../schema'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

type NameUnitsInput = { names: { id: string; name: string }[] }
type UnitNode = Extract<AnyNode, { type: 'unit' }>

/** The unit an id names: the unit itself, or the unit an apartment zone belongs to. */
function unitOf(nodes: SceneNodes, id: string): UnitNode | null {
  const node = nodes[id] as AnyNode | undefined
  if (node?.type === 'unit') return node
  if (node?.type !== 'zone') return null
  return (
    (Object.values(nodes) as AnyNode[]).find(
      (candidate): candidate is UnitNode =>
        candidate.type === 'unit' && candidate.members.includes(id as never),
    ) ?? null
  )
}

/**
 * `name_units`: apartments named as the plans number them. Victor run 11's units and zones read
 * "Floor 2 16" and the copies "Floor 4 20 copy". The unit's own zone takes the name, and the rooms
 * named after the apartment ("Floor 2 16 · Bedroom 1") keep theirs after the new one.
 */
export const nameUnits: AgentOperation<NameUnitsInput> = (nodes, { names }) => {
  const renames = names.map(({ id, name }) => {
    const unit = unitOf(nodes, id)
    if (!unit)
      refuse(
        'unit_not_found',
        `${id} is neither an apartment's unit nor its zone: get_zones lists the apartments' zones.`,
        { id },
      )
    return { unit, name }
  })
  const data = new Map<string, Record<string, unknown>>()
  const zones = Object.values(nodes) as AnyNode[]
  for (const { unit, name } of renames) {
    const before = unit.name
    data.set(unit.id, { name })
    const levels = new Set<string>()
    for (const member of unit.members) {
      const zone = nodes[member] as AnyNode | undefined
      if (zone?.type !== 'zone') continue
      levels.add(zone.parentId as string)
      if (!zone.name || zone.name === before) data.set(zone.id, { name })
    }
    if (!before) continue
    for (const room of zones)
      if (
        room.type === 'zone' &&
        levels.has(room.parentId as string) &&
        room.name?.startsWith(`${before} · `)
      )
        data.set(room.id, { name: `${name}${room.name.slice(before.length)}` })
  }
  const changes: SceneChanges = { update: [...data].map(([id, update]) => ({ id, data: update })) }
  return {
    result: { status: 'named', units: renames.length, zones: data.size - renames.length },
    changes,
  }
}
