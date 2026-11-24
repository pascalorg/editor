import { refuse } from '../agent-tools/refusal'
import type { FinishScriptInputs } from '../lib/finish-script'
import { floorScriptInputs, slabSurfaceScriptInputs } from '../lib/floor-script'
import { type WallFaceScriptExtent, wallFaceScriptInputs } from '../lib/wall-face-script'
import type { CompiledGeometryScript, WallNode, ZoneNode } from '../schema'
import type { WallFace } from '../schema/nodes/wall'
import { applySceneChanges } from './apply-changes'
import { roomWallFaces } from './room-faces'
import { setRoomFloorScript } from './room-floor-script'
import { setSlabSurfaceScript } from './slab-surface-script'
import type { AgentOperationOutcome, SceneChanges, SceneNodes } from './types'
import { setWallFaceScript } from './wall-face-script'

export type SetFinishScriptInput = {
  targetId: string
  surface?: 'walls' | 'floor'
  face?: WallFace
  code?: string
  toHeight?: number
  remove?: true
}

/** One surface a finish script builds on, with what its module is compiled for. */
export type FinishScriptBuild = {
  /** Names the build in `compiled`: `<nodeId>/<face>` for a wall face, `<nodeId>` otherwise. */
  key: string
  nodeId: string
  /** A wall face's; absent for a floor or a slab's top. */
  face?: WallFace
  inputs: FinishScriptInputs
  extent?: WallFaceScriptExtent
}

/** A module compiled for one build, with the inputs it was compiled for. */
export type FinishScriptCompile = { script: CompiledGeometryScript; inputs: FinishScriptInputs }

/** A wall face the call could not build on, and why. */
export type FinishScriptSkip = { wallId: string; face: WallFace; code: string; message: string }

export type FinishScriptPlan = {
  kind: 'room-walls' | 'room-floor' | 'wall-face' | 'slab'
  name: string
  builds: FinishScriptBuild[]
  /** With `remove`, the room's wall faces whose script is the room's own. */
  removals: { wallId: string; face: WallFace }[]
  skipped: FinishScriptSkip[]
}

/** A room's stretch within this share of a wall's ends runs to that end: the whole face. */
const WHOLE_FACE = 1e-3
/** How far a script already on a face may run past the room's stretch and still be the room's. */
const STRETCH_SLACK_M = 0.05

const round = (value: number) => Math.round(value * 1000) / 1000
const side = (face: WallFace) => face.toUpperCase()
const nameOf = (node: { id: string; name?: string }) => node.name?.trim() || node.id

/** The stretch of each face that looks into the room, one per face, over all its spans. */
function roomStretches(nodes: SceneNodes, zone: ZoneNode) {
  const stretches = new Map<string, ReturnType<typeof roomWallFaces>[number]>()
  for (const stretch of roomWallFaces(nodes, zone)) {
    const key = `${stretch.wallId}/${stretch.face}`
    const seen = stretches.get(key)
    stretches.set(
      key,
      seen
        ? { ...seen, u0: Math.min(seen.u0, stretch.u0), u1: Math.max(seen.u1, stretch.u1) }
        : stretch,
    )
  }
  return [...stretches.values()]
}

/**
 * What `set_finish_script` builds, before anything is compiled: each surface with what its module
 * is given. The host compiles the module once per build, for its `inputs`, then calls
 * `setFinishScript` with the results. A room's walls skip a face the room cannot take (a curved
 * wall, a face another room's script already covers), naming it; a call that leaves nothing to
 * build is refused.
 */
