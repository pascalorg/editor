import { refuse } from '../agent-tools/refusal'
import { type FloorScriptInputs, floorScriptInputs, floorScriptRecord } from '../lib/floor-script'
import { scriptedSize } from '../lib/geometry-script-node'
import { type CompiledGeometryScript, ZoneFloorScript, type ZoneNode } from '../schema'
import type { AgentOperation } from './types'

export type SetRoomFloorScriptInput =
  | {
      zoneId: string
      /** The module compiled for `inputs` (`floorScriptInputs` of the room, read before compiling). */
      compiled: CompiledGeometryScript
      inputs: FloorScriptInputs
    }
  | { zoneId: string; remove: true }

const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * `setRoomFloorScript`: a room's floor finish built by a three.js module, or the module taken off.
 * The host reads the room's floor (`floorScriptInputs`), compiles the module for it (geometry-script
 * `inputs`: the module reads `params.polygon`, `params.holes`, `params.elevation`, in level
 * coordinates) and stores the artifacts; this writes the result on the zone, with the key of the
 * floor it was built for. When the structure re-derives the room's floor the script is stale and
 * `refreshFinishScripts` runs it again. The script owns the floor's colours: paint on that floor is
 * refused while it is there.
 */
export const setRoomFloorScript: AgentOperation<SetRoomFloorScriptInput> = (nodes, input) => {
  const zone = nodes[input.zoneId]
  if (zone?.type !== 'zone')
    refuse('target_not_found', `${input.zoneId} is not a room in the scene: nothing was changed.`, {
      target: input.zoneId,
    })
  const name = zone.name?.trim() || zone.id

  if ('remove' in input) {
    if (!zone.floor?.script) return { result: { ok: true, zoneId: zone.id, removed: false } }
    const { script: _, ...floor } = zone.floor
    return {
      result: { ok: true, zoneId: zone.id, removed: true },
      changes: {
        update: [{ id: zone.id, data: { floor: Object.keys(floor).length ? floor : undefined } }],
      },
    }
  }

  const { compiled } = input
  if (compiled.language !== 'three')
    refuse(
      'three_only',
      `A room's floor script is a three.js module: it is given the room's floor, which a Blender build is not. Nothing was changed on ${name}.`,
      { target: zone.id },
    )
  if (!floorScriptInputs(nodes, zone.id))
    refuse(
      'no_floor',
      `${name} has no floor to build on (its walls do not close it, or its floor is off): nothing was changed.`,
      { target: zone.id },
    )
  const { min, max } = compiled.manifest.bounds
  if (![...min, ...max].every(Number.isFinite))
    refuse(
      'unmeasurable_object',
      `${name}'s floor script built geometry that cannot be measured: a mesh in it has a position, rotation or scale that is not a number. Nothing was changed.`,
      { target: zone.id },
    )
  const script = ZoneFloorScript.parse(
    floorScriptRecord(compiled, input.inputs, zone.floor?.script),
  )
  const floor: NonNullable<ZoneNode['floor']> = { ...zone.floor, script }
  return {
    result: {
      ok: true,
      zoneId: zone.id,
      size: scriptedSize(compiled.manifest).map(round),
      slots: compiled.manifest.slots.map((slot) => slot.id),
      triangles: compiled.manifest.triangles,
      note: `The script owns ${name}'s floor colours: painting that floor is refused until the script is removed. It runs again whenever the room's floor changes.`,
    },
    changes: { update: [{ id: zone.id, data: { floor } }] },
  }
}
