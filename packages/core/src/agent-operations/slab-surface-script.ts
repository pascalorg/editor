import { refuse } from '../agent-tools/refusal'
import {
  type FloorScriptInputs,
  floorScriptRecord,
  slabSurfaceScriptInputs,
} from '../lib/floor-script'
import { scriptedSize } from '../lib/geometry-script-node'
import { isFloorPlate } from '../lib/plate-surface'
import { type CompiledGeometryScript, ZoneFloorScript } from '../schema'
import type { AgentOperation } from './types'

export type SetSlabSurfaceScriptInput =
  | {
      slabId: string
      /** The module compiled for `inputs` (`slabSurfaceScriptInputs` of the slab, read before compiling). */
      compiled: CompiledGeometryScript
      inputs: FloorScriptInputs
    }
  | { slabId: string; remove: true }

const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * `setSlabSurfaceScript`: a standalone slab's surface finish (a terrace's decking, a platform's
 * tiles, a plinth's paving) built by a three.js module, or the module taken off. The host reads the
 * slab's outline (`slabSurfaceScriptInputs`), compiles the module for it (the module reads
 * `params.polygon` and `params.holes` in the level's plan x/z, and lays its finish from y = 0, the
 * slab's top) and stores the artifacts; this writes the result on the slab with the key of the
 * outline it was built for, and the renderer stands it on the slab. When the slab is reshaped the
 * script is stale and `refreshFinishScripts` runs it again. The script owns the surface's colours:
 * paint on it is refused while it is there. A room's floor plate has none: the room's floor script
 * (`setRoomFloorScript`) builds there.
 */
export const setSlabSurfaceScript: AgentOperation<SetSlabSurfaceScriptInput> = (nodes, input) => {
  const slab = nodes[input.slabId]
  if (slab?.type !== 'slab')
    refuse('target_not_found', `${input.slabId} is not a slab in the scene: nothing was changed.`, {
      target: input.slabId,
    })
  const name = slab.name?.trim() || slab.id

  if ('remove' in input) {
    if (!slab.surfaceScript) return { result: { ok: true, slabId: slab.id, removed: false } }
    return {
      result: { ok: true, slabId: slab.id, removed: true },
      changes: { update: [{ id: slab.id, data: { surfaceScript: undefined } }] },
    }
  }

  const { compiled } = input
  if (compiled.language !== 'three')
    refuse(
      'three_only',
      `A slab's surface script is a three.js module: it is given the slab's outline, which a Blender build is not. Nothing was changed on ${name}.`,
      { target: slab.id },
    )
  if (isFloorPlate(slab)) {
    const rooms = (slab.zoneIds ?? []).flatMap((id) => {
      const zone = nodes[id]
      return zone?.type === 'zone' ? [`${zone.name?.trim() || zone.id} (${zone.id})`] : []
    })
    refuse(
      'room_floor_plate',
      `${name} is the floor plate Pascal builds under ${rooms.length ? rooms.join(', ') : 'its rooms'}: a room's floor finish is built by that room's floor script, not by the plate. Nothing was changed.`,
      { target: slab.id, zoneIds: slab.zoneIds ?? [] },
    )
  }
  if (!slabSurfaceScriptInputs(nodes, slab.id))
    refuse(
      'no_surface',
      `${name} has no surface to build on (its outline has fewer than three corners): nothing was changed.`,
      { target: slab.id },
    )
  const { min, max } = compiled.manifest.bounds
  if (![...min, ...max].every(Number.isFinite))
    refuse(
      'unmeasurable_object',
      `${name}'s surface script built geometry that cannot be measured: a mesh in it has a position, rotation or scale that is not a number. Nothing was changed.`,
      { target: slab.id },
    )
  const surfaceScript = ZoneFloorScript.parse(
    floorScriptRecord(compiled, input.inputs, slab.surfaceScript),
  )
  return {
    result: {
      ok: true,
      slabId: slab.id,
      size: scriptedSize(compiled.manifest).map(round),
      slots: compiled.manifest.slots.map((slot) => slot.id),
      triangles: compiled.manifest.triangles,
      note: `The script owns ${name}'s surface colours: painting that surface is refused until the script is removed. It runs again whenever the slab's outline or holes change.`,
    },
    changes: { update: [{ id: slab.id, data: { surfaceScript } }] },
  }
}