export function planFinishScript(nodes: SceneNodes, input: SetFinishScriptInput): FinishScriptPlan {
  const target = nodes[input.targetId]
  if (!target)
    refuse('target_not_found', `${input.targetId} is not in the scene: nothing was changed.`, {
      target: input.targetId,
    })
  if (!input.remove && !input.code)
    refuse('code_required', 'Give the module as code, or remove: true to take a finish off.')
  const name = nameOf(target)

  if (target.type === 'zone') {
    if (!input.surface)
      refuse('surface_required', `${name} is a room: say which surface, 'walls' or 'floor'.`, {
        target: target.id,
      })
    if (input.surface === 'floor') {
      if (input.toHeight !== undefined)
        refuse('invalid_height', 'toHeight is for wall finishes: nothing was changed.')
      if (input.remove) return { kind: 'room-floor', name, builds: [], removals: [], skipped: [] }
      const inputs = floorScriptInputs(nodes, target.id)
      if (!inputs)
        refuse('no_floor', `${name} has no floor a script can build on: nothing was changed.`, {
          target: target.id,
        })
      return {
        kind: 'room-floor',
        name,
        builds: [{ key: target.id, nodeId: target.id, inputs }],
        removals: [],
        skipped: [],
      }
    }
    return roomWallsPlan(nodes, target as ZoneNode, input)
  }

  if (target.type === 'wall') {
    if (!input.face)
      refuse('face_required', `${name} is a wall: say which face, a or b.`, { target: target.id })
    if (input.remove) return { kind: 'wall-face', name, builds: [], removals: [], skipped: [] }
    const extent = { toHeight: input.toHeight }
    const inputs = wallFaceScriptInputs(nodes, target.id, input.face, extent)
    if (!inputs)
      refuse(
        'no_face',
        `${name}'s face ${side(input.face)} has nothing a script can build on (a curved, curtain or railing wall, or no height): nothing was changed.`,
        { target: target.id },
      )
    return {
      kind: 'wall-face',
      name,
      builds: [
        { key: `${target.id}/${input.face}`, nodeId: target.id, face: input.face, inputs, extent },
      ],
      removals: [],
      skipped: [],
    }
  }

  if (target.type === 'slab') {
    if (input.toHeight !== undefined)
      refuse('invalid_height', 'toHeight is for wall finishes: nothing was changed.')
    if (input.remove) return { kind: 'slab', name, builds: [], removals: [], skipped: [] }
    const inputs = slabSurfaceScriptInputs(nodes, target.id)
    if (!inputs)
      refuse('no_surface', `${name} has no top a script can build on: nothing was changed.`, {
        target: target.id,
      })
    return {
      kind: 'slab',
      name,
      builds: [{ key: target.id, nodeId: target.id, inputs }],
      removals: [],
      skipped: [],
    }
  }

  refuse(
    'unsupported_target',
    `${name} is a ${target.type}: a finish script goes on a room's walls or floor, a wall's face or a slab's top.`,
    { target: target.id },
  )
}

function roomWallsPlan(
  nodes: SceneNodes,
  zone: ZoneNode,
  input: SetFinishScriptInput,
): FinishScriptPlan {
  const name = nameOf(zone)
  const builds: FinishScriptBuild[] = []
  const removals: FinishScriptPlan['removals'] = []
  const skipped: FinishScriptSkip[] = []
  for (const stretch of roomStretches(nodes, zone)) {
    const { wallId, face, length } = stretch
    const wall = nodes[wallId] as WallNode
    const existing = wall.finishScripts?.[face]
    // A script already on the face that runs past this room's stretch is another room's.
    const ours =
      !existing ||
      ((existing.u0 ?? 0) >= stretch.u0 - STRETCH_SLACK_M &&
        (existing.u1 ?? length) <= stretch.u1 + STRETCH_SLACK_M)
    if (!ours) {
      skipped.push({
        wallId,
        face,
        code: 'face_taken',
        message: `${nameOf(wall)}'s face ${side(face)} also looks into another room, whose finish script covers more than ${name}'s stretch: it was left as it is. Remove that script first, or finish that wall face whole.`,
      })
      continue
    }
    if (input.remove) {
      if (existing) removals.push({ wallId, face })
      continue
    }
    const extent: WallFaceScriptExtent = {
      toHeight: input.toHeight,
      u0: stretch.u0 > WHOLE_FACE * length ? round(stretch.u0) : undefined,
      u1: stretch.u1 < (1 - WHOLE_FACE) * length ? round(stretch.u1) : undefined,
    }
    const inputs = stretch.curved ? null : wallFaceScriptInputs(nodes, wallId, face, extent)
    if (!inputs) {
      skipped.push({
        wallId,
        face,
        code: 'no_face',
        message: `${nameOf(wall)}'s face ${side(face)} has nothing a script can build on (a curved, curtain or railing wall, or no height): it keeps its paint.`,
      })
      continue
    }
    builds.push({ key: `${wallId}/${face}`, nodeId: wallId, face, inputs, extent })
  }
  if (!input.remove && builds.length === 0)
    refuse(
      'no_face',
      `No wall face of ${name} can take the finish: nothing was changed.${skipped.length ? ` ${skipped.map((skip) => skip.message).join(' ')}` : ''}`,
      { target: zone.id, skipped },
    )
  return { kind: 'room-walls', name, builds, removals, skipped }
}

