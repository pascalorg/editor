import { refuse } from '../agent-tools/refusal'
import { scriptedSize } from '../lib/geometry-script-node'
import {
  type WallFaceScriptInputs,
  wallFaceScriptInputs,
  wallFaceScriptRecord,
} from '../lib/wall-face-script'
import { type CompiledGeometryScript, WallFaceScript, type WallNode } from '../schema'
import type { WallFace } from '../schema/nodes/wall'
import type { AgentOperation } from './types'

export type SetWallFaceScriptInput =
  | {
      wallId: string
      face: WallFace
      /** The module compiled for `inputs` (`wallFaceScriptInputs` of the face, read before compiling). */
      compiled: CompiledGeometryScript
      inputs: WallFaceScriptInputs
      /** Metres above the face's base the script stops at; absent, it covers the whole face. */
      toHeight?: number
    }
  | { wallId: string; face: WallFace; remove: true }

const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * `setWallFaceScript`: one wall face's finish built by a three.js module, or the module taken off.
 * The host reads the face (`wallFaceScriptInputs`), compiles the module for it (geometry-script
 * `inputs`: the module reads `params.outline`, `params.holes`, `params.base`, `params.thickness`
 * in the face's frame) and stores the artifacts; this writes the result on the wall, with the key
 * of the face it was built for. When the wall or its openings change the script is stale and
 * `refreshFinishScripts` runs it again. A script to the top owns the face's colours: paint on that
 * face is refused while it is there.
 */
export const setWallFaceScript: AgentOperation<SetWallFaceScriptInput> = (nodes, input) => {
  const wall = nodes[input.wallId]
  if (wall?.type !== 'wall')
    refuse('target_not_found', `${input.wallId} is not a wall in the scene: nothing was changed.`, {
      target: input.wallId,
    })
  const name = wall.name?.trim() || wall.id
  const { face } = input

  if ('remove' in input) {
    if (!wall.finishScripts?.[face])
      return { result: { ok: true, wallId: wall.id, face, removed: false } }
    const { [face]: _, ...kept } = wall.finishScripts
    const finishScripts: WallNode['finishScripts'] = Object.keys(kept).length ? kept : undefined
    return {
      result: { ok: true, wallId: wall.id, face, removed: true },
      changes: { update: [{ id: wall.id, data: { finishScripts } }] },
    }
  }

  const { compiled, toHeight } = input
  if (compiled.language !== 'three')
    refuse(
      'three_only',
      `A wall face script is a three.js module: it is given the face, which a Blender build is not. Nothing was changed on ${name}.`,
      { target: wall.id },
    )
  if (toHeight !== undefined && !(toHeight > 0))
    refuse(
      'invalid_height',
      `toHeight is metres above the face's base, above 0: nothing was changed on ${name}.`,
      {
        target: wall.id,
      },
    )
  if (!wallFaceScriptInputs(nodes, wall.id, face, toHeight))
    refuse(
      'no_face',
      `${name}'s face ${face} has nothing a script can build on (a curved or curtain wall, or no height): nothing was changed.`,
      { target: wall.id },
    )
  const { min, max } = compiled.manifest.bounds
  if (![...min, ...max].every(Number.isFinite))
    refuse(
      'unmeasurable_object',
      `${name}'s face script built geometry that cannot be measured: a mesh in it has a position, rotation or scale that is not a number. Nothing was changed.`,
      { target: wall.id },
    )
  const script = WallFaceScript.parse(
    wallFaceScriptRecord(compiled, input.inputs, toHeight, wall.finishScripts?.[face]),
  )
  return {
    result: {
      ok: true,
      wallId: wall.id,
      face,
      size: scriptedSize(compiled.manifest).map(round),
      slots: compiled.manifest.slots.map((slot) => slot.id),
      triangles: compiled.manifest.triangles,
      note:
        toHeight === undefined
          ? `The script owns the colours of ${name}'s face ${face}: painting that face is refused until the script is removed. It runs again whenever the wall or its openings change.`
          : `The script builds ${name}'s face ${face} up to ${round(toHeight)} m; the face above stays paintable. It runs again whenever the wall or its openings change.`,
    },
    changes: {
      update: [{ id: wall.id, data: { finishScripts: { ...wall.finishScripts, [face]: script } } }],
    },
  }
}
