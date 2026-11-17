import { refuse } from '../agent-tools/refusal'
import {
  type AnyNode,
  WALL_FACE_REGION_LIMIT,
  type WallFace,
  type WallFaceRegion,
  type WallNode,
} from '../schema'
import { wallResolvedHeight } from './level-reads'
import type { AgentOperation, SceneChanges } from './types'

/** A finish laid over part of a face: the metres on it that a paint region takes, an absent bound running to the edge. */
export type FaceRegionSpec = {
  u0?: number
  u1?: number
  v0?: number
  v1?: number
  finish: string
}

/** The id prefix of the regions a room's dressing lays: `dress:<zoneId>:`, then a number. */
export const dressRegionOwner = (zoneId: string) => `dress:${zoneId}:`

/** The room a region was laid for by its dressing, or undefined for one drawn by hand. */
export const dressedRegionZoneId = (regionId: string) => /^dress:(.+):\d+$/.exec(regionId)?.[1]

export type FaceRegionPlan = { wallId: string; face: WallFace; regions: FaceRegionSpec[] }

export type SetWallFaceRegionsInput = {
  /**
   * Who writes: `dress:<zoneId>:`. The owner's earlier regions on the walls named are replaced by
   * these; a region without the mark (drawn by hand) is never touched.
   */
  owner: string
  /** The faces to lay regions on, each bottom to top (a later region wins where they overlap). */
  faces: FaceRegionPlan[]
  /** Walls whose earlier regions of this owner go though nothing is laid on them now. */
  clearWallIds?: string[]
}

export type FaceRegionResult = {
  wallId: string
  face: WallFace
  regions: WallFaceRegion[]
  /** How many regions the face holds now, hand-drawn ones included, of the most it can. */
  count: number
}

const sameRegions = (a: readonly WallFaceRegion[], b: readonly WallFaceRegion[]) =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * `setWallFaceRegions`: the paint regions of a wall's faces laid or replaced for one owner. It is the
 * write under a room's dressing, not a tool: it clamps each region to its face, numbers them
 * `<owner><n>` in the order given, refuses before any write what a face cannot hold (`region_limit`:
 * eight a face, hand-drawn ones counted) or what a script builds to the top (`script_owns_face`), and
 * returns one update per wall that changes.
 */
export const setWallFaceRegions: AgentOperation<SetWallFaceRegionsInput> = (nodes, input) => {
  const { owner } = input
  if (!/^dress:.+:$/.test(owner))
    refuse('invalid_owner', 'Room dressing needs an owner of the form dress:<zoneId>:.')
  const wall = (id: string): WallNode => {
    const found = nodes[id]
    if (found?.type !== 'wall')
      refuse('target_not_found', `${id} is not a wall in the scene: nothing was changed.`, {
        target: id,
      })
    if (found.wallType === 'curtain')
      refuse('curtain_wall', `Wall ${id} is a curtain wall: it has no paint regions.`, {
        target: id,
      })
    if (found.wallType === 'railing')
      refuse('railing_wall', `Wall ${id} is a railing: it has no paint regions.`, { target: id })
    return found
  }
  const ids = [
    ...new Set([...input.faces.map((plan) => plan.wallId), ...(input.clearWallIds ?? [])]),
  ]
  const skipped: { wallId: string; face: WallFace; why: string }[] = []
  let next = 0
  const laid = new Map<string, WallFaceRegion[]>()
  for (const plan of input.faces) {
    const found = wall(plan.wallId)
    const script = found.finishScripts?.[plan.face]
    if (plan.regions.length && script && script.toHeight === undefined)
      refuse(
        'script_owns_face',
        `Side ${plan.face.toUpperCase()} of ${found.name?.trim() || found.id} is built by a script, which owns its colours: remove the script to dress that side.`,
        { target: found.id, face: plan.face },
      )
    const length = Math.hypot(found.end[0] - found.start[0], found.end[1] - found.start[1])
    const height = wallResolvedHeight(nodes, found)
    for (const spec of plan.regions) {
      if (
        [spec.u0, spec.u1, spec.v0, spec.v1].some(
          (value) => value !== undefined && !Number.isFinite(value),
        )
      )
        refuse('invalid_size', 'Paint region bounds must be finite lengths.', { target: found.id })
      const region: WallFaceRegion = { id: `${owner}${next}`, face: plan.face, finish: spec.finish }
      if (spec.u0 !== undefined) region.u0 = Math.max(0, spec.u0)
      if (spec.u1 !== undefined) region.u1 = Math.min(length, spec.u1)
      if (spec.v0 !== undefined) region.v0 = Math.max(0, spec.v0)
      if (spec.v1 !== undefined) region.v1 = Math.min(height, spec.v1)
      if (
        (region.u0 ?? 0) >= (region.u1 ?? length) - 1e-6 ||
        (region.v0 ?? 0) >= (region.v1 ?? height) - 1e-6
      ) {
        skipped.push({ wallId: found.id, face: plan.face, why: 'it lies off the face' })
        continue
      }
      next += 1
      laid.set(`${found.id}/${plan.face}`, [
        ...(laid.get(`${found.id}/${plan.face}`) ?? []),
        region,
      ])
    }
  }

  const changes: NonNullable<SceneChanges['update']> = []
  const faces: FaceRegionResult[] = []
  for (const id of ids) {
    const found = wall(id)
    const before = found.faceRegions ?? []
    const kept = before.filter((region) => !region.id.startsWith(owner))
    const after = [
      ...kept,
      ...(['a', 'b'] as const).flatMap((face) => laid.get(`${id}/${face}`) ?? []),
    ]
    for (const face of ['a', 'b'] as const) {
      const here = after.filter((region) => region.face === face)
      if (here.length > WALL_FACE_REGION_LIMIT)
        refuse(
          'region_limit',
          `Side ${face.toUpperCase()} of ${found.name?.trim() || id} would hold ${here.length} paint regions, ${kept.filter((region) => region.face === face).length} existing regions retained: a face holds ${WALL_FACE_REGION_LIMIT}. Nothing was changed.`,
          { target: id, face, count: here.length, limit: WALL_FACE_REGION_LIMIT },
        )
      if (laid.has(`${id}/${face}`))
        faces.push({ wallId: id, face, regions: laid.get(`${id}/${face}`)!, count: here.length })
    }
    if (!sameRegions(before, after))
      changes.push({ id, data: { faceRegions: after } as Partial<AnyNode> })
  }
  return {
    result: { ok: true, faces, ...(skipped.length ? { skipped } : {}) },
    changes: { update: changes },
  }
}