/** Each build's changes applied over the last, merged into one update per node. */
function merged(
  nodes: SceneNodes,
  steps: ((current: SceneNodes) => AgentOperationOutcome)[],
): SceneChanges {
  let current = nodes
  const updates = new Map<string, Record<string, unknown>>()
  for (const step of steps) {
    const { changes } = step(current)
    if (!changes) continue
    current = applySceneChanges(current, changes)
    for (const { id, data } of changes.update ?? [])
      updates.set(id, { ...updates.get(id), ...(data as Record<string, unknown>) })
  }
  return { update: [...updates].map(([id, data]) => ({ id, data })) } as SceneChanges
}

/**
 * `set_finish_script`: the finish its plan names, built from the modules the host compiled (one per
 * build, by key, with the inputs each was compiled for), or taken off with `remove`. A surface that
 * changed while its module compiled (a wall moved, a door added) is refused as `scene_changed`:
 * a build for the old surface would land on the new one. Not in
 * AGENT_OPERATIONS: each surface compiles the module first (the chat in the editor tab's sandbox,
 * the MCP through its script host), as for add_object.
 */
export function setFinishScript(
  nodes: SceneNodes,
  input: SetFinishScriptInput & { compiled?: Readonly<Record<string, FinishScriptCompile>> },
): AgentOperationOutcome {
  const plan = planFinishScript(nodes, input)
  const target = input.targetId
  const context = { activeLevelId: null }
  const skipped = plan.skipped.length ? { skipped: plan.skipped } : {}

  if (input.remove) {
    const steps =
      plan.kind === 'room-floor'
        ? [
            (current: SceneNodes) =>
              setRoomFloorScript(current, { zoneId: target, remove: true }, context),
          ]
        : plan.kind === 'slab'
          ? [
              (current: SceneNodes) =>
                setSlabSurfaceScript(current, { slabId: target, remove: true }, context),
            ]
          : plan.kind === 'wall-face'
            ? [
                (current: SceneNodes) =>
                  setWallFaceScript(
                    current,
                    { wallId: target, face: input.face!, remove: true },
                    context,
                  ),
              ]
            : plan.removals.map(
                ({ wallId, face }) =>
                  (current: SceneNodes) =>
                    setWallFaceScript(current, { wallId, face, remove: true }, context),
              )
    const changes = merged(nodes, steps)
    const removed = changes.update?.length ?? 0
    return {
      result: { ok: true, targetId: target, removed, ...skipped },
      ...(removed ? { changes } : {}),
    }
  }

  const compiledFor = (build: FinishScriptBuild) => {
    const compiled = input.compiled?.[build.key]
    if (!compiled)
      refuse('not_compiled', `The module was not compiled for ${build.key}: nothing was changed.`)
    if (JSON.stringify(compiled.inputs) !== JSON.stringify(build.inputs))
      refuse(
        'scene_changed',
        `${build.key} changed while its finish compiled: nothing was changed. Call again to build it for the surface as it now stands.`,
      )
    return compiled.script
  }
  const steps = plan.builds.map((build) => (current: SceneNodes) => {
    const compiled = compiledFor(build)
    if (build.face)
      return setWallFaceScript(
        current,
        {
          wallId: build.nodeId,
          face: build.face,
          compiled,
          inputs: build.inputs as never,
          ...build.extent,
        },
        context,
      )
    if (plan.kind === 'slab')
      return setSlabSurfaceScript(
        current,
        { slabId: build.nodeId, compiled, inputs: build.inputs as never },
        context,
      )
    return setRoomFloorScript(
      current,
      { zoneId: build.nodeId, compiled, inputs: build.inputs as never },
      context,
    )
  })
  const changes = merged(nodes, steps)
  const built = plan.builds.map((build) => ({
    nodeId: build.nodeId,
    ...(build.face ? { face: build.face } : {}),
    ...(build.extent?.u0 !== undefined ? { u0: build.extent.u0 } : {}),
    ...(build.extent?.u1 !== undefined ? { u1: build.extent.u1 } : {}),
    triangles: compiledFor(build).manifest.triangles,
  }))
  const where =
    plan.kind === 'room-walls'
      ? `${built.length} wall face${built.length === 1 ? '' : 's'} of ${plan.name}, each on the room's own stretch`
      : plan.kind === 'room-floor'
        ? `${plan.name}'s floor`
        : plan.kind === 'slab'
          ? `the top of ${plan.name}`
          : `${plan.name}'s face ${side(input.face!)}`
  return {
    result: {
      ok: true,
      targetId: target,
      built,
      ...skipped,
      note: `Built on ${where}${input.toHeight === undefined ? '' : `, up to ${round(input.toHeight)} m`}. Pascal rebuilds it when what it finishes changes.`,
    },
    changes,
  }
}
